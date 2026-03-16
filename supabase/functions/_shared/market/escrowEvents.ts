import { keccak256, stringToHex } from "https://esm.sh/viem@2.45.1";

export type EscrowEventType = "DEPOSIT" | "RELEASE" | "REFUND";

export type RpcLog = {
  address?: string;
  topics?: string[];
  data?: string;
  transactionHash?: string;
  logIndex?: string | number;
  blockNumber?: string | number;
  blockTimestamp?: string;
};

export type RpcReceipt = {
  status?: string | number;
  blockNumber?: string | number;
  logs?: RpcLog[];
};

const TOPIC_DEPOSIT_MULTI: string = keccak256(stringToHex("EscrowDeposited(bytes32,address,address,address,uint256)"));
const TOPIC_RELEASE_MULTI: string = keccak256(stringToHex("EscrowReleased(bytes32,address,address,address,uint256)"));
const TOPIC_ARB_RELEASE_MULTI: string = keccak256(stringToHex("EscrowReleasedByArbiter(bytes32,address,address,address,uint256)"));
const TOPIC_REFUND_MULTI: string = keccak256(stringToHex("EscrowRefunded(bytes32,address,address,address,uint256)"));

const TOPIC_DEPOSIT_SINGLE: string = keccak256(stringToHex("EscrowDeposited(bytes32,address,address,uint256)"));
const TOPIC_RELEASE_SINGLE: string = keccak256(stringToHex("EscrowReleased(bytes32,address,address,uint256)"));
const TOPIC_ARB_RELEASE_SINGLE: string = keccak256(stringToHex("EscrowReleasedByArbiter(bytes32,address,address,uint256)"));
const TOPIC_REFUND_SINGLE: string = keccak256(stringToHex("EscrowRefunded(bytes32,address,address,uint256)"));

export function topicsForEscrowEvent(eventType: EscrowEventType) {
  if (eventType === "DEPOSIT") return [TOPIC_DEPOSIT_MULTI, TOPIC_DEPOSIT_SINGLE];
  if (eventType === "RELEASE") {
    return [TOPIC_RELEASE_MULTI, TOPIC_ARB_RELEASE_MULTI, TOPIC_RELEASE_SINGLE, TOPIC_ARB_RELEASE_SINGLE];
  }
  return [TOPIC_REFUND_MULTI, TOPIC_REFUND_SINGLE];
}

export async function rpcCall(rpcUrl: string, method: string, params: unknown[]) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new Error(json?.error?.message || `RPC ${method} failed`);
  return json?.result;
}

export function toNum(hexOrNum: string | number | null | undefined): number {
  if (typeof hexOrNum === "number") return hexOrNum;
  if (!hexOrNum) return 0;
  const raw = String(hexOrNum);
  return raw.startsWith("0x") ? parseInt(raw, 16) : Number(raw);
}

export function normalizeOrderKey(key: string | null | undefined) {
  const raw = String(key ?? "").toLowerCase().replace(/^0x/, "");
  return raw.padStart(64, "0");
}

export function hexToAddress(topicHex?: string): string | null {
  if (!topicHex || !topicHex.startsWith("0x")) return null;
  return `0x${topicHex.slice(-40)}`.toLowerCase();
}

export function hexToBigInt(hex?: string): bigint {
  if (!hex || !hex.startsWith("0x")) return 0n;
  return BigInt(hex);
}

export function decodeEscrowData(dataHex?: string) {
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

export function findEscrowEventLog(
  receipt: RpcReceipt | null | undefined,
  escrowAddress: string,
  orderKey: string,
  eventType: EscrowEventType,
) {
  const wantAddress = String(escrowAddress || "").trim().toLowerCase();
  const wantOrderKey = normalizeOrderKey(orderKey);
  const topics = topicsForEscrowEvent(eventType);

  for (const log of receipt?.logs ?? []) {
    const addr = String(log.address ?? "").trim().toLowerCase();
    const topic0 = String(log.topics?.[0] ?? "").trim().toLowerCase();
    const topic1 = normalizeOrderKey(String(log.topics?.[1] ?? ""));
    if (addr === wantAddress && topics.includes(topic0) && topic1 === wantOrderKey) {
      return log;
    }
  }

  return null;
}
