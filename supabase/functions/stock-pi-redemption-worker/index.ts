import { adminError, requireAdmin } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import {
  piCancelPayment,
  piCompletePayment,
  piCreateA2UPayment,
  piSubmitA2UPayment,
  toFixedString,
} from "../_shared/market/pi.ts";
import { hasBudgetForQueue, persistStockPiMetrics, resolveStockPiMetrics } from "../_shared/market/stockPi.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

function retryDelaySeconds(attemptCount: number) {
  return Math.min(3600, Math.max(30, 30 * (2 ** Math.max(0, attemptCount))));
}

async function safeAudit(admin: any, payload: Record<string, unknown>) {
  const { error } = await admin.from("market_audit_logs").insert(payload);
  if (error) {
    console.warn("[stock-pi-redemption-worker] audit insert skipped:", error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const blocked = await requireAdmin(req);
    if (blocked) return blocked;

    const admin = supabaseAdminClient();
    const body = await req.json().catch(() => ({}));
    const stockId = String(body?.stock_id ?? "").trim() || null;
    const stockLimit = Math.max(1, Math.min(25, Number(body?.stock_limit ?? 10) || 10));
    const dryRun = body?.dry_run === true;

    let stockQuery = admin
      .from("market_stock_pi_redemption_queue")
      .select("stock_id", { count: "exact" })
      .in("status", ["QUEUED", "PROCESSING"]);
    if (stockId) stockQuery = stockQuery.eq("stock_id", stockId);
    const { data: queueRows, error: queueErr } = await stockQuery.limit(200);
    if (queueErr) return bad(queueErr.message);

    const stockIds = Array.from(new Set((queueRows ?? []).map((row: any) => String(row.stock_id || "")).filter(Boolean))).slice(0, stockLimit);
    const results: any[] = [];

    for (const currentStockId of stockIds) {
      let metrics = await resolveStockPiMetrics(admin as any, currentStockId);
      await persistStockPiMetrics(admin as any, metrics);

      const { data: queueItems, error: itemsErr } = await admin
        .from("market_stock_pi_redemption_queue")
        .select("id,queue_seq,stock_id,user_id,order_id,quote_id,quote_ref,recipient_pi_uid,status,quantity_locked,locked_gross_usdc,locked_fee_usdc,locked_net_usdc,locked_net_payout_pi,attempt_count,next_retry_at")
        .eq("stock_id", currentStockId)
        .eq("status", "QUEUED")
        .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
        .order("priority", { ascending: false })
        .order("queue_seq", { ascending: true });
      if (itemsErr) throw new Error(itemsErr.message);

      let availableBudget = Number(metrics.available_budget_pi || 0);
      const processed: any[] = [];

      for (const item of queueItems ?? []) {
        if (!hasBudgetForQueue(metrics, Number((item as any).locked_net_payout_pi ?? 0))) break;
        if (availableBudget < Number((item as any).locked_net_payout_pi ?? 0)) break;

        const payoutAmountPi = Number((item as any).locked_net_payout_pi ?? 0);
        if (dryRun) {
          processed.push({
            queue_id: item.id,
            action: "would_process",
            payout_pi: payoutAmountPi,
          });
          availableBudget -= payoutAmountPi;
          continue;
        }

        const { data: claimRows, error: claimErr } = await admin
          .from("market_stock_pi_redemption_queue")
          .update({
            status: "PROCESSING",
            processing_started_at: new Date().toISOString(),
            attempt_count: Number((item as any).attempt_count ?? 0) + 1,
            last_error: null,
          })
          .eq("id", item.id)
          .eq("status", "QUEUED")
          .select("id,order_id,user_id,quote_id,quote_ref,recipient_pi_uid,locked_net_usdc,locked_net_payout_pi,quantity_locked,attempt_count")
          .limit(1);
        if (claimErr) {
          processed.push({ queue_id: item.id, action: "claim_failed", error: claimErr.message });
          continue;
        }

        const queue = (claimRows ?? [])[0];
        if (!queue) continue;

        let { data: payout, error: payoutErr } = await admin
          .from("market_stock_pi_payouts")
          .select("*")
          .eq("queue_id", queue.id)
          .maybeSingle();
        if (payoutErr) throw new Error(payoutErr.message);

        if (!payout) {
          const created = await admin
            .from("market_stock_pi_payouts")
            .insert({
              queue_id: queue.id,
              stock_id: currentStockId,
              user_id: queue.user_id,
              order_id: queue.order_id,
              status: "CREATED",
              amount_pi: queue.locked_net_payout_pi,
              amount_usd_snapshot: queue.locked_net_usdc,
              recipient_pi_uid: queue.recipient_pi_uid,
            })
            .select("*")
            .single();
          if (created.error || !created.data) throw new Error(created.error?.message ?? "Unable to create payout row");
          payout = created.data;
        }

        let paymentId = String((payout as any)?.payment_id || "").trim();
        let txid = String((payout as any)?.txid || "").trim();

        try {
          if (!paymentId) {
            const createdPayment = await piCreateA2UPayment({
              amount: Number(toFixedString(payoutAmountPi, 8)),
              memo: `BestCity stock sell ${queue.order_id}`,
              metadata: {
                queue_id: queue.id,
                quote_ref: queue.quote_ref,
                stock_id: currentStockId,
                rail: "pi",
              },
              uid: queue.recipient_pi_uid,
            });
            paymentId = String((createdPayment as any)?.identifier || "").trim();
            if (!paymentId) throw new Error("PI payout create failed: missing payment id");

            const { error: updCreateErr } = await admin
              .from("market_stock_pi_payouts")
              .update({
                payment_id: paymentId,
                raw: { created_payment: createdPayment },
              })
              .eq("id", payout.id);
            if (updCreateErr) throw new Error(updCreateErr.message);
          }

          if (!txid) {
            const submitted = await piSubmitA2UPayment(paymentId);
            txid = String((submitted as any)?.txid || "").trim();
            if (!txid) throw new Error("PI payout submit failed: missing txid");

            const { error: submitErr } = await admin
              .from("market_stock_pi_payouts")
              .update({
                status: "SUBMITTED",
                txid,
                submitted_at: new Date().toISOString(),
                raw: { submitted_payment: submitted },
              })
              .eq("id", payout.id);
            if (submitErr) throw new Error(submitErr.message);
          }

          const completed = await piCompletePayment(paymentId, txid);
          const verified =
            (completed as any)?.status?.developer_completed === true &&
            (completed as any)?.status?.transaction_verified === true;
          if (!verified) throw new Error("PI payout completion failed verification");

          const { error: updCompleteErr } = await admin
            .from("market_stock_pi_payouts")
            .update({
              payment_id: paymentId,
              txid,
              raw: { completed_payment: completed },
            })
            .eq("id", payout.id);
          if (updCompleteErr) throw new Error(updCompleteErr.message);

          const idemKey = `stock:pi:payout:confirm:${queue.id}:${paymentId}:${txid}`;
          const { data: finalizeRes, error: finalizeErr } = await admin.rpc("market_stock_pi_finalize_payout", {
            p_payout_id: payout.id,
            p_idempotency_key: idemKey,
            p_metadata: {
              payment_id: paymentId,
              txid,
              completed_payment: completed,
            },
          });
          if (finalizeErr) throw new Error(finalizeErr.message);

          await safeAudit(admin, {
            actor_id: null,
            actor_type: "system",
            action: "STOCK_PI_PAYOUT_CONFIRMED",
            entity_type: "market_stock_identities",
            entity_id: currentStockId,
            payload: {
              order_id: queue.order_id,
              queue_id: queue.id,
              payout_id: payout.id,
              payment_id: paymentId,
              txid,
              trade_id: (finalizeRes as any)?.[0]?.trade_id ?? null,
            },
          });

          processed.push({
            queue_id: queue.id,
            action: "confirmed",
            payout_id: payout.id,
            payment_id: paymentId,
            txid,
          });
          availableBudget -= payoutAmountPi;
          metrics = await resolveStockPiMetrics(admin as any, currentStockId);
          await persistStockPiMetrics(admin as any, metrics);
        } catch (e: any) {
          const reason = String(e?.message || e || "Pi stock payout failed");
          if (paymentId && !txid) {
            await piCancelPayment(paymentId).catch(() => null);
          }

          await admin
            .from("market_stock_pi_payouts")
            .update({
              status: "FAILED",
              payment_id: paymentId || null,
              txid: txid || null,
              failure_reason: reason,
              failed_at: new Date().toISOString(),
            })
            .eq("id", payout.id);

          const nextRetryAt = new Date(Date.now() + retryDelaySeconds(Number(queue.attempt_count ?? 0)) * 1000).toISOString();
          await admin
            .from("market_stock_pi_redemption_queue")
            .update({
              status: "QUEUED",
              next_retry_at: nextRetryAt,
              last_error: reason,
              updated_at: new Date().toISOString(),
            })
            .eq("id", queue.id)
            .eq("status", "PROCESSING");

          const retryKey = `stock:pi:queue:retry:${queue.id}:${Number(queue.attempt_count ?? 0) + 1}`;
          await admin.from("market_stock_pi_ledger_events").insert({
            stock_id: currentStockId,
            user_id: queue.user_id,
            order_id: queue.order_id,
            quote_id: queue.quote_id,
            queue_id: queue.id,
            payout_id: payout.id,
            event_type: "QUEUE_RETRY",
            idempotency_key: retryKey,
            amount_usdc: queue.locked_net_usdc,
            amount_pi: queue.locked_net_payout_pi,
            metadata: {
              reason,
              next_retry_at: nextRetryAt,
            },
          }).then(() => null).catch(() => null);

          await safeAudit(admin, {
            actor_id: null,
            actor_type: "system",
            action: "STOCK_PI_PAYOUT_RETRY_SCHEDULED",
            entity_type: "market_stock_identities",
            entity_id: currentStockId,
            payload: {
              order_id: queue.order_id,
              queue_id: queue.id,
              payout_id: payout.id,
              payment_id: paymentId || null,
              txid: txid || null,
              reason,
              next_retry_at: nextRetryAt,
            },
          });

          processed.push({
            queue_id: queue.id,
            action: "retry_scheduled",
            error: reason,
            next_retry_at: nextRetryAt,
          });
        }
      }

      results.push({
        stock_id: currentStockId,
        metrics,
        available_budget_pi: availableBudget,
        processed,
      });
    }

    return ok({
      ok: true,
      dry_run: dryRun,
      stocks: results,
    });
  } catch (e) {
    return adminError(e);
  }
});
