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

type CircleEnvName = "testnet" | "mainnet";

type CircleEnvConfig = {
  env: CircleEnvName;
  apiKey: string;
  baseUrl: string;
};

type CircleSession = {
  env: CircleEnvName;
  userToken: string;
  encryptionKey: string;
};

type CircleApprovalChallenge = CircleSession & {
  challengeId: string | null;
};

type CircleChainRequest = {
  chain: string;
  blockchain: string;
  env: CircleEnvName;
};

function envAny(keys: string[]) {
  return keys.map((key) => String(Deno.env.get(key) || "").trim()).find(Boolean) || "";
}

const LEGACY_CIRCLE_API_KEY = envAny(["CIRCLE_API_KEY", "CIRCLE_WALLET_API_KEY"]);
const LEGACY_CIRCLE_API_BASE_URL = String(Deno.env.get("CIRCLE_API_BASE_URL") || "").trim();

function legacyKeyForEnv(env: CircleEnvName) {
  if (!LEGACY_CIRCLE_API_KEY) return "";
  const upper = LEGACY_CIRCLE_API_KEY.toUpperCase();
  if (upper.startsWith("TEST_API_KEY")) return env === "testnet" ? LEGACY_CIRCLE_API_KEY : "";
  if (upper.startsWith("LIVE_API_KEY")) return env === "mainnet" ? LEGACY_CIRCLE_API_KEY : "";
  if (LEGACY_CIRCLE_API_BASE_URL.toLowerCase().includes("sandbox")) return env === "testnet" ? LEGACY_CIRCLE_API_KEY : "";
  return env === "mainnet" ? LEGACY_CIRCLE_API_KEY : "";
}

function baseUrlForEnv(env: CircleEnvName, usingLegacyKey: boolean) {
  const explicit =
    env === "testnet"
      ? envAny(["CIRCLE_TESTNET_API_BASE_URL", "CIRCLE_SANDBOX_API_BASE_URL", "CIRCLE_TEST_API_BASE_URL"])
      : envAny(["CIRCLE_MAINNET_API_BASE_URL", "CIRCLE_LIVE_API_BASE_URL"]);
  if (explicit) return explicit.replace(/\/$/, "");
  if (usingLegacyKey && LEGACY_CIRCLE_API_BASE_URL) return LEGACY_CIRCLE_API_BASE_URL.replace(/\/$/, "");
  return "https://api.circle.com";
}

function circleEnvConfig(env: CircleEnvName): CircleEnvConfig | null {
  const explicit =
    env === "testnet"
      ? envAny([
          "CIRCLE_TESTNET_API_KEY",
          "CIRCLE_SANDBOX_API_KEY",
          "CIRCLE_TEST_API_KEY",
          "CIRCLE_WALLET_TESTNET_API_KEY",
          "CIRCLE_WALLET_SANDBOX_API_KEY",
        ])
      : envAny(["CIRCLE_MAINNET_API_KEY", "CIRCLE_LIVE_API_KEY", "CIRCLE_WALLET_MAINNET_API_KEY", "CIRCLE_WALLET_LIVE_API_KEY"]);
  const legacy = legacyKeyForEnv(env);
  const apiKey = explicit || legacy;
  if (!apiKey) return null;
  return { env, apiKey, baseUrl: baseUrlForEnv(env, !explicit && Boolean(legacy)) };
}

const CIRCLE_ENVS: Record<CircleEnvName, CircleEnvConfig | null> = {
  testnet: circleEnvConfig("testnet"),
  mainnet: circleEnvConfig("mainnet"),
};

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

const TESTNET_CHAIN_TO_CIRCLE: Record<string, string> = {
  ethereum: "ETH-SEPOLIA",
  eth: "ETH-SEPOLIA",
  sepolia: "ETH-SEPOLIA",
  base: "BASE-SEPOLIA",
  base_sepolia: "BASE-SEPOLIA",
  arbitrum: "ARB-SEPOLIA",
  arbitrum_sepolia: "ARB-SEPOLIA",
  optimism: "OP-SEPOLIA",
  optimism_sepolia: "OP-SEPOLIA",
  polygon: "MATIC-AMOY",
  polygon_amoy: "MATIC-AMOY",
  avalanche: "AVAX-FUJI",
  avax: "AVAX-FUJI",
  avalanche_fuji: "AVAX-FUJI",
  arc: "ARC-TESTNET",
  arc_testnet: "ARC-TESTNET",
  monad: "MONAD-TESTNET",
  monad_testnet: "MONAD-TESTNET",
  unichain: "UNI-SEPOLIA",
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
  return Boolean(CIRCLE_ENVS.testnet || CIRCLE_ENVS.mainnet);
}

function configuredOrResponse(chains: CircleChainRequest[] = []) {
  const hasMatchingEnv = chains.length
    ? chains.some((chain) => Boolean(circleConfigForChainRequest(chain)))
    : isConfigured();
  if (hasMatchingEnv) return null;
  const wanted = Array.from(new Set(chains.map((chain) => chain.env))).filter(Boolean);
  const keyHint =
    wanted.length === 1 && wanted[0] === "testnet"
      ? "Set CIRCLE_TESTNET_API_KEY in Supabase function secrets."
      : wanted.length === 1 && wanted[0] === "mainnet"
        ? "Set CIRCLE_MAINNET_API_KEY in Supabase function secrets."
        : "Set CIRCLE_TESTNET_API_KEY and/or CIRCLE_MAINNET_API_KEY in Supabase function secrets.";
  return ok({
    configured: false,
    wallets: [],
    balances: [],
    message: `Circle wallet API key is missing for the requested chain environment. ${keyHint}`,
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

function circleRequestForChain(value: unknown, isTestnet?: boolean | null): CircleChainRequest | null {
  const chain = normalizeChain(value);
  const defaultBlockchain = circleBlockchainForChain(chain);
  const blockchain = isTestnet
    ? TESTNET_CHAIN_TO_CIRCLE[chain] || (circleEnvForBlockchain(defaultBlockchain) === "testnet" ? defaultBlockchain : "")
    : defaultBlockchain;
  if (!chain || !blockchain) return null;
  return {
    chain,
    blockchain,
    env: isTestnet ? "testnet" : circleEnvForBlockchain(blockchain),
  };
}

function circleEnvForBlockchain(blockchain: unknown): CircleEnvName {
  const code = String(blockchain || "").trim().toUpperCase();
  return /-(SEPOLIA|AMOY|FUJI|TESTNET|DEVNET)$/.test(code) ? "testnet" : "mainnet";
}

function circleConfigForChainRequest(chain: CircleChainRequest) {
  return CIRCLE_ENVS[chain.env];
}

function groupConfiguredChainsByEnv(chains: CircleChainRequest[]) {
  const groups: Record<CircleEnvName, CircleChainRequest[]> = { testnet: [], mainnet: [] };
  for (const chain of chains) {
    if (CIRCLE_ENVS[chain.env]) groups[chain.env].push(chain);
  }
  return (["testnet", "mainnet"] as CircleEnvName[])
    .map((env) => ({ env, config: CIRCLE_ENVS[env], chains: groups[env] }))
    .filter((group): group is { env: CircleEnvName; config: CircleEnvConfig; chains: CircleChainRequest[] } => Boolean(group.config && group.chains.length));
}

function chainForCircleBlockchain(blockchain: unknown, requestedChains: CircleChainRequest[]) {
  const code = String(blockchain || "").trim().toUpperCase();
  const requestedMatch = requestedChains.find((chain) => chain.blockchain === code);
  return requestedMatch?.chain || CIRCLE_TO_CHAIN[code] || code.toLowerCase().replace(/-/g, "_");
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

function circleCredentialHint(config: CircleEnvConfig) {
  const host = (() => {
    try {
      return new URL(config.baseUrl).host;
    } catch {
      return config.baseUrl;
    }
  })();
  return config.env === "testnet"
    ? `Circle testnet credentials were rejected by ${host}. Use a TEST_API_KEY with https://api.circle.com for Circle Wallets.`
    : `Circle mainnet credentials were rejected by ${host}. Use a LIVE_API_KEY with https://api.circle.com.`;
}

function validateCircleCredentialPair(config: CircleEnvConfig) {
  const key = config.apiKey.toUpperCase();
  const base = config.baseUrl.toLowerCase();
  if (config.env === "testnet") {
    if (key.startsWith("LIVE_API_KEY")) throw new Error(circleCredentialHint(config));
  } else {
    if (key.startsWith("TEST_API_KEY")) throw new Error(circleCredentialHint(config));
    if (base.includes("sandbox")) throw new Error(circleCredentialHint(config));
  }
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
  config: CircleEnvConfig,
  path: string,
  input: {
    method?: string;
    userToken?: string | null;
    body?: unknown;
    query?: Record<string, unknown>;
  } = {},
) {
  validateCircleCredentialPair(config);

  const query = new URLSearchParams();
  Object.entries(input.query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });

  const url = `${config.baseUrl}${path}${query.toString() ? `?${query.toString()}` : ""}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "X-Request-Id": crypto.randomUUID(),
  };
  if (input.userToken) headers["X-User-Token"] = input.userToken;

  console.log(`[Circle Request] ${input.method || "GET"} ${url}`);
  if (input.body) console.log(`[Circle Request Body]`, JSON.stringify(input.body));

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
    console.error(`[Circle Error] Status: ${res.status}`, json || text);
    const rawMessage = shortCircleError(json, text);
    const err = new Error(res.status === 401 || res.status === 403 ? circleCredentialHint(config) : rawMessage);
    (err as any).status = res.status;
    (err as any).body = json ?? text;
    throw err;
  }

  return json as T;
}

async function createCircleUserIfNeeded(config: CircleEnvConfig, circleUserId: string) {
  try {
    await circleRequest(config, "/v1/w3s/users", {
      method: "POST",
      body: { userId: circleUserId },
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "").toLowerCase();
    const status = Number(e?.status || 0);
    const body = e?.body;
    const code = typeof body === "object" && body !== null ? Number(body.code) : 0;
    
    // 155101/155102 are Circle error codes for "Existing user already created"
    if (status === 409 || code === 155101 || code === 155102 || msg.includes("already") || msg.includes("exist")) {
      console.log(`[Circle] User ${circleUserId} already exists (Status: ${status}, Code: ${code}). Continuing...`);
      return;
    }
    throw e;
  }
}

async function getCircleSession(ctx: UserContext, config: CircleEnvConfig): Promise<CircleSession> {
  await createCircleUserIfNeeded(config, ctx.circleUserId);
  const token = await circleRequest<{
    data?: { userToken?: string; encryptionKey?: string };
  }>(config, "/v1/w3s/users/token", {
    method: "POST",
    body: { userId: ctx.circleUserId },
  });

  const userToken = String(token?.data?.userToken || "");
  const encryptionKey = String(token?.data?.encryptionKey || "");
  if (!userToken || !encryptionKey) {
    throw new Error("Circle did not return a user token.");
  }
  return { env: config.env, userToken, encryptionKey };
}

async function getCircleUserByToken(config: CircleEnvConfig, userToken: string) {
  return await circleRequest<{ data?: { pinStatus?: string; status?: string } }>(config, "/v1/w3s/user", {
    userToken,
  });
}

async function listCircleWallets(config: CircleEnvConfig, userToken: string, blockchain?: string | null) {
  const out = await circleRequest<{ data?: { wallets?: CircleWallet[] } }>(config, "/v1/w3s/wallets", {
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
    ? body.chains
        .map((chain: unknown) => normalizeChain(typeof chain === "object" && chain !== null ? (chain as any).chain : chain))
        .filter((chain: string) => circleBlockchainForChain(chain))
    : [];

  let query = admin
    .from("market_chain_config")
    .select("chain,is_testnet")
    .eq("active", true);
  if (fromBody.length) query = query.in("chain", Array.from(new Set(fromBody)));

  const { data, error } = await query;
  if (error) throw error;
  return Array.from(
    new Map(
      (data ?? [])
        .map((row: any) => circleRequestForChain(row?.chain, Boolean(row?.is_testnet)))
        .filter((chain: CircleChainRequest | null): chain is CircleChainRequest => Boolean(chain))
        .map((chain: CircleChainRequest) => [chain.chain, chain]),
    ).values(),
  );
}

async function readRequestedChain(admin: ReturnType<typeof supabaseAdminClient>, chain: unknown) {
  const chains = await readRequestedChains(admin, { chains: [chain] });
  return chains[0] ?? null;
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

async function readLocalCircleWallets(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, requestedChains: CircleChainRequest[]) {
  let query = admin
    .from("crypto_wallets")
    .select("*")
    .eq("user_id", ctx.supabaseUserId);
  if (requestedChains.length) query = query.in("chain", requestedChains.map((chain) => chain.chain));

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
  config: CircleEnvConfig,
  userToken: string,
  requestedChains: CircleChainRequest[],
) {
  const circleWallets = await listCircleWallets(config, userToken);
  const synced: CircleWallet[] = [];

  for (const wallet of circleWallets) {
    if (!wallet?.id || !isEvmAddress(wallet.address)) continue;
    const blockchain = String(wallet.blockchain || "").toUpperCase();
    const requested = requestedChains.find((chain) => chain.blockchain === blockchain);
    if (requestedChains.length && !requested) continue;
    const chain = requested?.chain || chainForCircleBlockchain(blockchain, requestedChains);

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

function missingBlockchains(existing: CircleWallet[], requestedChains: CircleChainRequest[]) {
  const have = new Set(existing.map((wallet) => String(wallet.blockchain || "").toUpperCase()));
  return requestedChains
    .map((chain) => chain.blockchain)
    .filter(Boolean)
    .filter((blockchain) => !have.has(blockchain));
}

async function walletForRequest(
  admin: ReturnType<typeof supabaseAdminClient>,
  ctx: UserContext,
  config: CircleEnvConfig,
  userToken: string,
  chain: CircleChainRequest,
  walletId?: string | null,
) {
  let wallets = await readLocalCircleWallets(admin, ctx, [chain]);
  if (!wallets.length) {
    wallets = await syncCircleWallets(admin, ctx, config, userToken, [chain]);
  }

  const targetWalletId = String(walletId || "").trim();
  const wallet = targetWalletId
    ? wallets.find((row) => row.id === targetWalletId)
    : wallets.find((row) => row.chain === chain.chain);

  if (!wallet?.id || !isEvmAddress(wallet.address)) {
    throw new Error(`No Circle wallet found for ${chain.chain}. Create your Market wallet first.`);
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
  return ok({ configured: requestedChains.length ? requestedChains.some((chain) => Boolean(circleConfigForChainRequest(chain))) : isConfigured(), wallets });
}

async function handleSync(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const requestedChains = await readRequestedChains(admin, body);
  const configured = configuredOrResponse(requestedChains);
  if (configured) return configured;

  const wallets: CircleWallet[] = [];
  for (const group of groupConfiguredChainsByEnv(requestedChains)) {
    const session = await getCircleSession(ctx, group.config);
    wallets.push(...(await syncCircleWallets(admin, ctx, group.config, session.userToken, group.chains)));
  }
  return ok({ configured: true, wallets });
}

async function handleCreateWallets(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const requestedChains = await readRequestedChains(admin, body);
  if (!requestedChains.length) return bad("No Circle-supported market chains are active.");
  const configured = configuredOrResponse(requestedChains);
  if (configured) return configured;

  const wallets: CircleWallet[] = [];
  const challenges: CircleApprovalChallenge[] = [];

  for (const group of groupConfiguredChainsByEnv(requestedChains)) {
    const session = await getCircleSession(ctx, group.config);
    const existing = await listCircleWallets(group.config, session.userToken);
    const missing = missingBlockchains(existing, group.chains);
    if (!missing.length) {
      wallets.push(...(await syncCircleWallets(admin, ctx, group.config, session.userToken, group.chains)));
      continue;
    }

    const user = await getCircleUserByToken(group.config, session.userToken);
    const pinStatus = String(user?.data?.pinStatus || "").toUpperCase();
    const initializing = pinStatus !== "ENABLED";
    const path = initializing ? "/v1/w3s/user/initialize" : "/v1/w3s/user/wallets";

    const bodyOut = await circleRequest<{ data?: { challengeId?: string } }>(group.config, path, {
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

    challenges.push({
      env: group.env,
      challengeId: bodyOut?.data?.challengeId ?? null,
      userToken: session.userToken,
      encryptionKey: session.encryptionKey,
    });
  }

  if (!challenges.length) {
    return ok({ configured: true, requiresApproval: false, wallets });
  }

  const first = challenges[0];

  return ok({
    configured: true,
    requiresApproval: true,
    challengeId: first.challengeId,
    userToken: first.userToken,
    encryptionKey: first.encryptionKey,
    challenges,
  });
}

async function handleBalances(admin: ReturnType<typeof supabaseAdminClient>, ctx: UserContext, body: any) {
  const requestedChains = await readRequestedChains(admin, body);
  const configured = configuredOrResponse(requestedChains);
  if (configured) return configured;

  let wallets = await readLocalCircleWallets(admin, ctx, requestedChains);
  if (!wallets.length) {
    wallets = [];
    for (const group of groupConfiguredChainsByEnv(requestedChains)) {
      const session = await getCircleSession(ctx, group.config);
      wallets.push(...(await syncCircleWallets(admin, ctx, group.config, session.userToken, group.chains)));
    }
  }

  const sessions = new Map<CircleEnvName, CircleSession>();
  const requestsByChain = new Map(requestedChains.map((chain) => [chain.chain, chain]));
  const balances = [];
  for (const wallet of wallets) {
    const walletChain = normalizeChain(wallet.chain);
    const request = requestsByChain.get(walletChain) || circleRequestForChain(walletChain, circleEnvForBlockchain(wallet.blockchain) === "testnet");
    if (!request) continue;
    const config = circleConfigForChainRequest(request);
    if (!config) continue;
    let session = sessions.get(config.env);
    if (!session) {
      session = await getCircleSession(ctx, config);
      sessions.set(config.env, session);
    }
    const out = await circleRequest<{ data?: { tokenBalances?: any[] } }>(config, `/v1/w3s/wallets/${encodeURIComponent(wallet.id)}/balances`, {
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
  const chain = await readRequestedChain(admin, body?.chain);
  if (!chain) return bad("Unsupported or inactive Circle chain.");
  const configured = configuredOrResponse([chain]);
  if (configured) return configured;

  const blockchain = chain.blockchain;
  if (!blockchain) return bad("Unsupported Circle chain.");
  const config = circleConfigForChainRequest(chain);
  if (!config) return configuredOrResponse([chain]) ?? bad("Circle wallet API key is missing for this chain environment.");

  const contractAddress = String(body?.contractAddress || "").trim();
  const callData = String(body?.callData || "").trim();
  if (!isEvmAddress(contractAddress)) return bad("contractAddress must be a valid EVM address.");
  if (!isHexData(callData)) return bad("callData must be even-length hex.");

  const session = await getCircleSession(ctx, config);
  const wallet = await walletForRequest(admin, ctx, config, session.userToken, chain, body?.walletId);
  const rawRef = String(body?.refId || crypto.randomUUID());
  const refId = rawRef.length > 64 ? rawRef.slice(-64) : rawRef;

  const requestBody: Record<string, unknown> = {
    idempotencyKey: randomIdempotencyKey(),
    walletId: wallet.id,
    contractAddress,
    callData,
    refId,
    feeLevel: String(body?.feeLevel || "MEDIUM").toUpperCase(),
  };
  if (body?.amount && Number(body.amount) > 0) requestBody.amount = String(body.amount);

  const out = await circleRequest<{ data?: { challengeId?: string } }>(config, "/v1/w3s/user/transactions/contractExecution", {
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
  const chain = await readRequestedChain(admin, body?.chain);
  if (!chain) return bad("Unsupported or inactive Circle chain.");
  const configured = configuredOrResponse([chain]);
  if (configured) return configured;

  const blockchain = chain.blockchain;
  if (!blockchain) return bad("Unsupported Circle chain.");
  const config = circleConfigForChainRequest(chain);
  if (!config) return configuredOrResponse([chain]) ?? bad("Circle wallet API key is missing for this chain environment.");

  const tokenAddress = String(body?.tokenAddress || "").trim();
  const destinationAddress = String(body?.destinationAddress || "").trim();
  if (!isEvmAddress(tokenAddress)) return bad("tokenAddress must be a valid EVM address.");
  if (!isEvmAddress(destinationAddress)) return bad("destinationAddress must be a valid EVM address.");
  const amount = normalizeTokenAmount(body?.amount);

  const session = await getCircleSession(ctx, config);
  const wallet = await walletForRequest(admin, ctx, config, session.userToken, chain, body?.walletId);

  const rawRef = String(body?.refId || crypto.randomUUID());
  const refId = rawRef.length > 64 ? rawRef.slice(-64) : rawRef;

  const out = await circleRequest<{ data?: { challengeId?: string } }>(config, "/v1/w3s/user/transactions/transfer", {
    method: "POST",
    userToken: session.userToken,
    body: {
      idempotencyKey: randomIdempotencyKey(),
      userId: ctx.circleUserId,
      walletId: wallet.id,
      tokenAddress,
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
  const chain = await readRequestedChain(admin, body?.chain);
  if (!chain) return bad("Unsupported or inactive Circle chain.");
  const configured = configuredOrResponse([chain]);
  if (configured) return configured;
  const config = circleConfigForChainRequest(chain);
  if (!config) return configuredOrResponse([chain]) ?? bad("Circle wallet API key is missing for this chain environment.");

  const refId = String(body?.refId || "").trim();
  const walletId = String(body?.walletId || "").trim();
  if (!refId) return bad("refId required.");
  if (!walletId) return bad("walletId required.");

  const session = await getCircleSession(ctx, config);

  console.log(`[handleTransactionByRef] Searching for refId: ${refId}`);

  // Try to query transactions using refId and walletId when possible to find the matching transaction faster.
  // Increase pageSize to cover more results in a single call.
  const out = await circleRequest<{ data?: { transactions?: any[] } }>(config, "/v1/w3s/transactions", {
    userToken: session.userToken,
    query: {
      pageSize: 200,
      refId: refId || undefined,
      walletId: walletId || undefined,
    },
  });

  const transactions = out?.data?.transactions ?? [];
  const targetRef = refId.toLowerCase();
  
  const transaction =
    transactions.find((tx: any) => String(tx?.refId || "").toLowerCase() === targetRef) ||
    transactions.find((tx: any) => {
      const txRef = String(tx?.refId || "").toLowerCase();
      return txRef && targetRef && (txRef.includes(targetRef) || targetRef.includes(txRef));
    }) ||
    null;

  if (transaction) {
    console.log(`[handleTransactionByRef] Found transaction: ${transaction.id} state: ${transaction.state}`);
  }

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
