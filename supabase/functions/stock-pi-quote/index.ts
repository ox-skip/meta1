import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { getPiUsdPrice } from "../_shared/market/pi.ts";
import { persistStockPiMetrics, computeStockPiQuote, resolvePiStockMarketContext } from "../_shared/market/stockPi.ts";
import { resolveStockIdentity, toNum } from "../_shared/market/stock.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const userClient = supabaseUserClient(req);
  const admin = supabaseAdminClient();
  const { data: auth, error: authErr } = await userClient.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const stockId = String(body?.stock_id ?? body?.identity_id ?? "").trim();
  const slug = String(body?.slug ?? "").trim().toLowerCase();
  const side = String(body?.side ?? "").trim().toLowerCase();
  const amountUsdc = toNum(body?.amount_usdc, 0);
  const quantity = toNum(body?.quantity, 0);

  if (side !== "buy" && side !== "sell") return bad("side must be buy or sell");

  try {
    const identity = await resolveStockIdentity(admin as any, { stockId, slug });
    if (!identity) return bad("Stock identity not found");

    const [piUsdPrice, market] = await Promise.all([
      getPiUsdPrice(),
      resolvePiStockMarketContext(admin as any, identity),
    ]);

    await persistStockPiMetrics(admin as any, market.metrics);

    const quote = computeStockPiQuote({
      stock: identity,
      userId: user.id,
      side: side as "buy" | "sell",
      amountUsdc,
      quantity,
      piUsdPrice,
      spotPriceUsdc: market.spotPriceUsdc,
      liquidityUsdc: market.liquidityUsdc,
      metrics: market.metrics,
      launchGuardActive: market.launchGuardActive,
    });

    return ok({
      ok: true,
      identity: {
        id: identity.id,
        store_id: identity.store_id,
        slug: identity.slug,
        name: identity.name,
        symbol: identity.symbol,
        chain: identity.chain,
      },
      quote,
      liquidity: market.metrics,
    });
  } catch (e: any) {
    return bad(String(e?.message || e || "Unable to compute Pi quote"));
  }
});
