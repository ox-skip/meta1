import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ethers } from "https://esm.sh/ethers@6.16.0";

import { adminError, getAdminContext } from "../_shared/market/admin.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";

type StockContractAction =
  | "factory_pause"
  | "factory_unpause"
  | "factory_set_bootstrap_defaults"
  | "factory_set_creation_amounts"
  | "factory_set_split"
  | "factory_set_name_registry"
  | "factory_set_admin"
  | "factory_seed_initial_liquidity"
  | "factory_add_reinvestment"
  | "factory_add_rewards"
  | "router_pause"
  | "router_unpause"
  | "router_set_stock_bootstrap"
  | "router_set_liquidity_guard"
  | "router_set_twap"
  | "registry_set_reserved"
  | "registry_set_creator_allowed";

function envAny(...names: string[]) {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v && v.trim().length > 0) return v.trim();
  }
  return "";
}

function stockAdminKeyForChain(chain: string) {
  const upper = chain.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return envAny(
    `STOCK_ADMIN_PRIVATE_KEY_${upper}`,
    `IDENTITY_ADMIN_PRIVATE_KEY_${upper}`,
    `ADMIN_PRIVATE_KEY_${upper}`,
    "STOCK_ADMIN_PRIVATE_KEY",
    "IDENTITY_ADMIN_PRIVATE_KEY",
    "ADMIN_PRIVATE_KEY",
  );
}

function canRunStockContracts(ctx: { roleKey: string; permissions: string[] }) {
  return ctx.roleKey === "super_admin" ||
    ctx.permissions.includes("*") ||
    ctx.permissions.includes("chain.admin") ||
    ctx.permissions.includes("stock.contracts");
}

function normalizeAction(input: unknown): StockContractAction | "" {
  const raw = String(input ?? "").trim().toLowerCase().replace(/-/g, "_");
  const aliases: Record<string, StockContractAction> = {
    pause_factory: "factory_pause",
    unpause_factory: "factory_unpause",
    pause_router: "router_pause",
    unpause_router: "router_unpause",
    set_bootstrap_defaults: "factory_set_bootstrap_defaults",
    set_creation_amounts: "factory_set_creation_amounts",
    set_split: "factory_set_split",
    set_name_registry: "factory_set_name_registry",
    set_admin: "factory_set_admin",
    rotate_admin: "factory_set_admin",
    seed_initial_liquidity: "factory_seed_initial_liquidity",
    seed_stock_liquidity: "factory_seed_initial_liquidity",
    factory_seed_liquidity: "factory_seed_initial_liquidity",
    add_reinvestment: "factory_add_reinvestment",
    add_rewards: "factory_add_rewards",
    set_stock_bootstrap: "router_set_stock_bootstrap",
    set_liquidity_guard: "router_set_liquidity_guard",
    set_liquidity_guard_bps: "router_set_liquidity_guard",
    set_twap: "router_set_twap",
    set_twap_config: "router_set_twap",
    set_reserved: "registry_set_reserved",
    set_creator_allowed: "registry_set_creator_allowed",
    set_allow_reserved_creator: "registry_set_creator_allowed",
  };
  const normalized = aliases[raw] ?? raw;
  const supported = new Set<StockContractAction>([
    "factory_pause",
    "factory_unpause",
    "factory_set_bootstrap_defaults",
    "factory_set_creation_amounts",
    "factory_set_split",
    "factory_set_name_registry",
    "factory_set_admin",
    "factory_seed_initial_liquidity",
    "factory_add_reinvestment",
    "factory_add_rewards",
    "router_pause",
    "router_unpause",
    "router_set_stock_bootstrap",
    "router_set_liquidity_guard",
    "router_set_twap",
    "registry_set_reserved",
    "registry_set_creator_allowed",
  ]);
  return supported.has(normalized as StockContractAction) ? (normalized as StockContractAction) : "";
}

function requireAddress(name: string, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!ethers.isAddress(raw)) throw new Error(`Invalid ${name}`);
  return raw;
}

function requireBoolean(name: string, value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid ${name}`);
}

function requireInt(name: string, value: unknown, min: number, max: number) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
}

function requireAmountUnits(name: string, value: unknown) {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`${name} must be a positive number`);
  return ethers.parseUnits(raw, 6);
}

function requireAmountText(name: string, value: unknown) {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`${name} must be a positive number`);
  if (Number(raw) <= 0) throw new Error(`${name} must be greater than zero`);
  return raw;
}

function formatStable(value: bigint, decimals: number) {
  return ethers.formatUnits(value, decimals);
}

function storeKeyForStoreId(storeId: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(storeId || "").trim()));
}

function requireBytes32OrStoreKey(body: any) {
  const raw = String(body?.store_key ?? body?.storeKey ?? "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(raw)) return raw;
  const storeId = String(body?.store_id ?? body?.storeId ?? "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(storeId)) return storeId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
    throw new Error("store_id or 32-byte store_key required");
  }
  return storeKeyForStoreId(storeId);
}

function termHash(value: unknown) {
  const raw = String(value ?? "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(raw)) return raw;
  if (!raw) throw new Error("reserved term or name_hash required");
  return ethers.keccak256(ethers.toUtf8Bytes(raw));
}

const factoryAbi = [
  "function pause() external",
  "function unpause() external",
  "function setBootstrapDefaults(uint256 maxTradeBps, uint256 cooldownSecs, uint256 duration) external",
  "function setCreationAmounts(uint256 liquidityAmount, uint256 reserveAmount) external",
  "function setSplit(uint16 liquidityBps, uint16 rewardsBps) external",
  "function setNameRegistry(address registry) external",
  "function setAdmin(address newAdmin) external",
  "function identities(bytes32 storeId) view returns (address token,address vault,address staking,address pool,address stable,uint24 fee)",
  "function addReinvestment(bytes32 storeId, uint256 stableAmount) external",
  "function addRewards(bytes32 storeId, uint256 stableAmount) external",
] as const;

const vaultAbi = [
  "function MANAGER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function tokenId() view returns (uint256)",
  "function pool() view returns (address)",
  "function mintInitialPosition(uint256 stableAmount) external returns (uint256)",
] as const;

const erc20Abi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to,uint256 amount) external returns (bool)",
] as const;

const routerAbi = [
  "function pause() external",
  "function unpause() external",
  "function setBootstrap(bytes32 storeId, uint256 maxTradeBps, uint256 cooldownSecs, uint256 endTime) external",
  "function setLiquidityGuardBps(uint256 liquidityGuardBps) external",
  "function setTwapConfig(uint32 windowSecs, int24 maxTickDeviation) external",
] as const;

const registryAbi = [
  "function setReserved(bytes32 nameHash, bool isReserved) external",
  "function setAllowReservedCreator(address creator, bool allowed) external",
] as const;

serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, { requireSession: true });
    if (ctx instanceof Response) return ctx;
    if (!canRunStockContracts(ctx)) return unauth();

    const SB_URL = envAny("SB_URL", "SUPABASE_URL");
    const SB_SERVICE = envAny("SB_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    if (!SB_URL || !SB_SERVICE) return bad("Missing Supabase env vars");

    const admin = createClient(SB_URL, SB_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const chain = String(body?.chain ?? "").trim();
    const action = normalizeAction(body?.action);
    const note = body?.note ? String(body.note) : null;

    if (!chain) return bad("chain required");
    if (!action) {
      return bad("action must target factory, router, or registry stock contract controls");
    }

    const { data: cfg, error: cfgErr } = await admin
      .from("market_chain_config")
      .select("chain,rpc_url,identity_factory,identity_router,identity_name_registry")
      .eq("chain", chain)
      .maybeSingle();
    if (cfgErr) return bad(cfgErr.message);
    if (!cfg?.chain) return bad("Chain config not found");

    const rpcUrl = resolveRpcUrlForChain(cfg.chain, cfg.rpc_url);
    const adminKey = stockAdminKeyForChain(cfg.chain);
    if (!rpcUrl) return bad("Missing RPC URL in secrets or chain config");
    if (!adminKey) return bad("Missing STOCK_ADMIN_PRIVATE_KEY or IDENTITY_ADMIN_PRIVATE_KEY in secrets");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(adminKey, provider);
    const response: Record<string, unknown> = { chain: cfg.chain, action, signer: await signer.getAddress() };

    let targetAddress = "";
    let tx: { hash: string; wait: () => Promise<unknown> };

    if (action.startsWith("factory_")) {
      targetAddress = requireAddress("identity_factory", cfg.identity_factory);
      const contract = new ethers.Contract(targetAddress, factoryAbi, signer);
      if (action === "factory_pause") {
        tx = await contract.pause();
      } else if (action === "factory_unpause") {
        tx = await contract.unpause();
      } else if (action === "factory_set_bootstrap_defaults") {
        const maxTradeBps = requireInt("max_trade_bps", body?.max_trade_bps ?? body?.maxTradeBps, 1, 2000);
        const cooldownSecs = requireInt("cooldown_seconds", body?.cooldown_seconds ?? body?.cooldownSecs, 0, 31_536_000);
        const durationSecs = requireInt("duration_seconds", body?.duration_seconds ?? body?.durationSecs, 0, 31_536_000);
        tx = await contract.setBootstrapDefaults(maxTradeBps, cooldownSecs, durationSecs);
        response.max_trade_bps = maxTradeBps;
        response.cooldown_seconds = cooldownSecs;
        response.duration_seconds = durationSecs;
      } else if (action === "factory_set_creation_amounts") {
        const liquidityAmount = requireAmountUnits("liquidity_usdc", body?.liquidity_usdc ?? body?.liquidityAmount);
        const reserveAmount = requireAmountUnits("reserve_usdc", body?.reserve_usdc ?? body?.reserveAmount);
        tx = await contract.setCreationAmounts(liquidityAmount, reserveAmount);
        response.liquidity_usdc = String(body?.liquidity_usdc ?? body?.liquidityAmount);
        response.reserve_usdc = String(body?.reserve_usdc ?? body?.reserveAmount);
      } else if (action === "factory_set_split") {
        const liquidityBps = requireInt("liquidity_bps", body?.liquidity_bps ?? body?.liquidityBps, 0, 10000);
        const rewardsBps = requireInt("rewards_bps", body?.rewards_bps ?? body?.rewardsBps, 500, 10000);
        if (liquidityBps + rewardsBps !== 10000) return bad("liquidity_bps + rewards_bps must equal 10000");
        tx = await contract.setSplit(liquidityBps, rewardsBps);
        response.liquidity_bps = liquidityBps;
        response.rewards_bps = rewardsBps;
      } else if (action === "factory_set_admin") {
        const newAdmin = requireAddress("new_admin", body?.new_admin ?? body?.newAdmin ?? body?.admin);
        tx = await contract.setAdmin(newAdmin);
        response.new_admin = newAdmin;
      } else if (action === "factory_seed_initial_liquidity") {
        const storeKey = requireBytes32OrStoreKey(body);
        const amountText = requireAmountText("stable_usdc", body?.stable_usdc ?? body?.amount_usdc ?? body?.amount);
        const info = await contract.identities(storeKey);
        const token = String(info.token ?? info[0] ?? "");
        const vaultAddress = String(info.vault ?? info[1] ?? "");
        const poolAddress = String(info.pool ?? info[3] ?? "");
        const stableAddress = String(info.stable ?? info[4] ?? "");
        if (!ethers.isAddress(token) || token === ethers.ZeroAddress) return bad("Stock identity not found for store");
        if (!ethers.isAddress(vaultAddress) || vaultAddress === ethers.ZeroAddress) return bad("Stock vault missing for store");
        if (!ethers.isAddress(poolAddress) || poolAddress === ethers.ZeroAddress) return bad("Stock pool missing for store");
        if (!ethers.isAddress(stableAddress) || stableAddress === ethers.ZeroAddress) return bad("Stable token missing for stock");

        const vault = new ethers.Contract(vaultAddress, vaultAbi, signer);
        const currentTokenId = await vault.tokenId();
        if (BigInt(currentTokenId) !== 0n) {
          return bad("Stock already has an initial liquidity position. Use add reinvestment instead.");
        }
        const signerAddress = await signer.getAddress();
        const managerRole = await vault.MANAGER_ROLE();
        const canMint = await vault.hasRole(managerRole, signerAddress);
        if (!canMint) {
          return bad("Admin wallet is not a manager on this stock vault");
        }

        const stable = new ethers.Contract(stableAddress, erc20Abi, signer);
        const decimals = Number(await stable.decimals());
        const symbol = String(await stable.symbol().catch(() => "USDC"));
        const stableAmount = ethers.parseUnits(amountText, decimals);
        const vaultBalance = BigInt(await stable.balanceOf(vaultAddress));
        const transferAmount = vaultBalance >= stableAmount ? 0n : stableAmount - vaultBalance;
        const signerBalance = BigInt(await stable.balanceOf(signerAddress));
        if (signerBalance < transferAmount) {
          return bad(`Admin wallet has ${formatStable(signerBalance, decimals)} ${symbol}, needs ${formatStable(transferAmount, decimals)} ${symbol}`);
        }

        const transferTx = transferAmount > 0n ? await stable.transfer(vaultAddress, transferAmount) : null;
        if (transferTx) await transferTx.wait();
        await vault.mintInitialPosition.staticCall(stableAmount);
        const mintTx = await vault.mintInitialPosition(stableAmount);
        await mintTx.wait();

        const nextTokenId = await vault.tokenId();
        targetAddress = vaultAddress;
        tx = {
          hash: mintTx.hash,
          wait: async () => null,
        };
        response.store_key = storeKey;
        response.stable_usdc = amountText;
        response.stable_token = stableAddress;
        response.stable_symbol = symbol;
        response.identity_token = token;
        response.vault = vaultAddress;
        response.pool = poolAddress;
        response.position_token_id = nextTokenId.toString();
        response.vault_existing_stable = formatStable(vaultBalance, decimals);
        response.transferred_stable = formatStable(transferAmount, decimals);
        response.transfer_tx_hash = transferTx?.hash ?? null;
      } else if (action === "factory_add_reinvestment" || action === "factory_add_rewards") {
        const storeKey = requireBytes32OrStoreKey(body);
        const stableAmount = requireAmountUnits("stable_usdc", body?.stable_usdc ?? body?.amount_usdc ?? body?.amount);
        tx = action === "factory_add_reinvestment"
          ? await contract.addReinvestment(storeKey, stableAmount)
          : await contract.addRewards(storeKey, stableAmount);
        response.store_key = storeKey;
        response.stable_usdc = String(body?.stable_usdc ?? body?.amount_usdc ?? body?.amount);
      } else {
        const registry = requireAddress("registry", body?.registry ?? body?.name_registry);
        tx = await contract.setNameRegistry(registry);
        response.registry = registry;
      }
    } else if (action.startsWith("router_")) {
      targetAddress = requireAddress("identity_router", cfg.identity_router);
      const contract = new ethers.Contract(targetAddress, routerAbi, signer);
      if (action === "router_pause") {
        tx = await contract.pause();
      } else if (action === "router_unpause") {
        tx = await contract.unpause();
      } else if (action === "router_set_stock_bootstrap") {
        const storeKey = requireBytes32OrStoreKey(body);
        const maxTradeBps = requireInt("max_trade_bps", body?.max_trade_bps ?? body?.maxTradeBps, 1, 2000);
        const cooldownSecs = requireInt("cooldown_seconds", body?.cooldown_seconds ?? body?.cooldownSecs, 0, 31_536_000);
        const durationSecs = requireInt("duration_seconds", body?.duration_seconds ?? body?.durationSecs, 0, 31_536_000);
        const explicitEndTime = body?.end_time ?? body?.endTime;
        const endTime = explicitEndTime === undefined || explicitEndTime === null || explicitEndTime === ""
          ? Math.floor(Date.now() / 1000) + durationSecs
          : requireInt("end_time", explicitEndTime, 0, 4_102_444_800);
        tx = await contract.setBootstrap(storeKey, maxTradeBps, cooldownSecs, endTime);
        response.store_key = storeKey;
        response.max_trade_bps = maxTradeBps;
        response.cooldown_seconds = cooldownSecs;
        response.end_time = endTime;
      } else if (action === "router_set_liquidity_guard") {
        const liquidityGuardBps = requireInt("liquidity_guard_bps", body?.liquidity_guard_bps ?? body?.liquidityGuardBps, 0, 10000);
        tx = await contract.setLiquidityGuardBps(liquidityGuardBps);
        response.liquidity_guard_bps = liquidityGuardBps;
      } else {
        const windowSecs = requireInt("window_seconds", body?.window_seconds ?? body?.windowSecs, 1, 86_400);
        const maxTickDeviation = requireInt("max_tick_deviation", body?.max_tick_deviation ?? body?.maxTickDeviation, 1, 2000);
        tx = await contract.setTwapConfig(windowSecs, maxTickDeviation);
        response.window_seconds = windowSecs;
        response.max_tick_deviation = maxTickDeviation;
      }
    } else {
      targetAddress = requireAddress("identity_name_registry", cfg.identity_name_registry);
      const contract = new ethers.Contract(targetAddress, registryAbi, signer);
      if (action === "registry_set_reserved") {
        const nameHash = termHash(body?.name_hash ?? body?.term);
        const reserved = requireBoolean("reserved", body?.reserved);
        tx = await contract.setReserved(nameHash, reserved);
        response.name_hash = nameHash;
        response.term = String(body?.term ?? "");
        response.reserved = reserved;
      } else {
        const creator = requireAddress("creator", body?.creator ?? body?.wallet);
        const allowed = requireBoolean("allowed", body?.allowed);
        tx = await contract.setAllowReservedCreator(creator, allowed);
        response.creator = creator;
        response.allowed = allowed;
      }
    }

    await tx.wait();

    await admin.from("market_audit_logs").insert({
      actor_id: ctx.userId === "service-token" ? null : ctx.userId,
      actor_type: "admin",
      action: `STOCK_CONTRACT_${String(action).toUpperCase()}`,
      entity_type: "market_chain_config",
      entity_id: null,
      payload: {
        chain: cfg.chain,
        target_address: targetAddress,
        tx_hash: tx.hash,
        note,
        ...response,
      },
    });

    return ok({
      ok: true,
      tx_hash: tx.hash,
      target_address: targetAddress,
      ...response,
    });
  } catch (e) {
    return adminError(e);
  }
});
