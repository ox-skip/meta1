import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

type CircleWallet = {
  id: string;
  chain?: string;
  address: string;
  blockchain: string;
  walletSetId?: string | null;
  accountType?: string | null;
  custodyType?: string | null;
  refId?: string | null;
  state?: string | null;
  userId?: string | null;
};

type UserContext = {
  supabaseUserId: string;
  circleUserId: string;
};

const CIRCLE_BASE_URL = String(Deno.env.get("CIRCLE_API_BASE_URL") || "https://api.circle.com").replace(/\/$/, "");
const CIRCLE_API_KEY = String(Deno.env.get("CIRCLE_API_KEY") || Deno.env.get("CIRCLE_WALLET_API_KEY") || "").trim();

const CHAIN_TO_CIRCLE: Record<string, string> = {
  ethereum: "ETH",
  eth: "ETH",
  sepolia: "ETH-SEPOLIA",
  base: "BASE",
  base_sepolia: "BASE-SEPOLIA",
  arbitrum: "ARB",
  arbitrum_sepolia: "ARB-SEPOLIA",
  optimism: "OP",
  optimism_sepolia: "OP-SEPOLIA",
  polygon: "MATIC",
  polygon_amoy: "MATIC-AMOY",
  avalanche: "AVAX",
  avax: "AVAX",
  avalanche_fuji: "AVAX-FUJI",
  arc: "ARC",
  arc_testnet: "ARC-TESTNET",
  monad: "MONAD",
  monad_testnet: "MONAD-TESTNET",
  unichain: "UNI",
  unichain_sepolia: "UNI-SEPOLIA",
};

const CIRCLE_TO_CHAIN: Record<string, string> = {
  ETH: "ethereum",
  "ETH-SEPOLIA": "sepolia",
  BASE: "base",
  "BASE-SEPOLIA": "base_sepolia",
  ARB: "arbitrum",
  "ARB-SEPOLIA": "arbitrum_sepolia",
  OP: "optimism",
  "OP-SEPOLIA": "optimism_sepolia",
  MATIC: "polygon",
  "MATIC-AMOY": "polygon_amoy",
  AVAX: "avalanche",
  "AVAX-FUJI": "avalanche_fuji",
  ARC: "arc",
  "ARC-TESTNET": "arc_testnet",
  MONAD: "monad",
  "MONAD-TESTNET": "monad_testnet",
  UNI: "unichain",
  "UNI-SEPOLIA": "unichain_sepolia",
};

function isConfigured() {
  return Boolean(CIRCLE_API_KEY);
}

function configuredOrResponse() {
  if (isConfigured()) return null;
  return ok({
    configured: false,
    wallets: [],
    balances: [],
    message: "Circle wallet API key is missing. Set CIRCLE_API_KEY in Supabase function secrets.",
  });
}

function circleUserIdForSupabaseUser(userId: string) {
  return `bc_${String(userId || "").replace(/-/g, "").slice(0, 32)}`;
}

function normalizeChain(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function circleBlockchainForChain(value: unknown) {
  return CHAIN_TO_CIRCLE[normalizeChain(value)] || "";
}

function chainForCircleBlockchain(blockchain: unknown, requestedChains: string[]) {
  const code = String(blockchain || "").trim().toUpperCase();
  const requestedMatch = requestedChains.find((chain) => circleBlockchainForChain(chain) === code);
  return requestedMatch || CIRCLE_TO_CHAIN[code] || code.toLowerCase().replace(/-/g, "_");
}

function isEvmAddress(value: unknown) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function isHexData(value: unknown) {
  return /^0x([a-fA-F0-9]{2})*$/.test(String(value || "").trim());
}

function randomIdempotencyKey() {
  return crypto.randomUUID();
}

function shortCircleError(json: any, text: string) {
  const candidates = [
    json?.message,
    json?.error?.message,
    json?.errors?.[0]?.message,
    json?.data?.message,
    text && text.length < 500 ? text : "",
  ];
  return candidates.map((value) => String(value || "").trim()).find(Boolean) || "Circle API request failed";
}

async function circleRequest<T>(
  path: string,
  input: {
    method?: string;
    userToken?: string | null;
    body?: unknown;
    query?: Record<string, unknown>;
  } = {},
) {
  const query = new URLSearchParams();
  Object.entries(input.query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });

  const url = `${CIRCLE_BASE_URL}${path}${query.toString() ? `?${query.toString()}` : ""}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${CIRCLE_API_KEY}`,
    "Content-Type": "application/json",
    "X-Request-Id": crypto.randomUUID(),
  };
  if (input.userToken) headers["X-User-Token"] = input.userToken;

  const res = await fetch(url, {
    method: input.method || "GET",
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });

  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = new Error(shortCircleError(json, text));
    (err as any).status = res.status;
    (err as any).body = json ?? text;
    throw err;
  }

  return json as T;
}

async function createCircleUserIfNeeded(circleUserId: string) {
  try {
    await circleRequest("/v1/w3s/users", {
      method: "POST",
      body: { userId: circleUserId },
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "").toLowerCase();
    if (msg.includes("already") || msg.includes("exist") || msg.includes("duplicate")) return;
    throw e;
  }
}

async function getCircleSession(ctx: UserContext) {
  await createCircleUserIfNeeded(ctx.circleUserId);
  const token = await circleRequest<{
    data?: { userToken?: string; encryptionKey?: string };
  }>("/v1/w3s/users/token", {
    method: "POST",
    body: { userId: ctx.circleUserId },
  });

  const userToken = String(token?.data?.userToken || "");
  const encryptionKey = String(token?.data?.encryptionKey || "");
  if (!userToken || !encryptionKey) {
    throw new Error("Circle did not return a user token.");
  }
  return { userToken, encryptionKey };
}

async function getCircleUserByToken(userToken: string) {
  return await circleRequest<{ data?: { pinStatus?: string; status?: string } }>("/v1/w3s/user", {
    userToken,
  });
}

async function listCircleWallets(userToken: string, blockchain?: string | null) {
  const out = await circleRequest<{ data?: { wallets?: CircleWallet[] } }>("/v1/w3s/wallets", {
    userToken,
    query: {
      blockchain: blockchain || undefined,
      pageSize: 50,
    },
  });
  return out?.data?.wallets ?? [];
}

async function readRequestedChains(admin: ReturnType<typeof supabaseAdminClient>, body: any) {
  const fromBody = Array.isArray(body?.chains)
    ? body.chains.map((chain: unknown) => normalizeChain(chain)).filter((chain: string) => circleBlockchainForChain(chain))
    : [];
  if (fromBody.length) return Array.from(new Set(fromBody));

  const { data } = await admin
    .from("market_chain_config")
    .select("chain")
    .eq("active", true);
  return Array.from(
    new Set(
      (data ?? [])
        .map((row: any) => normalizeChain(row?.chain))
        .filter((chain: string) => circleBlockchainForChain(chain)),
    ),
  );
}

function walletToResponse(wallet: any): CircleWallet {
  return {
    id: String(wallet?.provider_wallet_id || wallet?.id || ""),
    chain: normalizeChain(wallet?.chain),
    blockchain: String(wallet?.provider_blockchain || wallet?.blockchain || circleBlockchainForChain(wallet?.chain) || ""),
    address: String(wallet?.address || ""),
    walletSetId: wallet?.provider_wallet_set_id ?? wallet?.walletSetId ?? null,
    accountType: wallet?.account_type ?? wallet?.accountType ?? null,
    custodyType: wallet?.custody_type ?? wallet?.custodyType ?? null,
  };
}

async function upsertLocalWallet(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, chain: string, wallet: CircleWallet) {
  const fullRow = {
    user_id: ctx.supabaseUserId,
    chain,
    address: wallet.address,
    wallet_type: wallet.accountType === "SCA" ? "circle_sca" : "circle_eoa",
    provider: "circle",
    provider_wallet_id: wallet.id,
    provider_wallet_set_id: wallet.walletSetId ?? null,
    provider_user_id: ctx.circleUserId,
    provider_blockchain: wallet.blockchain,
    provider_ref_id: wallet.refId ?? null,
    account_type: wallet.accountType ?? null,
    custody_type: wallet.custodyType ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("crypto_wallets")
    .upsert(fullRow, { onConflict: "user_id,chain" });
  if (!error) return;

  const fallback = {
    user_id: ctx.supabaseUserId,
    chain,
    address: wallet.address,
    wallet_type: wallet.accountType === "SCA" ? "circle_sca" : "circle_eoa",
  };
  const second = await admin
    .from("crypto_wallets")
    .upsert(fallback, { onConflict: "user_id,chain" });
  if (!second.error) return;

  const minimal = await admin
    .from("crypto_wallets")
    .upsert(
      {
        user_id: ctx.supabaseUserId,
        chain,
        address: wallet.address,
      },
      { onConflict: "user_id,chain" },
    );
  if (minimal.error) throw minimal.error;
}

async function readLocalCircleWallets(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, requestedChains: string[]) {
  let query = admin
    .from("crypto_wallets")
    .select("*")
    .eq("user_id", ctx.supabaseUserId);
  if (requestedChains.length) query = query.in("chain", requestedChains);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? [])
    .filter((row: any) => {
      const provider = String(row?.provider || "").toLowerCase();
      const walletType = String(row?.wallet_type || "").toLowerCase();
      return provider === "circle" || walletType.startsWith("circle") || Boolean(row?.provider_wallet_id);
    })
    .map(walletToResponse)
    .filter((wallet) => wallet.id && isEvmAddress(wallet.address));
}

async function syncCircleWallets(
  admin: ReturnType<typeof supabaseAdminClient>,
  ctx: UserContext,
  userToken: string,
  requestedChains: string[],
) {
  const circleWallets = await listCircleWallets(userToken);
  const synced: CircleWallet[] = [];

  for (const wallet of circleWallets) {
    if (!wallet?.id || !isEvmAddress(wallet.address)) continue;
    const blockchain = String(wallet.blockchain || "").toUpperCase();
    const chain = chainForCircleBlockchain(blockchain, requestedChains);
    if (requestedChains.length && !requestedChains.includes(chain)) continue;

    const mapped: CircleWallet = {
      id: String(wallet.id),
      chain,
      blockchain,
      address: String(wallet.address),
      walletSetId: wallet.walletSetId ?? null,
      accountType: wallet.accountType ?? null,
      custodyType: wallet.custodyType ?? null,
      refId: wallet.refId ?? null,
      state: wallet.state ?? null,
      userId: wallet.userId ?? null,
    };
    await upsertLocalWallet(admin, ctx, chain, mapped);
    synced.push(mapped);
  }

  return synced;
}

function missingBlockchains(existing: CircleWallet[], requestedChains: string[]) {
  const have = new Set(existing.map((wallet) => String(wallet.blockchain || "").toUpperCase()));
  return requestedChains
    .map((chain) => circleBlockchainForChain(chain))
    .filter(Boolean)
    .filter((blockchain) => !have.has(blockchain));
}

async function walletForRequest(
  admin: ReturnType<typeof supabaseAdminClient>,
  ctx: UserContext,
  userToken: string,
  chain: string,
  walletId?: string | null,
) {
  let wallets = await readLocalCircleWallets(admin, ctx, [chain]);
  if (!wallets.length) {
    wallets = await syncCircleWallets(admin, ctx, userToken, [chain]);
  }

  const targetWalletId = String(walletId || "").trim();
  const wallet = targetWalletId
    ? wallets.find((row) => row.id === targetWalletId)
    : wallets.find((row) => row.chain === chain);

  if (!wallet?.id || !isEvmAddress(wallet.address)) {
    throw new Error(`No Circle wallet found for ${chain}. Create your Market wallet first.`);
  }
  return wallet;
}

function normalizeTokenAmount(input: unknown) {
  const text = String(input || "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("Amount must be a positive decimal number.");
  if (Number(text) <= 0) throw new Error("Amount must be greater than zero.");
  return text;
}

function tokenFromBalance(balance: any) {
  const token = balance?.token || {};
  return {
    symbol: String(token?.symbol || token?.name || "").toUpperCase(),
    amount: Number(balance?.amount || 0),
    decimals: Number.isFinite(Number(token?.decimals)) ? Number(token.decimals) : null,
    tokenAddress: token?.tokenAddress ? String(token.tokenAddress) : null,
    isNative: Boolean(token?.isNative),
  };
}

async function handleStatus(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const requestedChains = await readRequestedChains(admin, body);
  const wallets = await readLocalCircleWallets(admin, ctx, requestedChains);
  return ok({ configured: isConfigured(), wallets });
}

async function handleSync(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const configured = configuredOrResponse();
  if (configured) return configured;

  const requestedChains = await readRequestedChains(admin, body);
  const session = await getCircleSession(ctx);
  const wallets = await syncCircleWallets(admin, ctx, session.userToken, requestedChains);
  return ok({ configured: true, wallets });
}

async function handleCreateWallets(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const configured = configuredOrResponse();
  if (configured) return configured;

  const requestedChains = await readRequestedChains(admin, body);
  if (!requestedChains.length) return bad("No Circle-supported market chains are active.");

  const session = await getCircleSession(ctx);
  const existing = await listCircleWallets(session.userToken);
  const missing = missingBlockchains(existing, requestedChains);
  if (!missing.length) {
    const wallets = await syncCircleWallets(admin, ctx, session.userToken, requestedChains);
    return ok({ configured: true, requiresApproval: false, wallets });
  }

  const user = await getCircleUserByToken(session.userToken);
  const pinStatus = String(user?.data?.pinStatus || "").toUpperCase();
  const initializing = pinStatus !== "ENABLED";
  const path = initializing ? "/v1/w3s/user/initialize" : "/v1/w3s/user/wallets";

  const bodyOut = await circleRequest<{ data?: { challengeId?: string } }>(path, {
    method: "POST",
    userToken: session.userToken,
    body: {
      idempotencyKey: randomIdempotencyKey(),
      accountType: "SCA",
      blockchains: missing,
      metadata: missing.map((blockchain) => ({
        name: `Best City ${blockchain}`,
        refId: `market_${ctx.circleUserId}_${blockchain}`.slice(0, 120),
      })),
    },
  });

  return ok({
    configured: true,
    requiresApproval: true,
    challengeId: bodyOut?.data?.challengeId ?? null,
    userToken: session.userToken,
    encryptionKey: session.encryptionKey,
  });
}

async function handleBalances(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const configured = configuredOrResponse();
  if (configured) return configured;

  const requestedChains = await readRequestedChains(admin, body);
  const session = await getCircleSession(ctx);
  let wallets = await readLocalCircleWallets(admin, ctx, requestedChains);
  if (!wallets.length) {
    wallets = await syncCircleWallets(admin, ctx, session.userToken, requestedChains);
  }

  const balances = [];
  for (const wallet of wallets) {
    const out = await circleRequest<{ data?: { tokenBalances?: any[] } }>(`/v1/w3s/wallets/${encodeURIComponent(wallet.id)}/balances`, {
      userToken: session.userToken,
      query: {
        includeAll: true,
        pageSize: 50,
      },
    });
    const tokens = (out?.data?.tokenBalances ?? []).map(tokenFromBalance).filter((token) => token.symbol);
    const native = tokens.find((token) => token.isNative) ?? null;
    const usdc = tokens.find((token) => token.symbol === "USDC") ?? null;
    const usdt = tokens.find((token) => token.symbol === "USDT") ?? null;
    balances.push({
      chain: wallet.chain,
      blockchain: wallet.blockchain,
      address: wallet.address,
      walletId: wallet.id,
      native,
      usdc,
      usdt,
      tokens,
    });
  }

  return ok({ configured: true, balances });
}

async function handleContractExecution(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const configured = configuredOrResponse();
  if (configured) return configured;

  const chain = normalizeChain(body?.chain);
  const blockchain = circleBlockchainForChain(chain);
  if (!blockchain) return bad("Unsupported Circle chain.");

  const contractAddress = String(body?.contractAddress || "").trim();
  const callData = String(body?.callData || "").trim();
  if (!isEvmAddress(contractAddress)) return bad("contractAddress must be a valid EVM address.");
  if (!isHexData(callData)) return bad("callData must be even-length hex.");

  const session = await getCircleSession(ctx);
  const wallet = await walletForRequest(admin, ctx, session.userToken, chain, body?.walletId);
  const refId = String(body?.refId || crypto.randomUUID()).slice(0, 120);
  const requestBody: Record<string, unknown> = {
    idempotencyKey: randomIdempotencyKey(),
    walletId: wallet.id,
    contractAddress,
    callData,
    refId,
    feeLevel: String(body?.feeLevel || "MEDIUM").toUpperCase(),
  };
  if (body?.amount) requestBody.amount = String(body.amount);

  const out = await circleRequest<{ data?: { challengeId?: string } }>("/v1/w3s/user/transactions/contractExecution", {
    method: "POST",
    userToken: session.userToken,
    body: requestBody,
  });

  return ok({
    configured: true,
    requiresApproval: true,
    challengeId: out?.data?.challengeId ?? null,
    userToken: session.userToken,
    encryptionKey: session.encryptionKey,
    refId,
    walletId: wallet.id,
  });
}

async function handleTransfer(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const configured = configuredOrResponse();
  if (configured) return configured;

  const chain = normalizeChain(body?.chain);
  const blockchain = circleBlockchainForChain(chain);
  if (!blockchain) return bad("Unsupported Circle chain.");

  const tokenAddress = String(body?.tokenAddress || "").trim();
  const destinationAddress = String(body?.destinationAddress || "").trim();
  if (!isEvmAddress(tokenAddress)) return bad("tokenAddress must be a valid EVM address.");
  if (!isEvmAddress(destinationAddress)) return bad("destinationAddress must be a valid EVM address.");
  const amount = normalizeTokenAmount(body?.amount);

  const session = await getCircleSession(ctx);
  const wallet = await walletForRequest(admin, ctx, session.userToken, chain, body?.walletId);
  const refId = String(body?.refId || crypto.randomUUID()).slice(0, 120);

  const out = await circleRequest<{ data?: { challengeId?: string } }>("/v1/w3s/user/transactions/transfer", {
    method: "POST",
    userToken: session.userToken,
    body: {
      idempotencyKey: randomIdempotencyKey(),
      walletId: wallet.id,
      tokenAddress,
      blockchain,
      destinationAddress,
      amounts: [amount],
      refId,
      feeLevel: String(body?.feeLevel || "MEDIUM").toUpperCase(),
    },
  });

  return ok({
    configured: true,
    requiresApproval: true,
    challengeId: out?.data?.challengeId ?? null,
    userToken: session.userToken,
    encryptionKey: session.encryptionKey,
    refId,
    walletId: wallet.id,
  });
}

async function handleTransactionByRef(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const configured = configuredOrResponse();
  if (configured) return configured;

  const chain = normalizeChain(body?.chain);
  const refId = String(body?.refId || "").trim();
  const walletId = String(body?.walletId || "").trim();
  if (!refId) return bad("refId required.");
  if (!walletId) return bad("walletId required.");

  const session = await getCircleSession(ctx);
  await walletForRequest(admin, ctx, session.userToken, chain, walletId);

  const out = await circleRequest<{ data?: { transactions?: any[] } }>("/v1/w3s/transactions", {
    userToken: session.userToken,
    query: {
      walletIds: walletId,
      blockchain: circleBlockchainForChain(chain),
      txType: "OUTBOUND",
      pageSize: 50,
    },
  });

  const transactions = out?.data?.transactions ?? [];
  const transaction =
    transactions.find((tx: any) => String(tx?.refId || "") === refId) ||
    transactions.find((tx: any) => String(tx?.refId || "").includes(refId)) ||
    null;
  return ok({ configured: true, transaction });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) return unauth();

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "status").trim();
  const ctx: UserContext = {
    supabaseUserId: u.user.id,
    circleUserId: circleUserIdForSupabaseUser(u.user.id),
  };

  try {
    if (action === "status") return await handleStatus(admin, ctx, body);
    if (action === "sync_wallets") return await handleSync(admin, ctx, body);
    if (action === "create_wallets") return await handleCreateWallets(admin, ctx, body);
    if (action === "balances") return await handleBalances(admin, ctx, body);
    if (action === "contract_execution") return await handleContractExecution(admin, ctx, body);
    if (action === "transfer") return await handleTransfer(admin, ctx, body);
    if (action === "transaction_by_ref") return await handleTransactionByRef(admin, ctx, body);
    return bad(`Unknown Circle wallet action: ${action}`);
  } catch (e: any) {
    console.log("[circle-wallet]", action, String(e?.message || e));
    return bad(String(e?.message || e || "Circle wallet request failed."));
  }
});
