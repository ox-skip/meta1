import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import { keccak_256 } from "https://esm.sh/@noble/hashes@1.3.3/sha3";
import {
  isSupportedEvmStockChain,
  readErc20TotalSupply,
  readFactoryCreationSettings,
  readPoolSnapshot,
} from "../_shared/market/stockEvm.ts";

const IDENTITY_CREATED_SIG =
  "IdentityCreated(bytes32,address,address,address,address,address,uint24,string,string)";

const IDENTITY_CREATED_TOPIC0 = `0x${
  Array.from(keccak_256(new TextEncoder().encode(IDENTITY_CREATED_SIG)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}`;

function isHexTxHash(v: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(v || ""));
}

function isBytes32(v: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(v || ""));
}

function isAddress(v: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || ""));
}

function norm(v: string) {
  return String(v || "").toLowerCase();
}

function bytes32Topic(v: string) {
  const clean = String(v || "").replace(/^0x/i, "").toLowerCase();
  return `0x${clean.padStart(64, "0")}`;
}

function parseAddressWord(wordHex: string) {
  if (wordHex.length !== 64) return null;
  const addr = `0x${wordHex.slice(24)}`;
  return isAddress(addr) ? addr : null;
}

function parseIdentityCreatedData(dataHex: string) {
  const clean = String(dataHex || "").replace(/^0x/i, "");
  if (clean.length < 64 * 6) return null;
  const token = parseAddressWord(clean.slice(0, 64));
  const vault = parseAddressWord(clean.slice(64, 128));
  const staking = parseAddressWord(clean.slice(128, 192));
  const pool = parseAddressWord(clean.slice(192, 256));
  const stable = parseAddressWord(clean.slice(256, 320));
  if (!token || !vault || !staking || !pool || !stable) return null;
  return { token, vault, staking, pool, stable };
}

function storeKeyForStoreId(storeId: string) {
  const hash = keccak_256(new TextEncoder().encode(String(storeId || "").trim()));
  return `0x${Array.from(hash).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function selector4(signature: string) {
  const hash = keccak_256(new TextEncoder().encode(signature));
  return `0x${Array.from(hash.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const FACTORY_IDENTITIES_SELECTOR = selector4("identities(bytes32)");

async function readIdentityFromFactory(
  rpcUrl: string,
  factoryAddress: string,
  storeKey: string,
) {
  const keyClean = String(storeKey || "").replace(/^0x/i, "").toLowerCase();
  if (keyClean.length !== 64) return null;
  const data = `${FACTORY_IDENTITIES_SELECTOR}${keyClean}`;
  const raw = await rpcCall(rpcUrl, "eth_call", [{ to: factoryAddress, data }, "latest"]).catch(() => null);
  const clean = String(raw || "").replace(/^0x/i, "");
  if (clean.length < 64 * 6) return null;

  const token = parseAddressWord(clean.slice(0, 64));
  const vault = parseAddressWord(clean.slice(64, 128));
  const staking = parseAddressWord(clean.slice(128, 192));
  const pool = parseAddressWord(clean.slice(192, 256));
  const stable = parseAddressWord(clean.slice(256, 320));
  if (!token || !pool || norm(token) === norm(ZERO_ADDRESS) || norm(pool) === norm(ZERO_ADDRESS)) return null;

  return { token, vault, staking, pool, stable };
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`);
  if (json?.error) throw new Error(String(json.error?.message || `RPC ${method} error`));
  return json?.result;
}

function normalizeSymbol(input: string) {
  return String(input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9$]/g, "")
    .slice(0, 10);
}

function normalizeName(input: string) {
  return String(input || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

function slugify(input: string) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function resolveUniqueSlug(admin: ReturnType<typeof supabaseAdminClient>, input: string) {
  const base = slugify(input) || `stock-${Date.now()}`;
  for (let i = 0; i < 200; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data } = await admin
      .from("market_stock_identities")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Date.now()}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const userClient = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: auth, error: authErr } = await userClient.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const preferredChain = String(body?.chain ?? "")
    .trim()
    .toLowerCase();
  const name = normalizeName(String(body?.name ?? body?.token_name ?? ""));
  const symbol = normalizeSymbol(String(body?.symbol ?? body?.token_symbol ?? ""));
  const slugInput = String(body?.slug ?? `${name}-${symbol}`);
  const txHash = String(body?.tx_hash ?? "").trim();
  const userOpHash = String(body?.user_op_hash ?? "").trim();
  const forceSyncExisting = body?.force_sync_existing === true || String(body?.force_sync_existing ?? "").toLowerCase() === "true";
  const tokenAddress = String(body?.token_address ?? "").trim();
  const poolAddress = String(body?.pool_address ?? "").trim();
  const vaultAddress = String(body?.vault_address ?? "").trim();
  const stakingAddress = String(body?.staking_address ?? "").trim();
  const storeKey = String(body?.store_key ?? "").trim();

  const hasTxHash = isHexTxHash(txHash);

  if (!name || name.length < 3) return bad("name must be at least 3 characters");
  if (!symbol || symbol.length < 2) return bad("symbol must be at least 2 characters");
  if (txHash && !hasTxHash) return bad("tx_hash must be a valid on-chain transaction hash");
  if (tokenAddress && !isAddress(tokenAddress)) return bad("token_address must be a valid address");
  if (poolAddress && !isAddress(poolAddress)) return bad("pool_address must be a valid address");
  if (vaultAddress && !isAddress(vaultAddress)) return bad("vault_address must be a valid address");
  if (stakingAddress && !isAddress(stakingAddress)) return bad("staking_address must be a valid address");

  const { data: seller, error: sellerErr } = await admin
    .from("market_seller_profiles")
    .select("user_id,business_name,market_username,is_verified,active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (sellerErr) return bad(sellerErr.message);
  if (!seller || seller.active === false) return bad("Seller profile not active");
  if (!seller.is_verified) return bad("Only verified stores can create stock identity");

  let perms: any = null;
  const permsByStore = await admin
    .from("store_identity_permissions")
    .select("*")
    .eq("store_id", user.id)
    .maybeSingle();
  if (!permsByStore.error) {
    perms = permsByStore.data;
  } else {
    const permsBySeller = await admin
      .from("store_identity_permissions")
      .select("*")
      .eq("seller_id", user.id)
      .maybeSingle();
    if (!permsBySeller.error) perms = permsBySeller.data;
  }

  const allowCreate = perms?.can_create_evm ?? perms?.can_create ?? perms?.allow_create ?? true;
  const allowReserved = perms?.allow_reserved ?? false;

  const { data: existingByStore, error: existingErr } = await admin
    .from("market_stock_identities")
    .select("id,slug,name,symbol,chain,chain_id,active,token_address,pool_address,trading_paused_until,launched_at")
    .eq("store_id", user.id)
    .neq("chain", "pi_testnet")
    .maybeSingle();
  if (existingErr) return bad(existingErr.message);
  const hadExistingIdentity = !!existingByStore?.id;

  if (preferredChain === "pi_testnet") return bad("Use the Pi stock creation flow for pi_testnet identities");
  if (preferredChain && !isSupportedEvmStockChain(preferredChain)) {
    return bad("EVM stock identity creation is restricted to ethereum, base, arbitrum, optimism, and polygon mainnet.");
  }

  let chainConfig: any = null;
  if (preferredChain) {
    const { data, error } = await admin
      .from("market_chain_config")
      .select(
        "chain,chain_id,active,rpc_url,confirmations_required,identity_factory,identity_router,identity_name_registry,identity_stable_address,usdc_address",
      )
      .eq("chain", preferredChain)
      .eq("active", true)
      .maybeSingle();
    if (error) return bad(error.message);
    chainConfig = data;
  } else {
    const { data, error } = await admin
      .from("market_chain_config")
      .select(
        "chain,chain_id,active,rpc_url,confirmations_required,identity_factory,identity_router,identity_name_registry,identity_stable_address,usdc_address,created_at",
      )
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error) return bad(error.message);
    const rows = data ?? [];
    const preferredOrder = ["base", "ethereum", "arbitrum", "optimism", "polygon"];
    chainConfig = preferredOrder
      .map((chain) => rows.find((row: any) =>
        String(row?.chain || "").toLowerCase() === chain &&
        row.identity_factory &&
        row.identity_router
      ))
      .find(Boolean) ??
      rows.find((row: any) => isSupportedEvmStockChain(row?.chain) && row.identity_factory && row.identity_router) ??
      null;
  }

  if (!chainConfig?.chain) return bad("No active chain config available");
  if (!isSupportedEvmStockChain(String(chainConfig.chain))) {
    return bad("EVM stock identity creation is restricted to ethereum, base, arbitrum, optimism, and polygon mainnet.");
  }
  if (!chainConfig.rpc_url) return bad(`rpc_url missing for ${chainConfig.chain}`);
  if (!isAddress(String(chainConfig.identity_factory || ""))) {
    return bad(`identity_factory missing for ${chainConfig.chain}`);
  }

  let creationSettings: {
    liquidity_usdc: number;
    reserve_usdc: number;
    creation_fee_usdc: number;
  };
  try {
    creationSettings = await readFactoryCreationSettings({
      rpcUrl: String(chainConfig.rpc_url),
      factoryAddress: String(chainConfig.identity_factory),
    });
  } catch (e: any) {
    return bad(String(e?.message || e || "Could not read factory creation settings"));
  }

  const expectedStoreKey = storeKeyForStoreId(user.id);
  if (storeKey) {
    if (!isBytes32(storeKey)) return bad("store_key must be a bytes32 value");
    if (norm(storeKey) !== norm(expectedStoreKey)) {
      return bad("store_key does not match this store");
    }
  }

  const onchainIdentity = await readIdentityFromFactory(
    String(chainConfig.rpc_url),
    String(chainConfig.identity_factory),
    expectedStoreKey,
  );
  const syncExistingFlow = !!onchainIdentity && (forceSyncExisting || !hasTxHash);

  if (allowCreate === false && !syncExistingFlow) return bad("Store cannot create stock identity right now");

  if (!hadExistingIdentity && !syncExistingFlow) {
    const reservedFn = await admin.rpc("market_stock_has_reserved_text", {
      p_name: name,
      p_symbol: symbol,
    });
    let isReserved = false;
    if (!reservedFn.error) {
      isReserved = reservedFn.data === true;
    } else {
      const normName = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const normSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const termsV2 = await admin
        .from("market_stock_reserved_terms")
        .select("term_norm")
        .eq("active", true)
        .in("term_norm", [normName, normSymbol]);
      if (!termsV2.error && (termsV2.data?.length ?? 0) > 0) {
        isReserved = true;
      } else {
        const termsLegacy = await admin
          .from("reserved_name_rules")
          .select("normalized_pattern")
          .eq("active", true)
          .in("normalized_pattern", [normName, normSymbol]);
        if (!termsLegacy.error && (termsLegacy.data?.length ?? 0) > 0) {
          isReserved = true;
        }
      }
    }
    if (isReserved && !allowReserved) {
      return bad("Reserved identity name/symbol. Contact BestCity support");
    }
  }

  let decoded: { token: string; vault: string | null; staking: string | null; pool: string; stable: string | null } | null = null;
  let acceptedTxHash = hasTxHash ? txHash : "";

  if (hasTxHash) {
    const receipt: any = await rpcCall(String(chainConfig.rpc_url), "eth_getTransactionReceipt", [txHash]).catch((e) =>
      ({ __err: String(e?.message ?? e) })
    );

    if (!receipt?.__err && receipt && String(receipt.status || "").toLowerCase() === "0x1") {
      const latestBlockHex = await rpcCall(String(chainConfig.rpc_url), "eth_blockNumber", []).catch((e) =>
        ({ __err: String(e?.message ?? e) })
      );
      if (latestBlockHex?.__err) return bad(latestBlockHex.__err);
      const latestBlock = Number.parseInt(String(latestBlockHex || "0x0"), 16);
      const txBlock = Number.parseInt(String(receipt.blockNumber || "0x0"), 16);
      const confirmations = Number.isFinite(latestBlock) && Number.isFinite(txBlock) ? (latestBlock - txBlock + 1) : 0;
      const required = Math.max(1, Number(chainConfig.confirmations_required ?? 1));
      if (confirmations < required) {
        return bad(`Awaiting confirmations (${confirmations}/${required})`);
      }

      const storeTopic = bytes32Topic(expectedStoreKey);
      const createLog = Array.isArray(receipt.logs)
        ? receipt.logs.find((log: any) =>
          norm(String(log?.address || "")) === norm(String(chainConfig.identity_factory || "")) &&
          norm(String(log?.topics?.[0] || "")) === norm(IDENTITY_CREATED_TOPIC0) &&
          norm(String(log?.topics?.[1] || "")) === norm(storeTopic)
        )
        : null;

      if (createLog) {
        const parsed = parseIdentityCreatedData(String(createLog.data || ""));
        if (parsed) {
          decoded = parsed;
        }
      }
    }

    if (!decoded && onchainIdentity) {
      decoded = onchainIdentity;
      acceptedTxHash = "";
    }

    if (!decoded) {
      if (receipt?.__err) return bad(receipt.__err);
      if (!receipt) return bad("Transaction receipt not found on chain yet");
      if (String(receipt.status || "").toLowerCase() !== "0x1") return bad("On-chain create transaction failed");
      return bad("On-chain identity creation event not found in transaction logs");
    }
  } else {
    if (!onchainIdentity) return bad("tx_hash is required and must be a valid on-chain transaction hash");
    decoded = onchainIdentity;
    acceptedTxHash = "";
  }

  if (!decoded) return bad("Could not resolve on-chain identity details");
  if (tokenAddress && norm(decoded.token) !== norm(tokenAddress)) return bad("token_address does not match on-chain identity");
  if (poolAddress && norm(decoded.pool) !== norm(poolAddress)) return bad("pool_address does not match on-chain identity");
  if (vaultAddress && decoded.vault && norm(decoded.vault) !== norm(vaultAddress)) {
    return bad("vault_address does not match on-chain identity");
  }
  if (stakingAddress && decoded.staking && norm(decoded.staking) !== norm(stakingAddress)) {
    return bad("staking_address does not match on-chain identity");
  }

  const stableAddress = String(decoded.stable || chainConfig.identity_stable_address || chainConfig.usdc_address || "").trim();
  if (!isAddress(stableAddress)) return bad(`identity_stable_address missing for ${chainConfig.chain}`);

  let onchainTotalSupply = 100_000_000;
  let onchainInitialPrice = 0.00004;
  try {
    const [supply, poolSnapshot] = await Promise.all([
      readErc20TotalSupply({
        rpcUrl: String(chainConfig.rpc_url),
        tokenAddress: decoded.token,
        decimals: 18,
      }),
      readPoolSnapshot({
        rpcUrl: String(chainConfig.rpc_url),
        poolAddress: decoded.pool,
        stableToken: stableAddress,
        identityToken: decoded.token,
      }),
    ]);
    onchainTotalSupply = Math.max(0, Math.round(Number(supply.value || 0))) || 100_000_000;
    onchainInitialPrice = Math.max(0.00000001, Number(poolSnapshot.spot_price_usdc || 0.00004));
  } catch (e: any) {
    return bad(String(e?.message || e || "Could not read on-chain stock supply or pool price"));
  }

  const slug = await resolveUniqueSlug(
    admin,
    slugInput || seller.market_username || seller.business_name || `${name}-${symbol}`,
  );

  const now = new Date();
  const launchGuardUntil = new Date(now.getTime() + (24 * 60 * 60 * 1000)).toISOString();

  let identity: any = null;
  if (existingByStore?.id) {
    const resolvedSlug = String(existingByStore.slug || slug || "");
    const { data: repaired, error: repairErr } = await admin
      .from("market_stock_identities")
      .update({
        chain: chainConfig.chain,
        chain_id: Number(chainConfig.chain_id ?? existingByStore.chain_id ?? 0),
        slug: resolvedSlug,
        name,
        symbol,
        total_supply: onchainTotalSupply,
        token_address: decoded.token,
        pool_address: decoded.pool,
        creation_fee_usdc: creationSettings.creation_fee_usdc,
        creation_lp_usdc: creationSettings.liquidity_usdc,
        creation_reserve_usdc: creationSettings.reserve_usdc,
        active: true,
        trading_paused_until: null,
        launch_guard_until: launchGuardUntil,
        launched_at: existingByStore.launched_at ?? now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", existingByStore.id)
      .select("*")
      .single();
    if (repairErr || !repaired) return bad(repairErr?.message ?? "Failed to repair existing stock identity");
    identity = repaired;
  } else {
    const { data: created, error: createErr } = await admin
      .from("market_stock_identities")
      .insert({
        store_id: user.id,
        chain: chainConfig.chain,
        chain_id: Number(chainConfig.chain_id ?? 0),
        slug,
        name,
        symbol,
        total_supply: onchainTotalSupply,
        token_address: decoded.token,
        pool_address: decoded.pool,
        creation_fee_usdc: creationSettings.creation_fee_usdc,
        creation_lp_usdc: creationSettings.liquidity_usdc,
        creation_reserve_usdc: creationSettings.reserve_usdc,
        active: true,
        trading_paused_until: null,
        launch_guard_until: launchGuardUntil,
        launched_at: now.toISOString(),
      })
      .select("*")
      .single();
    if (createErr || !created) return bad(createErr?.message ?? "Failed to create stock identity");
    identity = created;
  }

  const { error: lockPermErr } = await admin
    .from("store_identity_permissions")
    .upsert(
      {
        store_id: user.id,
        can_create: false,
      },
      { onConflict: "store_id" },
    );
  if (lockPermErr) return bad(lockPermErr.message);

  const reserveUsdc = 0;
  const platformUsdc = Number(identity.creation_reserve_usdc ?? creationSettings.reserve_usdc ?? 0);
  const creationLp = Number(identity.creation_lp_usdc ?? creationSettings.liquidity_usdc ?? 0);
  const creationFeeUsdc = Number(identity.creation_fee_usdc ?? creationSettings.creation_fee_usdc ?? (creationLp + platformUsdc));

  const { error: reserveErr2 } = await admin
    .from("market_stock_reserve_balance")
    .upsert(
      {
        stock_id: identity.id,
        store_id: user.id,
        reserve_usdc: reserveUsdc,
      },
      { onConflict: "stock_id" },
    );
  if (reserveErr2) return bad(reserveErr2.message);

  const { error: reinvestErr } = await admin
    .from("market_stock_reinvestments")
    .upsert({
      stock_id: identity.id,
      store_id: user.id,
      source_type: "creation_fee",
      gross_usdc: creationFeeUsdc,
      platform_usdc: platformUsdc,
      liquidity_usdc: creationLp,
      staking_usdc: 0,
      chain: identity.chain,
      tx_hash: acceptedTxHash || null,
      status: "confirmed",
      idempotency_key: `stock:create:${identity.id}`,
    }, { onConflict: "idempotency_key" });
  if (reinvestErr) return bad(reinvestErr.message);

  const marketCap = Number(identity.total_supply ?? onchainTotalSupply ?? 100_000_000) * onchainInitialPrice;
  const { error: pointErr } = await admin
    .from("market_stock_price_points")
    .upsert({
      stock_id: identity.id,
      last_price_usdc: onchainInitialPrice,
      market_cap_usdc: marketCap,
      updated_at: now.toISOString(),
    });
  if (pointErr) return bad(pointErr.message);

  return ok({
    ok: true,
    created: !hadExistingIdentity,
    repaired: hadExistingIdentity,
    identity,
    chain_config: chainConfig,
    economics: {
      creation_fee_usdc: creationFeeUsdc,
      liquidity_usdc: creationLp,
      reserve_usdc: platformUsdc,
      platform_usdc: platformUsdc,
      reserve_balance_usdc: reserveUsdc,
    },
    onchain: {
      tx_hash: acceptedTxHash || null,
      user_op_hash: userOpHash || null,
      token_address: decoded.token,
      pool_address: decoded.pool,
      vault_address: decoded.vault,
      staking_address: decoded.staking,
      store_key: expectedStoreKey,
    },
  });
});
