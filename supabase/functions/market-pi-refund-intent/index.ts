import { adminError, requireAdmin } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import {
  piCancelPayment,
  piCompletePayment,
  piCreateA2UPayment,
  piSubmitA2UPayment,
  toFixedString,
  toSafeNumber,
} from "../_shared/market/pi.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

const PI_CHAIN = "pi_testnet";
const ACTIVE_SETTLEMENT_STATUSES = ["CREATED", "SUBMITTED"];

function isOpenDisputeStatus(status: unknown) {
  const s = String(status || "").toUpperCase();
  return s === "OPEN" || s === "UNDER_REVIEW";
}

async function safeInsertIntent(admin: any, input: {
  order_id: string;
  status: string;
  amount_usd: number;
  amount_pi: number;
  payment_id?: string | null;
  txid?: string | null;
  to_wallet: string;
  failure_reason?: string | null;
}) {
  const { error } = await admin.from("market_crypto_intents").insert({
    order_id: input.order_id,
    intent_type: "REFUND",
    status: input.status,
    chain: PI_CHAIN,
    from_wallet: "pi_escrow",
    to_wallet: input.to_wallet,
    amount_units: Number(toFixedString(input.amount_usd, 8)),
    amount_raw: toFixedString(input.amount_pi, 8),
    client_reference: input.payment_id || null,
    tx_hash: input.txid || null,
    failure_reason: input.failure_reason || null,
  });
  if (error) {
    console.warn("[market-pi-refund-intent] intent insert skipped:", error.message);
  }
}

async function transitionToRefunded(admin: any, order: any, note?: string | null) {
  const status = String(order?.status || "").toUpperCase();
  if (status === "REFUNDED") return null;

  const { error } = await admin.rpc("market_transition_order_status", {
    p_order_id: order.id,
    p_expected_version: Number(order.version ?? 0),
    p_new_status: "REFUNDED",
    p_note: note ?? "Pi native refund confirmed",
  });

  return error ? String(error.message || "Unable to transition order to REFUNDED") : null;
}

async function readPiEscrowTotals(admin: any, order_id: string) {
  const { data: piRows, error: piErr } = await admin
    .from("market_pi_payments")
    .select("status,paid_usd,paid_pi_amount")
    .eq("order_id", order_id);
  if (piErr) throw new Error(piErr.message);

  let paidUsd = 0;
  let paidPi = 0;
  for (const row of (piRows as any[]) ?? []) {
    const s = String(row?.status || "").toUpperCase();
    if (s !== "SETTLED" && s !== "UNDERPAID") continue;
    paidUsd += toSafeNumber(row?.paid_usd, 0);
    paidPi += toSafeNumber(row?.paid_pi_amount, 0);
  }

  return {
    paid_usd: Number(toFixedString(Math.max(0, paidUsd), 8)),
    paid_pi: Number(toFixedString(Math.max(0, paidPi), 8)),
  };
}

async function getOrderForUpdate(admin: any, order_id: string) {
  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,buyer_id,seller_id,status,version,amount,listing_id,currency")
    .eq("id", order_id)
    .maybeSingle();
  if (orderErr) throw new Error(orderErr.message);
  if (!order) throw new Error("Order not found");
  return order;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const authFail = await requireAdmin(req, { requireSession: true, permissions: ["escrow.settle"] });
    if (authFail) return authFail;

    const admin = supabaseAdminClient();
    const body = await req.json().catch(() => ({}));
    const order_id = String(body?.order_id ?? "").trim();
    const note = String(body?.note ?? "").trim() || null;

    if (!order_id) return bad("order_id required");

    const order = await getOrderForUpdate(admin, order_id);
    const orderStatus = String(order.status || "").toUpperCase();
    if (orderStatus === "REFUNDED") {
      return ok({
        ok: true,
        order_id,
        already_refunded: true,
        settlement_mode: "pi_native_a2u",
      });
    }

    const allowed = new Set(["IN_ESCROW", "DELIVERED", "DELIVERABLE_UPLOADED", "DISPUTED"]);
    if (!allowed.has(orderStatus)) return bad(`Cannot refund from status: ${order.status}`);

    const { paid_usd, paid_pi } = await readPiEscrowTotals(admin, order_id);
    if (paid_usd <= 0 || paid_pi <= 0) {
      return bad("No settled Pi escrow balance found for this order.");
    }

    const { data: buyerWallet, error: buyerWalletErr } = await admin
      .from("crypto_wallets")
      .select("address")
      .eq("user_id", order.buyer_id)
      .eq("chain", PI_CHAIN)
      .maybeSingle();
    if (buyerWalletErr) return bad(buyerWalletErr.message);
    const buyerPiUid = String((buyerWallet as any)?.address || "").trim();
    if (!buyerPiUid) {
      return bad("Buyer PI payout uid is not saved. Buyer must save PI wallet/uid first.");
    }

    const { data: confirmedSettlement } = await admin
      .from("market_pi_settlements")
      .select("*")
      .eq("order_id", order_id)
      .eq("kind", "REFUND")
      .eq("status", "CONFIRMED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (confirmedSettlement) {
      const latest = await getOrderForUpdate(admin, order_id);
      const trErr = await transitionToRefunded(admin, latest, note);
      if (trErr) return bad(`Refund already confirmed but order transition failed: ${trErr}`);

      return ok({
        ok: true,
        order_id,
        already_refunded: true,
        settlement_id: confirmedSettlement.id,
        payment_id: confirmedSettlement.payment_id || null,
        txid: confirmedSettlement.txid || null,
        settlement_mode: "pi_native_a2u",
      });
    }

    let settlement: any = null;
    {
      const { data: activeRows, error: activeErr } = await admin
        .from("market_pi_settlements")
        .select("*")
        .eq("order_id", order_id)
        .eq("kind", "REFUND")
        .in("status", ACTIVE_SETTLEMENT_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1);
      if (activeErr) return bad(activeErr.message);

      settlement = (activeRows ?? [])[0] ?? null;
      if (!settlement) {
        const { data: created, error: createErr } = await admin
          .from("market_pi_settlements")
          .insert({
            order_id,
            kind: "REFUND",
            status: "CREATED",
            actor_id: null,
            actor_type: "admin",
            recipient_user_id: order.buyer_id,
            recipient_pi_uid: buyerPiUid,
            recipient_wallet: buyerPiUid,
            amount_pi: Number(toFixedString(paid_pi, 8)),
            amount_usd_snapshot: Number(toFixedString(paid_usd, 8)),
            raw: {
              order_status: order.status,
              mode: "admin",
            },
          })
          .select("*")
          .single();
        if (createErr) return bad(createErr.message);
        settlement = created;
      }
    }

    await safeInsertIntent(admin, {
      order_id,
      status: "CREATED",
      amount_usd: paid_usd,
      amount_pi: paid_pi,
      to_wallet: buyerPiUid,
      payment_id: String(settlement?.payment_id || "").trim() || null,
    });

    let paymentId = String(settlement?.payment_id || "").trim();
    let txid = String(settlement?.txid || "").trim();
    let createdPayment: any = null;
    let submittedPayment: any = null;
    let completedPayment: any = null;

    try {
      if (!paymentId) {
        createdPayment = await piCreateA2UPayment({
          amount: Number(toFixedString(paid_pi, 8)),
          memo: `BestCity refund ${order_id}`,
          metadata: {
            order_id,
            kind: "refund",
            recipient_user_id: order.buyer_id,
          },
          uid: buyerPiUid,
        });
        paymentId = String((createdPayment as any)?.identifier || "").trim();
        if (!paymentId) throw new Error("PI refund create failed: missing payment_id.");

        const { error: updCreateErr } = await admin
          .from("market_pi_settlements")
          .update({
            payment_id: paymentId,
            raw: {
              ...(settlement?.raw || {}),
              created_payment: createdPayment,
            },
          })
          .eq("id", settlement.id);
        if (updCreateErr) throw new Error(updCreateErr.message);
      }

      if (!txid) {
        submittedPayment = await piSubmitA2UPayment(paymentId);
        txid = String((submittedPayment as any)?.txid || "").trim();
        if (!txid) throw new Error("PI refund submit failed: missing txid.");

        const { error: updSubmitErr } = await admin
          .from("market_pi_settlements")
          .update({
            status: "SUBMITTED",
            txid,
            submitted_at: new Date().toISOString(),
            raw: {
              ...(settlement?.raw || {}),
              submitted_payment: submittedPayment,
            },
          })
          .eq("id", settlement.id);
        if (updSubmitErr) throw new Error(updSubmitErr.message);

        await safeInsertIntent(admin, {
          order_id,
          status: "SUBMITTED",
          amount_usd: paid_usd,
          amount_pi: paid_pi,
          to_wallet: buyerPiUid,
          payment_id: paymentId,
          txid,
        });
      }

      completedPayment = await piCompletePayment(paymentId, txid);
      const verified =
        (completedPayment as any)?.status?.developer_completed === true &&
        (completedPayment as any)?.status?.transaction_verified === true;
      if (!verified) {
        throw new Error("PI refund completion did not return verified + completed status.");
      }

      const { error: updConfirmErr } = await admin
        .from("market_pi_settlements")
        .update({
          status: "CONFIRMED",
          confirmed_at: new Date().toISOString(),
          raw: {
            ...(settlement?.raw || {}),
            completed_payment: completedPayment,
          },
        })
        .eq("id", settlement.id);
      if (updConfirmErr) throw new Error(updConfirmErr.message);

      await safeInsertIntent(admin, {
        order_id,
        status: "CONFIRMED",
        amount_usd: paid_usd,
        amount_pi: paid_pi,
        to_wallet: buyerPiUid,
        payment_id: paymentId,
        txid,
      });
    } catch (e: any) {
      const failMessage = String(e?.message || e || "Pi refund failed");

      let finalStatus: "FAILED" | "CANCELLED" = "FAILED";
      let cancelResult: any = null;
      if (paymentId && !txid) {
        cancelResult = await piCancelPayment(paymentId).catch(() => null);
        if (cancelResult) finalStatus = "CANCELLED";
      }

      const updates: Record<string, unknown> = {
        status: finalStatus,
        failure_reason: failMessage,
        raw: {
          ...(settlement?.raw || {}),
          cancel_result: cancelResult,
          refund_error: failMessage,
        },
      };
      if (finalStatus === "FAILED") updates.failed_at = new Date().toISOString();
      if (finalStatus === "CANCELLED") updates.cancelled_at = new Date().toISOString();

      await admin.from("market_pi_settlements").update(updates).eq("id", settlement.id);

      await safeInsertIntent(admin, {
        order_id,
        status: "FAILED",
        amount_usd: paid_usd,
        amount_pi: paid_pi,
        to_wallet: buyerPiUid,
        payment_id: paymentId || null,
        txid: txid || null,
        failure_reason: failMessage,
      });

      return bad(failMessage);
    }

    const latestOrder = await getOrderForUpdate(admin, order_id);
    const trErr = await transitionToRefunded(admin, latestOrder, note);
    if (trErr) return bad(`PI refund confirmed but order transition failed: ${trErr}`);

    const { data: dispute } = await admin
      .from("market_disputes")
      .select("status")
      .eq("order_id", order_id)
      .maybeSingle();
    if (dispute && isOpenDisputeStatus(dispute.status)) {
      await admin
        .from("market_disputes")
        .update({
          status: "RESOLVED",
          resolution: "REFUND_TO_BUYER",
          resolved_by: null,
        })
        .eq("order_id", order_id)
        .in("status", ["OPEN", "UNDER_REVIEW"]);
    }

    await admin.from("market_audit_logs").insert({
      actor_id: null,
      actor_type: "admin",
      action: "PI_REFUND_CONFIRMED",
      entity_type: "market_orders",
      entity_id: order_id,
      payload: {
        payment_id: paymentId || null,
        txid: txid || null,
        settlement_mode: "pi_native_a2u",
        amount_usd: Number(toFixedString(paid_usd, 8)),
        amount_pi: Number(toFixedString(paid_pi, 8)),
        recipient_pi_uid: buyerPiUid,
      },
    });

    return ok({
      ok: true,
      order_id,
      payment_id: paymentId || null,
      txid: txid || null,
      settlement_mode: "pi_native_a2u",
      amount_usd: Number(toFixedString(paid_usd, 8)),
      amount_pi: Number(toFixedString(paid_pi, 8)),
      recipient_pi_uid: buyerPiUid,
      note: "Pi native refund was submitted and confirmed.",
    });
  } catch (e) {
    return adminError(e);
  }
});
