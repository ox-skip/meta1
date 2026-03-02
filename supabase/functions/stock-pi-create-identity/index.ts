import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

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

function toNum(input: unknown, fallback = 0) {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

async function resolveUniqueSlug(admin: any, input: string) {
  const base = slugify(input) || `pi-stock-${Date.now()}`;
  for (let i = 0; i < 200; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data, error } = await admin
      .from("market_stock_identities")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error) throw new Error(error.message);
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
  const name = normalizeName(String(body?.name ?? body?.token_name ?? ""));
  const symbol = normalizeSymbol(String(body?.symbol ?? body?.token_symbol ?? ""));
  const slugInput = String(body?.slug ?? `${name}-${symbol}`);
  const initialPrice = Math.max(0.000001, toNum(body?.initial_price_usdc, 0.01));

  if (!name || name.length < 3) return bad("name must be at least 3 characters");
  if (!symbol || symbol.length < 2) return bad("symbol must be at least 2 characters");

  const { data: seller, error: sellerErr } = await admin
    .from("market_seller_profiles")
    .select("user_id,is_verified,active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (sellerErr) return bad(sellerErr.message);
  if (!seller || seller.active === false) return bad("Seller profile not active");
  if (!seller.is_verified) return bad("Only verified stores can create stock identity");

  const { data: chainConfig, error: chainErr } = await admin
    .from("market_chain_config")
    .select("chain,chain_id,active")
    .eq("chain", "pi_testnet")
    .eq("active", true)
    .maybeSingle();
  if (chainErr) return bad(chainErr.message);
  if (!chainConfig) return bad("pi_testnet chain config is missing");

  const { data: existingByStore, error: existingErr } = await admin
    .from("market_stock_identities")
    .select("id,slug,name,symbol,chain,active,launched_at")
    .eq("store_id", user.id)
    .eq("chain", "pi_testnet")
    .maybeSingle();
  if (existingErr) return bad(existingErr.message);
  if (existingByStore?.id) {
    return ok({
      ok: true,
      created: false,
      identity: existingByStore,
    });
  }

  const slug = await resolveUniqueSlug(admin, slugInput);
  const nowIso = new Date().toISOString();
  const launchGuardUntil = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { data: created, error: createErr } = await admin
    .from("market_stock_identities")
    .insert({
      store_id: user.id,
      chain: "pi_testnet",
      chain_id: Number(chainConfig.chain_id ?? 0),
      slug,
      name,
      symbol,
      token_address: null,
      pool_address: null,
      total_supply: 10_000_000,
      decimals: 18,
      creation_fee_usdc: 50,
      creation_lp_usdc: 45,
      creation_reserve_usdc: 5,
      reinvest_ops_bps: 5000,
      reinvest_liquidity_bps: 4500,
      reinvest_staking_bps: 500,
      launch_guard_until: launchGuardUntil,
      trading_paused_until: null,
      active: true,
      launched_at: nowIso,
    })
    .select("*")
    .single();
  if (createErr || !created) return bad(createErr?.message ?? "Unable to create Pi stock identity");

  const { error: pointErr } = await admin
    .from("market_stock_price_points")
    .upsert({
      stock_id: created.id,
      last_price_usdc: initialPrice,
      market_cap_usdc: initialPrice * Number(created.total_supply ?? 10_000_000),
      updated_at: nowIso,
    });
  if (pointErr) return bad(pointErr.message);

  const { error: reserveErr } = await admin
    .from("market_stock_reserve_balance")
    .upsert({
      stock_id: created.id,
      store_id: user.id,
      reserve_usdc: 0,
      updated_at: nowIso,
    });
  if (reserveErr) return bad(reserveErr.message);

  return ok({
    ok: true,
    created: true,
    identity: created,
  });
});
