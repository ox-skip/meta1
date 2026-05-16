import { adminError, getAdminContext, getForwardedAdminHeaders } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

type Decision = "REFUND" | "RELEASE";

function resolutionForDecision(decision: Decision) {
  return decision === "RELEASE" ? "RELEASE_TO_SELLER" : "REFUND_TO_BUYER";
}

async function markDisputeSettlementSubmitted(
  admin: any,
  ctx: any,
  orderId: string,
  decision: Decision,
  note: string | null,
) {
  const resolution = resolutionForDecision(decision);
  const { error } = await admin
    .from("market_disputes")
    .update({
      status: "UNDER_REVIEW",
      resolution,
      resolved_by: ctx.userId,
      resolution_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq("order_id", orderId)
    .in("status", ["OPEN", "UNDER_REVIEW"]);
  if (error) throw error;
}

async function markDisputeResolved(
  admin: any,
  ctx: any,
  orderId: string,
  decision: Decision,
  note: string | null,
) {
  const resolution = resolutionForDecision(decision);
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("market_disputes")
    .update({
      status: "RESOLVED",
      resolution,
      resolved_by: ctx.userId,
      resolved_at: nowIso,
      resolution_note: note,
      updated_at: nowIso,
    })
    .eq("order_id", orderId)
    .in("status", ["OPEN", "UNDER_REVIEW", "RESOLVED"]);
  if (error) throw error;
}

async function functionInvokeErrorMessage(error: any) {
  const fallback = String(error?.message || error || "Edge Function failed");
  const context = error?.context;
  if (!context || typeof context.text !== "function") return fallback;

  try {
    const res = typeof context.clone === "function" ? context.clone() : context;
    const text = await res.text();
    if (!text) return fallback;
    try {
      const json = JSON.parse(text);
      return String(json?.error || json?.message || text || fallback);
    } catch {
      return text.length < 600 ? text : fallback;
    }
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, { requireSession: true, permissions: ["disputes.resolve"] });
    if (ctx instanceof Response) return ctx;

    const admin = supabaseAdminClient();
    const body = await req.json().catch(() => ({}));

    const order_id = String(body.order_id ?? "");
    const decision = String(body.decision ?? "").toUpperCase() as Decision;
    const note = body.note ? String(body.note) : null;

    if (!order_id) return bad("order_id required");
    if (!["REFUND", "RELEASE"].includes(decision)) return bad("decision must be REFUND or RELEASE");

    // Get order + dispute
    const { data: order, error: oe } = await admin
      .from("market_orders")
      .select("id,status,version,currency")
      .eq("id", order_id)
      .single();

    if (oe || !order) return bad("Order not found");
    const { data: piRows } = await admin
      .from("market_pi_payments")
      .select("id,status")
      .eq("order_id", order_id)
      .in("status", ["UNDERPAID", "SETTLED"])
      .limit(1);
    const isPiOrder = Array.isArray(piRows) && piRows.length > 0;

    const stableOrder = ["USDC", "USDT"].includes(String(order.currency || "").toUpperCase());
    if (order.currency !== "NGN" && !isPiOrder && !stableOrder) {
      return bad("Admin resolver supports NGN wallet, stable escrow, and PI testnet orders only");
    }

    const { data: dispute } = await admin
      .from("market_disputes")
      .select("id,status")
      .eq("order_id", order_id)
      .maybeSingle();

    if (!dispute) return bad("No dispute found for this order");
    if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) return bad("Dispute is not resolvable");

    // If decision = RELEASE: ensure order is DELIVERED (or set it delivered)
    let curVersion = Number(order.version);
    let curStatus = String(order.status);
    const forwardedHeaders = getForwardedAdminHeaders(req);

    if (decision === "RELEASE") {
      if (stableOrder) {
        const { data: releaseOut, error: releaseErr } = await admin.functions.invoke("market-stable-admin-settle", {
          body: { order_id, decision, note },
          headers: forwardedHeaders,
        });
        if (releaseErr) return bad(await functionInvokeErrorMessage(releaseErr));
        if (!(releaseOut as any)?.ok) {
          return bad(String((releaseOut as any)?.error || "Stable release function failed"));
        }

        await markDisputeSettlementSubmitted(admin, ctx, order_id, decision, note);
        return ok({ order: releaseOut, dispute_resolution: "RELEASE_TO_SELLER" });
      }

      if (isPiOrder) {
        const { data: releasedOut, error: releasedErr } = await admin.functions.invoke("market-pi-release-intent", {
          body: { order_id, note },
          headers: forwardedHeaders,
        });
        if (releasedErr) return bad(await functionInvokeErrorMessage(releasedErr));
        if (!(releasedOut as any)?.ok) {
          return bad(String((releasedOut as any)?.error || "Pi release function failed"));
        }

        await markDisputeResolved(admin, ctx, order_id, decision, note);
        return ok({ order: releasedOut, dispute_resolution: "RELEASE_TO_SELLER" });
      }

      if (curStatus === "DISPUTED" || curStatus === "OUT_FOR_DELIVERY" || curStatus === "DELIVERABLE_UPLOADED" || curStatus === "IN_ESCROW") {
        // Force to DELIVERED as admin decision basis (audit note)
        const { data: delivered, error: te } = await admin.rpc("market_transition_order_status", {
          p_order_id: order_id,
          p_expected_version: curVersion,
          p_new_status: "DELIVERED",
          p_note: note ?? "Admin set DELIVERED during dispute resolution",
        });
        if (te) return bad(te.message);
        curVersion = Number(delivered.version);
        curStatus = String(delivered.status);
      }

      if (curStatus !== "DELIVERED") return bad("Cannot release unless order is DELIVERED");

      const { data: released, error: re } = await admin.rpc("market_wallet_release_to_seller", {
        p_order_id: order_id,
        p_expected_version: curVersion,
      });
      if (re) return bad(re.message);

      // Resolve dispute
      await admin.from("market_disputes").update({
        status: "RESOLVED",
        resolution: "RELEASE_TO_SELLER",
        resolved_by: ctx.userId,
        resolved_at: new Date().toISOString(),
        resolution_note: note,
        updated_at: new Date().toISOString(),
      }).eq("order_id", order_id);

      await admin.from("market_audit_logs").insert({
        actor_id: ctx.userId,
        actor_type: "admin",
        action: "DISPUTE_RESOLVED_RELEASE",
        entity_type: "market_orders",
        entity_id: order_id,
        payload: { note, role_key: ctx.roleKey },
      });

      return ok({ order: released, dispute_resolution: "RELEASE_TO_SELLER" });
    }

    // decision === REFUND
    // refund allowed from IN_ESCROW/DELIVERED/DISPUTED (your SQL function enforces)
    if (stableOrder) {
      const { data: refundOut, error: refundErr } = await admin.functions.invoke("market-stable-admin-settle", {
        body: { order_id, decision, note },
        headers: forwardedHeaders,
      });
      if (refundErr) return bad(await functionInvokeErrorMessage(refundErr));
      if (!(refundOut as any)?.ok) {
        return bad(String((refundOut as any)?.error || "Stable refund function failed"));
      }

      await markDisputeSettlementSubmitted(admin, ctx, order_id, decision, note);
      return ok({ order: refundOut, dispute_resolution: "REFUND_TO_BUYER" });
    }

    if (isPiOrder) {
      const { data: refundedOut, error: refundedErr } = await admin.functions.invoke("market-pi-refund-intent", {
        body: { order_id, note },
        headers: forwardedHeaders,
      });
      if (refundedErr) return bad(await functionInvokeErrorMessage(refundedErr));
      if (!(refundedOut as any)?.ok) {
        return bad(String((refundedOut as any)?.error || "Pi refund function failed"));
      }

      await markDisputeResolved(admin, ctx, order_id, decision, note);
      return ok({ order: refundedOut, dispute_resolution: "REFUND_TO_BUYER" });
    }

    const { data: refunded, error: fe } = await admin.rpc("market_wallet_refund_buyer", {
      p_order_id: order_id,
      p_expected_version: curVersion,
      p_reason: note ?? "Admin refund during dispute resolution",
    });

    if (fe) return bad(fe.message);

    await admin.from("market_disputes").update({
      status: "RESOLVED",
      resolution: "REFUND_TO_BUYER",
      resolved_by: ctx.userId,
      resolved_at: new Date().toISOString(),
      resolution_note: note,
      updated_at: new Date().toISOString(),
    }).eq("order_id", order_id);

    await admin.from("market_audit_logs").insert({
      actor_id: ctx.userId,
      actor_type: "admin",
      action: "DISPUTE_RESOLVED_REFUND",
      entity_type: "market_orders",
      entity_id: order_id,
      payload: { note, role_key: ctx.roleKey },
    });

    return ok({ order: refunded, dispute_resolution: "REFUND_TO_BUYER" });
  } catch (e) {
    return adminError(e);
  }
});
