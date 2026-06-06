import { ethers } from "https://esm.sh/ethers@6.16.0";

import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import { isSupportedEvmStockChain } from "../_shared/market/stockEvm.ts";

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

const controllerAbi = [
  "function walletIdentity(address wallet) view returns (bytes32)",
  "function setWalletIdentity(address wallet, bytes32 identityId) external",
] as const;

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

function profileIdentityForUserId(userId: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(`bestcity-profile:${String(userId || "").trim()}`));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const userClient = supabaseUserClient(req);
  const admin = supabaseAdminClient();
  const { data: auth, error: authErr } = await userClient.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  try {
    const body = await req.json().catch(() => ({}));
    const chain = String(body?.chain ?? "").trim().toLowerCase();
    const walletAddress = String(body?.wallet_address ?? body?.wallet ?? "").trim();
    if (!chain) return bad("chain required");
    if (!isSupportedEvmStockChain(chain)) return bad("Unsupported stock chain");
    if (!ethers.isAddress(walletAddress)) return bad("wallet_address must be a valid address");

    const { data: conflict, error: conflictErr } = await admin
      .from("crypto_wallets")
      .select("id,user_id")
      .eq("chain", chain)
      .eq("address", walletAddress)
      .neq("user_id", user.id)
      .limit(1);
    if (conflictErr) return bad(conflictErr.message);
    if ((conflict ?? []).length > 0) return bad("This wallet is already linked to another BestCity account.");

    const { data: cfg, error: cfgErr } = await admin
      .from("market_chain_config")
      .select("chain,rpc_url,identity_ownership_controller")
      .eq("chain", chain)
      .eq("active", true)
      .maybeSingle();
    if (cfgErr) return bad(cfgErr.message);
    if (!cfg?.chain) return bad("Chain config not found");
    if (!ethers.isAddress(String(cfg.identity_ownership_controller || ""))) {
      return bad("Stock ownership controller missing for this chain");
    }

    const rpcUrl = resolveRpcUrlForChain(String(cfg.chain), cfg.rpc_url);
    const adminKey = stockAdminKeyForChain(String(cfg.chain));
    if (!rpcUrl) return bad("Missing RPC URL for this chain");
    if (!adminKey) return bad("Missing stock admin signing key for this chain");

    const creatorIdentity = profileIdentityForUserId(user.id);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(adminKey, provider);
    const controller = new ethers.Contract(String(cfg.identity_ownership_controller), controllerAbi, signer);
    const currentRaw = String(await controller.walletIdentity(walletAddress));
    const current = currentRaw.toLowerCase();
    const desired = creatorIdentity.toLowerCase();
    const zero = ZERO_BYTES32.toLowerCase();

    if (current !== zero && current !== desired) {
      return bad("This wallet is already linked to another BestCity profile.");
    }

    let txHash: string | null = null;
    if (current !== desired) {
      const tx = await controller.setWalletIdentity(walletAddress, creatorIdentity);
      txHash = tx.hash;
      await tx.wait();
    }

    return ok({
      ok: true,
      chain,
      wallet_address: walletAddress,
      profile_identity: creatorIdentity,
      tx_hash: txHash,
      signer: await signer.getAddress(),
    });
  } catch (e: any) {
    return bad(String(e?.shortMessage || e?.message || e || "Could not register stock wallet"));
  }
});
