import { adminError, requireAdmin } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

type Decision = "REFUND" | "RELEASE";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const authFail = requireAdmin(req);
    if (authFail) return authFail;

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

    if (order.currency !== "NGN" && !isPiOrder) {
      return bad("Admin resolver supports NGN wallet and PI testnet orders only");
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

    if (decision === "RELEASE") {
      if (isPiOrder) {
        const { data: released, error: te } = await admin.rpc("market_transition_order_status", {
          p_order_id: order_id,
          p_expected_version: curVersion,
          p_new_status: "RELEASED",
          p_note: note ?? "Admin released PI escrow during dispute resolution",
        });
        if (te) return bad(te.message);

        await admin.from("market_disputes").update({
          status: "RESOLVED",
          resolution: "RELEASE_TO_SELLER",
          resolved_by: null,
        }).eq("order_id", order_id);

        await admin.from("market_audit_logs").insert({
          actor_id: null,
          actor_type: "admin",
          action: "DISPUTE_RESOLVED_RELEASE_PI",
          entity_type: "market_orders",
          entity_id: order_id,
          payload: { note },
        });

        return ok({ order: released, dispute_resolution: "RELEASE_TO_SELLER" });
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
        resolved_by: null,
      }).eq("order_id", order_id);

      await admin.from("market_audit_logs").insert({
        actor_id: null,
        actor_type: "admin",
        action: "DISPUTE_RESOLVED_RELEASE",
        entity_type: "market_orders",
        entity_id: order_id,
        payload: { note },
      });

      return ok({ order: released, dispute_resolution: "RELEASE_TO_SELLER" });
    }

    // decision === REFUND
    // refund allowed from IN_ESCROW/DELIVERED/DISPUTED (your SQL function enforces)
    if (isPiOrder) {
      const { data: refunded, error: te } = await admin.rpc("market_transition_order_status", {
        p_order_id: order_id,
        p_expected_version: curVersion,
        p_new_status: "REFUNDED",
        p_note: note ?? "Admin refunded PI escrow during dispute resolution",
      });
      if (te) return bad(te.message);

      await admin.from("market_disputes").update({
        status: "RESOLVED",
        resolution: "REFUND_TO_BUYER",
        resolved_by: null,
      }).eq("order_id", order_id);

      await admin.from("market_audit_logs").insert({
        actor_id: null,
        actor_type: "admin",
        action: "DISPUTE_RESOLVED_REFUND_PI",
        entity_type: "market_orders",
        entity_id: order_id,
        payload: { note },
      });

      return ok({ order: refunded, dispute_resolution: "REFUND_TO_BUYER" });
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
      resolved_by: null,
    }).eq("order_id", order_id);

    await admin.from("market_audit_logs").insert({
      actor_id: null,
      actor_type: "admin",
      action: "DISPUTE_RESOLVED_REFUND",
      entity_type: "market_orders",
      entity_id: order_id,
      payload: { note },
    });

    return ok({ order: refunded, dispute_resolution: "REFUND_TO_BUYER" });
  } catch (e) {
    return adminError(e);
  }
});
