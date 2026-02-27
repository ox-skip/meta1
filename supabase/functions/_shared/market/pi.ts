import * as StellarSdk from "https://esm.sh/stellar-sdk@13.3.0";

const PI_PRICE_FEED_URL_DEFAULT = "https://api.coingecko.com/api/v3/simple/price?ids=pi-network&vs_currencies=usd";
const PI_API_BASE_DEFAULT = "https://api.minepi.com";
const PI_MAINNET_HORIZON_DEFAULT = "https://api.mainnet.minepi.com";
const PI_TESTNET_HORIZON_DEFAULT = "https://api.testnet.minepi.com";

export function toSafeNumber(input: unknown, fallback = 0) {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

export function roundDown(value: number, decimals = 8) {
  const f = 10 ** decimals;
  return Math.floor(value * f) / f;
}

export function roundUp(value: number, decimals = 8) {
  const f = 10 ** decimals;
  return Math.ceil(value * f) / f;
}

export function clampPositive(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function nowPlusSeconds(seconds: number) {
  return new Date(Date.now() + Math.max(0, Math.floor(seconds)) * 1000).toISOString();
}

export function randomQuoteRef() {
  return crypto.randomUUID();
}

export function toFixedString(value: number, decimals = 8) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toFixed(decimals);
}

export async function getPiUsdPrice() {
  const fixedRaw =
    Deno.env.get("PI_FIXED_PRICE_USD") ||
    Deno.env.get("PI_TESTNET_PRICE_USD") ||
    "";
  const fixed = toSafeNumber(fixedRaw, 0);

  const mode = String(Deno.env.get("PI_PRICE_MODE") || "").trim().toLowerCase();
  if (fixed > 0 && mode === "fixed") return fixed;

  const url = String(Deno.env.get("PI_PRICE_FEED_URL") || PI_PRICE_FEED_URL_DEFAULT).trim();
  if (url) {
    try {
      const res = await fetch(url, { method: "GET" });
      const json = await res.json().catch(() => ({}));
      const apiPrice = toSafeNumber((json as any)?.["pi-network"]?.usd, 0);
      if (res.ok && apiPrice > 0) return apiPrice;
    } catch {
      // fallback below
    }
  }

  if (fixed > 0) return fixed;
  throw new Error("Unable to resolve PI/USD price. Set PI_TESTNET_PRICE_USD or configure PI_PRICE_FEED_URL.");
}

function piApiBase() {
  return String(Deno.env.get("PI_API_BASE_URL") || PI_API_BASE_DEFAULT).trim().replace(/\/+$/, "");
}

function piWalletPrivateSeed() {
  const seed =
    Deno.env.get("PI_WALLET_PRIVATE_SEED") ||
    Deno.env.get("PI_APP_WALLET_PRIVATE_SEED") ||
    "";
  return String(seed).trim();
}

function piHorizonUrlForNetwork(networkName: string) {
  const isMainnet = String(networkName || "").trim().toLowerCase() === "pi network";
  if (isMainnet) {
    return String(Deno.env.get("PI_MAINNET_HORIZON_URL") || PI_MAINNET_HORIZON_DEFAULT).trim();
  }
  return String(Deno.env.get("PI_TESTNET_HORIZON_URL") || PI_TESTNET_HORIZON_DEFAULT).trim();
}

function piApiKey() {
  const key =
    Deno.env.get("PI_API_KEY") ||
    Deno.env.get("PI_PLATFORM_API_KEY") ||
    "";
  return String(key).trim();
}

async function piApiCall(path: string, method: "GET" | "POST", body?: Record<string, unknown>) {
  const key = piApiKey();
  if (!key) throw new Error("Missing PI_API_KEY for server-side Pi callbacks.");

  const res = await fetch(`${piApiBase()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${key}`,
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      String((json as any)?.message || (json as any)?.error || "").trim() ||
      `Pi API ${method} ${path} failed (${res.status})`;
    throw new Error(msg);
  }

  return json;
}

export async function piGetPayment(paymentId: string) {
  return await piApiCall(`/v2/payments/${paymentId}`, "GET");
}

export async function piGetIncompleteServerPayments() {
  return await piApiCall("/v2/payments/incomplete_server_payments", "GET");
}

export async function piApprovePayment(paymentId: string) {
  return await piApiCall(`/v2/payments/${paymentId}/approve`, "POST");
}

export async function piCompletePayment(paymentId: string, txid: string) {
  return await piApiCall(`/v2/payments/${paymentId}/complete`, "POST", { txid });
}

export async function piCancelPayment(paymentId: string) {
  return await piApiCall(`/v2/payments/${paymentId}/cancel`, "POST");
}

export async function piCreateA2UPayment(input: {
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
  uid: string;
}) {
  const amount = toSafeNumber(input?.amount, 0);
  const memo = String(input?.memo || "").trim();
  const uid = String(input?.uid || "").trim();
  const metadata = (input?.metadata ?? {}) as Record<string, unknown>;

  if (!Number.isFinite(amount) || amount <= 0) throw new Error("A2U amount must be greater than zero.");
  if (!memo) throw new Error("A2U memo is required.");
  if (!uid) throw new Error("A2U recipient uid is required.");

  return await piApiCall("/v2/payments", "POST", {
    payment: {
      amount,
      memo,
      metadata,
      uid,
    },
  });
}

export async function piSubmitA2UPayment(paymentId: string) {
  const id = String(paymentId || "").trim();
  if (!id) throw new Error("paymentId is required");

  const payment = await piGetPayment(id);
  const existingTxid = String((payment as any)?.transaction?.txid || "").trim();
  if (existingTxid) return { payment, txid: existingTxid, reused: true };

  const seed = piWalletPrivateSeed();
  if (!seed) throw new Error("Missing PI_WALLET_PRIVATE_SEED for A2U submission.");

  const keypair = StellarSdk.Keypair.fromSecret(seed);
  const fromAddress = String((payment as any)?.from_address || "").trim();
  const toAddress = String((payment as any)?.to_address || "").trim();
  const amount = toSafeNumber((payment as any)?.amount, 0);
  const networkName = String((payment as any)?.network || "Pi Testnet").trim();
  const paymentIdentifier = String((payment as any)?.identifier || id).trim();

  if (!fromAddress || fromAddress !== keypair.publicKey()) {
    throw new Error("A2U submit failed: wallet private seed does not match payment sender address.");
  }
  if (!toAddress) throw new Error("A2U submit failed: payment recipient address missing.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("A2U submit failed: invalid payment amount.");

  const horizonUrl = piHorizonUrlForNetwork(networkName);
  const server = new (StellarSdk as any).Server(horizonUrl);

  const account = await server.loadAccount(keypair.publicKey());
  const baseFee = await server.fetchBaseFee();
  const timebounds = await server.fetchTimebounds(180);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: String(baseFee),
    networkPassphrase: networkName,
    timebounds,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: toAddress,
        asset: StellarSdk.Asset.native(),
        amount: String(amount),
      }),
    )
    .addMemo(StellarSdk.Memo.text(paymentIdentifier))
    .build();

  tx.sign(keypair);
  const submitRes = await server.submitTransaction(tx);
  const txid = String((submitRes as any)?.id || (submitRes as any)?.hash || "").trim();
  if (!txid) throw new Error("A2U submit failed: txid missing from Horizon response.");

  return { payment, txid, reused: false, submit_response: submitRes };
}

export async function piCreateSubmitCompleteA2UPayment(input: {
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
  uid: string;
}) {
  const created = await piCreateA2UPayment(input);
  const paymentId = String((created as any)?.identifier || "").trim();
  if (!paymentId) throw new Error("A2U create failed: payment id missing.");

  const submitted = await piSubmitA2UPayment(paymentId);
  const txid = String((submitted as any)?.txid || "").trim();
  if (!txid) throw new Error("A2U submit failed: txid missing.");

  const completed = await piCompletePayment(paymentId, txid);
  return {
    payment_id: paymentId,
    txid,
    created,
    submitted,
    completed,
  };
}

export function readPiQuoteTtlSeconds() {
  return Math.max(30, Math.min(900, Math.floor(toSafeNumber(Deno.env.get("PI_QUOTE_TTL_SECONDS"), 180))));
}

export function readPiQuoteBufferBps() {
  return Math.max(0, Math.min(500, Math.floor(toSafeNumber(Deno.env.get("PI_QUOTE_BUFFER_BPS"), 0))));
}

export function addBps(amount: number, bps: number) {
  return amount * (1 + bps / 10000);
}

export function sumPaidUsd(rows: Array<{ status?: string | null; paid_usd?: number | null }>) {
  return rows.reduce((acc, row) => {
    const status = String(row.status || "").toUpperCase();
    if (status !== "UNDERPAID" && status !== "SETTLED") return acc;
    const v = toSafeNumber(row.paid_usd, 0);
    return acc + (v > 0 ? v : 0);
  }, 0);
}
