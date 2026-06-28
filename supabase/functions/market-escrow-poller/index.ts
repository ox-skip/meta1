import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { keccak256, stringToHex } from "https://esm.sh/viem@2.45.1";
import { envAny } from "../_shared/market/env.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import { applyChainDeposit } from "../_shared/market/chainDeposit.ts";

type ChainConfig = {
  chain: string;
  rpc_url: string | null;
  escrow_address: string | null;
  confirmations_required: number | null;
  usdc_address: string | null;
  usdt_address: string | null;
};

type ChainSync = { chain: string; last_block: number };

type RpcLog = {
  address?: string;
  topics?: string[];
  data?: string;
  transactionHash?: string;
  logIndex?: string | number;
  blockNumber?: string | number;
};

const TOPIC_DEPOSIT_MULTI = keccak256(stringToHex("EscrowDeposited(bytes32,address,address,address,uint256)"));
const TOPIC_RELEASE_MULTI = keccak256(stringToHex("EscrowReleased(bytes32,address,address,address,uint256)"));
const TOPIC_ARB_RELEASE_MULTI = keccak256(stringToHex("EscrowReleasedByArbiter(bytes32,address,address,address,uint256)"));
const TOPIC_REFUND_MULTI = keccak256(stringToHex("EscrowRefunded(bytes32,address,address,address,uint256)"));
const TOPIC_DEPOSIT_SINGLE = keccak256(stringToHex("EscrowDeposited(bytes32,address,address,uint256)"));
const TOPIC_RELEASE_SINGLE = keccak256(stringToHex("EscrowReleased(bytes32,address,address,uint256)"));
const TOPIC_ARB_RELEASE_SINGLE = keccak256(stringToHex("EscrowReleasedByArbiter(bytes32,address,address,uint256)"));
const TOPIC_REFUND_SINGLE = keccak256(stringToHex("EscrowRefunded(bytes32,address,address,uint256)"));

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const jsonRes = await res.json().catch(() => ({}));
  if (!res.ok || jsonRes?.error) throw new Error(jsonRes?.error?.message || `RPC ${method} failed`);
  return jsonRes?.result;
}

function toNum(hexOrNum: string | number | null | undefined): number {
  if (typeof hexOrNum === "number") return hexOrNum;
  if (!hexOrNum) return 0;
  const raw = String(hexOrNum);
  return raw.startsWith("0x") ? parseInt(raw, 16) : Number(raw);
}

function hexToAddress(topicHex?: string): string | null {
  if (!topicHex || !topicHex.startsWith("0x")) return null;
  return `0x${topicHex.slice(-40)}`.toLowerCase();
}

function hexToBigInt(hex?: string): bigint {
  if (!hex || !hex.startsWith("0x")) return 0n;
  return BigInt(hex);
}

function normalizeOrderKey(key: string | null | undefined) {
  const raw = String(key ?? "").toLowerCase().replace(/^0x/, "");
  return raw.padStart(64, "0");
}

function decodeData(dataHex?: string) {
  const data = String(dataHex ?? "");
  if (!data.startsWith("0x")) return { token: null, amountRaw: 0n };
  const payload = data.slice(2);
  if (payload.length >= 64 * 2) {
    const tokenSlot = payload.slice(0, 64);
    const amountSlot = payload.slice(64, 128);
    const token = `0x${tokenSlot.slice(24 * 2)}`.toLowerCase();
    const amountRaw = hexToBigInt(`0x${amountSlot}`);
    return { token, amountRaw };
  }
  if (payload.length >= 64) {
    const amountRaw = hexToBigInt(`0x${payload.slice(0, 64)}`);
    return { token: null, amountRaw };
  }
  return { token: null, amountRaw: 0n };
}

async function processLogs(
  admin: any,
  cfg: ChainConfig,
  logs: RpcLog[],
) {
  const expectedEscrow = String(cfg.escrow_address || "").toLowerCase();
  for (const log of logs) {
    const logAddress = String(log.address ?? "").toLowerCase();
    if (!expectedEscrow || logAddress !== expectedEscrow) continue;

    const topic0 = String(log.topics?.[0] ?? "").toLowerCase();
    const isDeposit = topic0 === TOPIC_DEPOSIT_MULTI || topic0 === TOPIC_DEPOSIT_SINGLE;
    const isRelease =
      topic0 === TOPIC_RELEASE_MULTI ||
      topic0 === TOPIC_ARB_RELEASE_MULTI ||
      topic0 === TOPIC_RELEASE_SINGLE ||
      topic0 === TOPIC_ARB_RELEASE_SINGLE;
    const isRefund = topic0 === TOPIC_REFUND_MULTI || topic0 === TOPIC_REFUND_SINGLE;
    if (!isDeposit && !isRelease && !isRefund) continue;

    const orderKey = String(log.topics?.[1] ?? "").toLowerCase();
    const orderKeyNo0x = orderKey.startsWith("0x") ? orderKey.slice(2) : orderKey;
    const buyer = hexToAddress(log.topics?.[2]);
    const seller = hexToAddress(log.topics?.[3]);
    const { token, amountRaw } = decodeData(log.data);
    const decimals = 6n;
    const amountUnits = Number(amountRaw) / Number(10n ** decimals);

    const { data: esc } = await admin
      .from("market_crypto_escrows")
      .select("order_id,order_key,token_address")
      .in("order_key", [
        orderKey,
        orderKeyNo0x,
        normalizeOrderKey(orderKey),
        normalizeOrderKey(orderKeyNo0x),
      ])
      .maybeSingle();

    const escrowRow = esc as { order_id: string; order_key: string; token_address?: string | null } | null;
    if (!escrowRow?.order_id) continue;

    const txHash = String(log.transactionHash ?? "");
    const logIndex = toNum(log.logIndex as any);
    const blockNumber = toNum(log.blockNumber as any);

    if (isDeposit) {
      const depositTokenAddr = (token || escrowRow.token_address || cfg.usdc_address || "").toLowerCase();
      try {
        const { error: applyErr } = await applyChainDeposit(admin, {
          orderId: escrowRow.order_id,
          chain: cfg.chain,
          buyerWallet: buyer,
          sellerWallet: seller,
          amountRaw: amountRaw ? amountRaw.toString() : null,
          amountUnits,
          txHash,
          logIndex,
          blockNumber,
          blockTime: null,
          raw: log,
          tokenAddress: depositTokenAddr,
        });
        if (applyErr) throw applyErr;
      } catch (e: any) {
        console.error("market-escrow-poller deposit apply failed", {
          chain: cfg.chain,
          order_id: escrowRow.order_id,
          txHash,
          logIndex,
          message: String(e?.message || e),
        });
      }
    }

    if (isRelease) {
      try {
        await admin.rpc("market_apply_chain_release", {
          p_order_id: escrowRow.order_id,
          p_tx_hash: txHash,
          p_log_index: logIndex,
          p_block_number: blockNumber,
          p_block_time: null,
          p_raw: log,
        });
      } catch (e: any) {
        console.error("market-escrow-poller release apply failed", {
          chain: cfg.chain,
          order_id: escrowRow.order_id,
          txHash,
          logIndex,
          message: String(e?.message || e),
        });
      }
    }

    if (isRefund) {
      try {
        await admin.rpc("market_apply_chain_refund", {
          p_order_id: escrowRow.order_id,
          p_tx_hash: txHash,
          p_log_index: logIndex,
          p_block_number: blockNumber,
          p_block_time: null,
          p_raw: log,
        });
      } catch (e: any) {
        console.error("market-escrow-poller refund apply failed", {
          chain: cfg.chain,
          order_id: escrowRow.order_id,
          txHash,
          logIndex,
          message: String(e?.message || e),
        });
      }
    }
  }
}

async function runDepositScan(admin: any, chains: ChainConfig[]) {
  const scanResults: Record<string, unknown> = {};

  for (const cfg of chains) {
    const rpcUrl = resolveRpcUrlForChain(cfg.chain, cfg.rpc_url);
    if (!rpcUrl || !cfg.escrow_address) {
      scanResults[cfg.chain] = { ok: false, reason: "rpc_url or escrow_address missing" };
      continue;
    }

    const { data: orders } = await admin
      .from("market_orders")
      .select("id")
      .eq("status", "CREATED")
      .gt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (!orders?.length) {
      scanResults[cfg.chain] = { ok: true, processed: 0, message: "No CREATED orders" };
      continue;
    }

    const orderIds = (orders as any[]).map((o) => o.id);
    const { data: escrows } = await admin
      .from("market_crypto_escrows")
      .select("order_id,order_key,deposited_tx_hash")
      .in("order_id", orderIds);

    const pending = (escrows as any[] ?? []).filter((e) => !e.deposited_tx_hash);
    if (pending.length === 0) {
      scanResults[cfg.chain] = { ok: true, processed: 0, message: "No pending deposits" };
      continue;
    }

    const latest = toNum(await rpcCall(rpcUrl, "eth_blockNumber", []));
    const required = Math.max(1, Number(cfg.confirmations_required ?? 1));
    const fromBlock = latest - required - 8000;

    const logs = (await rpcCall(rpcUrl, "eth_getLogs", [{
      address: cfg.escrow_address,
      fromBlock: `0x${Math.max(0, fromBlock).toString(16)}`,
      toBlock: `0x${latest.toString(16)}`,
      topics: [[TOPIC_DEPOSIT_MULTI, TOPIC_DEPOSIT_SINGLE]],
    }])) as RpcLog[];

    let appliedCount = 0;
    for (const log of logs ?? []) {
      const logAddr = String(log.address ?? "").toLowerCase();
      if (logAddr !== String(cfg.escrow_address).toLowerCase()) continue;

      const topic1 = String(log.topics?.[1] ?? "").toLowerCase();
      const orderKeyNo0x = topic1.startsWith("0x") ? topic1.slice(2) : topic1;
      
      const escrow = pending.find((e: any) => {
        const k = String(e.order_key ?? "").toLowerCase();
        return k === topic1 || k === orderKeyNo0x || k === normalizeOrderKey(topic1);
      });

      if (!escrow?.order_id) continue;

      const buyer = hexToAddress(log.topics?.[2]);
      const seller = hexToAddress(log.topics?.[3]);
      const { token, amountRaw } = decodeData(log.data);

      await applyChainDeposit(admin, {
        orderId: escrow.order_id,
        chain: cfg.chain,
        buyerWallet: buyer,
        sellerWallet: seller,
        amountRaw: amountRaw ? amountRaw.toString() : null,
        amountUnits: Number(amountRaw) / 1_000_000,
        txHash: String(log.transactionHash ?? ""),
        logIndex: toNum(log.logIndex),
        blockNumber: toNum(log.blockNumber),
        blockTime: null,
        raw: log,
        tokenAddress: (token || "").toLowerCase(),
      }).catch(() => null);
      
      appliedCount++;
    }

    scanResults[cfg.chain] = { chain: cfg.chain, ok: true, processed: appliedCount };
  }

  return scanResults;
}

serve(async (req) => {
  try {
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

    const admin = createClient(SB_URL, SB_SERVICE);

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "";

    const { data: chains, error: cfgErr } = await admin
      .from("market_chain_config")
      .select("chain,rpc_url,escrow_address,confirmations_required,usdc_address,usdt_address,active")
      .eq("active", true);

    if (cfgErr) return json(500, { ok: false, message: cfgErr.message });
    if (!chains?.length) return json(200, { ok: true, message: "No active chains" });

    const results: Record<string, unknown> = {};

    if (mode === "deposit_scan") {
      const scanResults = await runDepositScan(admin, chains as ChainConfig[]);
      return json(200, { ok: true, mode: "deposit_scan", results: scanResults });
    }

    for (const cfg of chains as ChainConfig[]) {
      const rpcUrl = resolveRpcUrlForChain(cfg.chain, cfg.rpc_url);
      if (!rpcUrl) {
        const prefix = String(cfg.chain || "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
        results[cfg.chain] = {
          ok: false,
          reason: "rpc_url missing",
          message: `Set market_chain_config.rpc_url, ${prefix}_RPC_URL, ${prefix}_MAINNET_RPC_URL, or ALCHEMY_API_KEY.`,
        };
        continue;
      }
      if (!cfg.escrow_address) {
        results[cfg.chain] = { ok: false, reason: "escrow_address missing" };
        continue;
      }

      const { data: syncRow } = await admin
        .from("market_chain_sync")
        .select("chain,last_block")
        .eq("chain", cfg.chain)
        .maybeSingle();

      const bootstrapBackfill = 20;
      const maxBlocksPerRun = 60;
      let lastBlock = Number((syncRow as ChainSync | null)?.last_block ?? 0);
      const hasSyncedBefore = lastBlock > 0;
      const latestHex = await rpcCall(rpcUrl, "eth_blockNumber", []);
      const latest = toNum(latestHex);
      const required = Math.max(1, Number(cfg.confirmations_required ?? 1));
      const toBlock = Math.max(0, latest - required + 1);

      const maxRange = 10;
      const backfillStart = Math.max(0, toBlock - bootstrapBackfill);
      let cursor = Math.max(0, lastBlock + 1);
      let truncated = false;
      let reset = false;

      if (lastBlock > toBlock) {
        lastBlock = backfillStart - 1;
        cursor = Math.max(0, lastBlock + 1);
        reset = true;
      }

      if (!hasSyncedBefore && cursor < backfillStart) {
        cursor = backfillStart;
        truncated = backfillStart > 0;
      }

      if (cursor > toBlock) {
        results[cfg.chain] = {
          ok: true,
          message: "No new confirmed blocks",
          latest,
          required,
          toBlock,
        };
        continue;
      }

      const runToBlock = Math.min(toBlock, cursor + maxBlocksPerRun - 1);
      let processed = 0;

      while (cursor <= runToBlock) {
        const end = Math.min(cursor + maxRange - 1, runToBlock);
        let logs: RpcLog[] = [];
        try {
          logs = (await rpcCall(rpcUrl, "eth_getLogs", [
            {
              address: cfg.escrow_address,
              fromBlock: `0x${cursor.toString(16)}`,
              toBlock: `0x${end.toString(16)}`,
              topics: [[
                TOPIC_DEPOSIT_MULTI,
                TOPIC_RELEASE_MULTI,
                TOPIC_ARB_RELEASE_MULTI,
                TOPIC_REFUND_MULTI,
                TOPIC_DEPOSIT_SINGLE,
                TOPIC_RELEASE_SINGLE,
                TOPIC_ARB_RELEASE_SINGLE,
                TOPIC_REFUND_SINGLE,
              ]],
            },
          ])) as RpcLog[];
        } catch (err: any) {
          const msg = String(err?.message || err);
          results[cfg.chain] = {
            ok: false,
            error: "rpc_throttled",
            message: msg,
            fromBlock: cursor,
            toBlock,
            latest,
            required,
          };
          return json(200, { ok: true, results });
        }

        await processLogs(admin, cfg, logs ?? []);
        processed += logs?.length ?? 0;
        cursor = end + 1;
      }

      await admin
        .from("market_chain_sync")
        .upsert({ chain: cfg.chain, last_block: runToBlock })
        .select();

      results[cfg.chain] = {
        ok: true,
        processed,
        fromBlock: cursor,
        toBlock: runToBlock,
        latest,
        required,
        truncated,
        reset,
      };
    }

    return json(200, { ok: true, results });
  } catch (err: any) {
    console.error("market-escrow-poller error:", err);
    return json(500, { ok: false, message: String(err?.message || err) });
  }
});