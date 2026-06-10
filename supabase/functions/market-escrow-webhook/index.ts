import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { envAny } from "../_shared/market/env.ts";
import {
  decodeEscrowData,
  hexToAddress,
  normalizeOrderKey,
  topicsForEscrowEvent,
  type RpcLog as AlchemyLog,
} from "../_shared/market/escrowEvents.ts";
import { applyChainDeposit } from "../_shared/market/chainDeposit.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, GET, HEAD, OPTIONS",
    },
  });
}

function normalizeChain(input: unknown): string | null {
  const raw = String(input ?? "").toLowerCase().trim();
  if (!raw) return null;

  if (raw.includes("8453") || raw === "base") return "base";
  if (raw.includes("42161") || raw === "arbitrum") return "arbitrum";
  if (raw.includes("137") || raw === "polygon") return "polygon";
  if (raw.includes("56") || raw === "bnb") return "bnb";
  if (raw.includes("10") || raw === "optimism") return "optimism";
  if (raw.includes("1") || raw === "ethereum") return "ethereum";

  return null;
}

function toIsoOrNull(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  const d = new Date(String(input));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function extractLogs(payload: any): AlchemyLog[] {
  const logs: AlchemyLog[] = [];
  const pushLog = (entry: any, ctx: Partial<AlchemyLog> = {}) => {
    const topics = entry?.topics;
    if (!Array.isArray(topics) || topics.length === 0) return;
    const out: AlchemyLog = {
      address: String(entry?.address ?? entry?.account?.address ?? ctx.address ?? "").toLowerCase() || undefined,
      topics: topics.map((t: any) => String(t).toLowerCase()),
      data: typeof entry?.data === "string" ? entry.data : undefined,
      transactionHash: String(entry?.transactionHash ?? entry?.transaction?.hash ?? ctx.transactionHash ?? ""),
      logIndex: Number(entry?.logIndex ?? entry?.index ?? ctx.logIndex ?? 0),
      blockNumber: Number(entry?.blockNumber ?? entry?.block?.number ?? ctx.blockNumber ?? 0),
      blockTimestamp: String(entry?.blockTimestamp ?? ctx.blockTimestamp ?? ""),
    };
    logs.push(out);
  };

  const act = payload?.event?.activity;
  if (Array.isArray(act)) {
    for (const item of act) {
      pushLog(item?.log);
      pushLog(item?.rawContract);
    }
  }

  if (Array.isArray(payload?.event?.logs)) {
    for (const item of payload.event.logs) pushLog(item);
  }
  if (payload?.event?.log) pushLog(payload.event.log);
  if (Array.isArray(payload?.logs)) {
    for (const item of payload.logs) pushLog(item);
  }
  if (payload?.log) pushLog(payload.log);

  // Alchemy Custom Webhook (GraphQL) commonly nests logs under event.data.block.logs.
  const gqlBlock = payload?.event?.data?.block;
  if (gqlBlock) {
    const blockCtx: Partial<AlchemyLog> = {
      blockNumber: Number(gqlBlock?.number ?? 0),
      blockTimestamp: String(gqlBlock?.timestamp?.iso8601 ?? ""),
    };
    if (Array.isArray(gqlBlock?.logs)) {
      for (const entry of gqlBlock.logs) {
        pushLog(entry, blockCtx);
        if (Array.isArray(entry?.transaction?.logs)) {
          const txHash = String(entry?.transaction?.hash ?? "");
          for (const txLog of entry.transaction.logs) {
            pushLog(txLog, { ...blockCtx, transactionHash: txHash });
          }
        }
      }
    }
  }

  // Generic GraphQL fallback if query returns event.data.logs directly.
  if (Array.isArray(payload?.event?.data?.logs)) {
    for (const item of payload.event.data.logs) pushLog(item);
  }

  return logs.filter((l) => Array.isArray(l.topics) && l.topics.length > 0);
}

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json(200, {
        ok: true,
        service: "market-escrow-webhook",
        method: req.method,
        message: "healthcheck",
      });
    }

    const SB_URL = envAny(["SB_URL", "SUPABASE_URL", "sb_url"], "");
    const SB_SERVICE = envAny(
      ["SB_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "sb_secret_key", "sb_scret_key"],
      "",
    );
    if (!SB_URL || !SB_SERVICE) {
      return json(500, {
        ok: false,
        message: "Missing env vars",
        hasSB_URL: !!SB_URL,
        hasSB_SERVICE_ROLE_KEY: !!SB_SERVICE,
      });
    }

    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      return json(200, { ok: true, message: "Empty payload" });
    }

    const webhookSecret = String(Deno.env.get("MARKET_ESCROW_WEBHOOK_SECRET") || "").trim();
    const providedSecret = String(req.headers.get("x-webhook-secret") || "").trim();
    if (!webhookSecret) {
      return json(500, { ok: false, message: "MARKET_ESCROW_WEBHOOK_SECRET env var not set" });
    }
    if (providedSecret !== webhookSecret) {
      return json(401, { ok: false, message: "Unauthorized webhook" });
    }

    const admin = createClient(SB_URL, SB_SERVICE);
    const chain = normalizeChain(payload?.event?.network ?? payload?.network ?? payload?.event?.chainId);
    if (!chain) return json(200, { ok: true, message: "Unsupported or missing chain" });

    const logs = extractLogs(payload);
    if (!logs.length) return json(200, { ok: true, message: "No logs" });

    const { data: cfg } = await admin
      .from("market_chain_config")
      .select("chain,escrow_address,usdc_address,usdt_address")
      .eq("chain", chain)
      .maybeSingle();
    if (!cfg?.escrow_address) return json(200, { ok: true, message: "Chain config missing escrow address" });

    const escrowAddress = String(cfg.escrow_address).toLowerCase();
    const depositTopics = topicsForEscrowEvent("DEPOSIT");
    const releaseTopics = topicsForEscrowEvent("RELEASE");
    const refundTopics = topicsForEscrowEvent("REFUND");

    for (const log of logs) {
      const logAddress = String(log.address ?? "").toLowerCase();
      if (logAddress !== escrowAddress) continue;

      const topic0 = String(log.topics?.[0] ?? "").toLowerCase();
      const isDeposit = depositTopics.includes(topic0);
      const isRelease = releaseTopics.includes(topic0);
      const isRefund = refundTopics.includes(topic0);
      if (!isDeposit && !isRelease && !isRefund) continue;

      const orderKey = String(log.topics?.[1] ?? "").toLowerCase();
      const orderKeyNo0x = orderKey.startsWith("0x") ? orderKey.slice(2) : orderKey;
      const buyer = hexToAddress(log.topics?.[2]);
      const seller = hexToAddress(log.topics?.[3]);
      const { token, amountRaw } = decodeEscrowData(log.data);
      const decimals = 6n; // USDC/USDT use 6 decimals on supported mainnet chains
      const amountUnits = Number(amountRaw) / Number(10n ** decimals);

      const { data: esc } = await admin
        .from("market_crypto_escrows")
        .select("order_id,order_key,token_address")
        .in("order_key", [orderKey, orderKeyNo0x, normalizeOrderKey(orderKey), normalizeOrderKey(orderKeyNo0x)])
        .maybeSingle();

      if (!esc?.order_id) {
        console.warn("escrow not found for order_key", orderKey);
        continue;
      }
      const tokenAddr = (token || esc.token_address || cfg?.usdc_address || "").toLowerCase();

      const txHash = String(log.transactionHash ?? "");
      const logIndex = Number(log.logIndex ?? 0);
      const blockNumber = Number(log.blockNumber ?? 0);
      const blockTime = toIsoOrNull(log.blockTimestamp);

      if (isDeposit) {
        try {
          const { error: applyErr } = await applyChainDeposit(admin, {
            orderId: esc.order_id,
            chain,
            buyerWallet: buyer,
            sellerWallet: seller,
            amountRaw: amountRaw ? amountRaw.toString() : null,
            amountUnits,
            txHash,
            logIndex,
            blockNumber,
            blockTime,
            raw: log,
            tokenAddress: tokenAddr || esc.token_address || null,
          });
          if (applyErr) throw applyErr;
        } catch (e: any) {
          console.error("market-escrow-webhook deposit apply failed", {
            chain,
            order_id: esc.order_id,
            txHash,
            logIndex,
            message: String(e?.message || e),
          });
        }
      }

      if (isRelease) {
        try {
          await admin.rpc("market_apply_chain_release", {
            p_order_id: esc.order_id,
            p_tx_hash: txHash,
            p_log_index: logIndex,
            p_block_number: blockNumber,
            p_block_time: blockTime,
            p_raw: log,
          });
        } catch (e: any) {
          console.error("market-escrow-webhook release apply failed", {
            chain,
            order_id: esc.order_id,
            txHash,
            logIndex,
            message: String(e?.message || e),
          });
        }
      }

      if (isRefund) {
        try {
          await admin.rpc("market_apply_chain_refund", {
            p_order_id: esc.order_id,
            p_tx_hash: txHash,
            p_log_index: logIndex,
            p_block_number: blockNumber,
            p_block_time: blockTime,
            p_raw: log,
          });
        } catch (e: any) {
          console.error("market-escrow-webhook refund apply failed", {
            chain,
            order_id: esc.order_id,
            txHash,
            logIndex,
            message: String(e?.message || e),
          });
        }
      }
    }

    return json(200, { ok: true, processed: logs.length });
  } catch (err) {
    console.error("market-escrow-webhook error:", err);
    return json(500, { ok: false, message: "Server error" });
  }
});
