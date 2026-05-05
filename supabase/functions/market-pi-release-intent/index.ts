import { requireAdmin } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import {
  piCancelPayment,
  piCompletePayment,
  piCreateA2UPayment,
  piSubmitA2UPayment,
  toFixedString,
  toSafeNumber,
} from "../_shared/market/pi.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

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
    intent_type: "RELEASE",
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
    console.warn("[market-pi-release-intent] intent insert skipped:", error.message);
  }
}

async function transitionToReleased(admin: any, order: any, note?: string | null) {
  const status = String(order?.status || "").toUpperCase();
  if (status === "RELEASED") return null;

  const { error } = await admin.rpc("market_transition_order_status", {
    p_order_id: order.id,
    p_expected_version: Number(order.version ?? 0),
    p_new_status: "RELEASED",
    p_note: note ?? "Pi native payout confirmed",
  });

  return error ? String(error.message || "Unable to transition order to RELEASED") : null;
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

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  let adminMode = false;
  try {
    const adminFail = await requireAdmin(req, { requireSession: true, permissions: ["escrow.settle"] });
    adminMode = adminFail === null;
  } catch {
    adminMode = false;
  }

  let user: any = null;
  if (!adminMode) {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    user = auth?.user;
    if (authErr || !user) return unauth();
  }

  const body = await req.json().catch(() => ({}));
  const order_id = String(body?.order_id ?? "").trim();
  const note = String(body?.note ?? "").trim() || null;

  if (!order_id) return bad("order_id required");

  try {
    const order = await getOrderForUpdate(admin, order_id);

    if (!adminMode && order.buyer_id !== user.id) {
      return bad("Not your order");
    }

    const allowed = new Set(["IN_ESCROW", "DELIVERED", "DELIVERABLE_UPLOADED"]);
    if (adminMode) allowed.add("DISPUTED");

    const orderStatus = String(order.status || "").toUpperCase();
    if (orderStatus === "RELEASED") {
      return ok({
        ok: true,
        order_id,
        already_released: true,
        settlement_mode: "pi_native_a2u",
      });
    }
    if (!allowed.has(orderStatus)) return bad(`Cannot release from status: ${order.status}`);

    const { data: dispute } = await admin
      .from("market_disputes")
      .select("status")
      .eq("order_id", order_id)
      .maybeSingle();
    if (dispute && isOpenDisputeStatus(dispute.status) && !adminMode) {
      return bad("Order is under dispute");
    }

    const { paid_usd, paid_pi } = await readPiEscrowTotals(admin, order_id);
    if (paid_usd <= 0 || paid_pi <= 0) {
      return bad("No settled Pi escrow balance found for this order.");
    }

    const orderUsd = toSafeNumber(order.amount, 0);
    const shortfallUsd = Math.max(0, orderUsd - paid_usd);
    if (shortfallUsd > 0.0000001) {
      return bad(
        `Pi escrow is still underpaid. Remaining shortfall: ${Number(toFixedString(shortfallUsd, 8))} USD.`,
      );
    }

    const { data: sellerWallet, error: sellerWalletErr } = await admin
      .from("crypto_wallets")
      .select("address")
      .eq("user_id", order.seller_id)
      .eq("chain", PI_CHAIN)
      .maybeSingle();
    if (sellerWalletErr) return bad(sellerWalletErr.message);
    const sellerPiUid = String((sellerWallet as any)?.address || "").trim();
    if (!sellerPiUid) {
      return bad("Seller PI payout uid is not saved. Ask seller to save PI wallet/uid first.");
    }

    const { data: confirmedSettlement } = await admin
      .from("market_pi_settlements")
      .select("*")
      .eq("order_id", order_id)
      .eq("kind", "RELEASE")
      .eq("status", "CONFIRMED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (confirmedSettlement) {
      const latest = await getOrderForUpdate(admin, order_id);
      const trErr = await transitionToReleased(admin, latest, note);
      if (trErr) return bad(`Payout already confirmed but order transition failed: ${trErr}`);

      return ok({
        ok: true,
        order_id,
        already_released: true,
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
        .eq("kind", "RELEASE")
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
            kind: "RELEASE",
            status: "CREATED",
            actor_id: adminMode ? null : user.id,
            actor_type: adminMode ? "admin" : "buyer",
            recipient_user_id: order.seller_id,
            recipient_pi_uid: sellerPiUid,
            recipient_wallet: sellerPiUid,
            amount_pi: Number(toFixedString(paid_pi, 8)),
            amount_usd_snapshot: Number(toFixedString(paid_usd, 8)),
            raw: {
              order_status: order.status,
              mode: adminMode ? "admin" : "buyer",
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
      to_wallet: sellerPiUid,
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
          memo: `BestCity release ${order_id}`,
          metadata: {
            order_id,
            kind: "release",
            recipient_user_id: order.seller_id,
          },
          uid: sellerPiUid,
        });
        paymentId = String((createdPayment as any)?.identifier || "").trim();
        if (!paymentId) throw new Error("PI payout create failed: missing payment_id.");

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
        if (!txid) throw new Error("PI payout submit failed: missing txid.");

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
          to_wallet: sellerPiUid,
          payment_id: paymentId,
          txid,
        });
      }

      completedPayment = await piCompletePayment(paymentId, txid);
      const verified =
        (completedPayment as any)?.status?.developer_completed === true &&
        (completedPayment as any)?.status?.transaction_verified === true;
      if (!verified) {
        throw new Error("PI payout completion did not return verified + completed status.");
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
        to_wallet: sellerPiUid,
        payment_id: paymentId,
        txid,
      });
    } catch (e: any) {
      const failMessage = String(e?.message || e || "Pi payout failed");

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
          release_error: failMessage,
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
        to_wallet: sellerPiUid,
        payment_id: paymentId || null,
        txid: txid || null,
        failure_reason: failMessage,
      });

      return bad(failMessage);
    }

    const latestOrder = await getOrderForUpdate(admin, order_id);
    const trErr = await transitionToReleased(admin, latestOrder, note);
    if (trErr) return bad(`PI payout confirmed but order transition failed: ${trErr}`);

    if (dispute && isOpenDisputeStatus(dispute.status)) {
      await admin
        .from("market_disputes")
        .update({
          status: "RESOLVED",
          resolution: "RELEASE_TO_SELLER",
          resolved_by: null,
        })
        .eq("order_id", order_id)
        .in("status", ["OPEN", "UNDER_REVIEW"]);
    }

    await admin.from("market_audit_logs").insert({
      actor_id: adminMode ? null : user.id,
      actor_type: adminMode ? "admin" : "user",
      action: "PI_RELEASE_CONFIRMED",
      entity_type: "market_orders",
      entity_id: order_id,
      payload: {
        payment_id: paymentId || null,
        txid: txid || null,
        settlement_mode: "pi_native_a2u",
        amount_usd: Number(toFixedString(paid_usd, 8)),
        amount_pi: Number(toFixedString(paid_pi, 8)),
        recipient_pi_uid: sellerPiUid,
        admin_mode: adminMode,
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
      recipient_pi_uid: sellerPiUid,
      note: "Pi native payout was submitted and confirmed.",
    });
  } catch (e: any) {
    return bad(String(e?.message || e || "Unable to process PI release."));
  }
});
