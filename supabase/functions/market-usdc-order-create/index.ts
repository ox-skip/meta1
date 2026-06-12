import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import { orderKeyKeccak } from "../_shared/market/crypto.ts";

function toPositiveDecimalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const [intPartRaw, fracPartRaw = ""] = raw.split(".");
    const intPart = intPartRaw.replace(/^0+(?=\d)/, "");
    const fracPart = fracPartRaw.replace(/0+$/, "");
    const normalized = fracPart ? `${intPart}.${fracPart}` : intPart;
    return normalized === "0" ? null : normalized;
  }

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const plain = n.toString();
  return /^\d+(\.\d+)?$/.test(plain) ? plain : null;
}

function multiplyDecimalByQuantity(decimalStr: string, quantity: number): string {
  const [whole, frac = ""] = decimalStr.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "") || "0";
  const scale = frac.length;
  const product = BigInt(digits) * BigInt(quantity);

  if (scale === 0) return product.toString();

  const padded = product.toString().padStart(scale + 1, "0");
  const intPart = padded.slice(0, -scale);
  const fracPart = padded.slice(-scale).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function isMissingReserveStockFunction(input: unknown) {
  const msg = String(input ?? "").toLowerCase();
  return (
    msg.includes("market_reserve_listing_stock") &&
    (
      msg.includes("does not exist") ||
      msg.includes("could not find the function") ||
      msg.includes("pgrst202") ||
      msg.includes("42883")
    )
  );
}

function isListingEditGuardError(input: unknown) {
  const msg = String(input ?? "").toLowerCase();
  return (
    msg.includes("listings cannot be edited") ||
    (msg.includes("delete and create a new listing") && msg.includes("listing"))
  );
}

function restrictedChain(paymentOptions: Record<string, unknown>) {
  const mode = String(paymentOptions?.chain_mode ?? "").trim().toLowerCase();
  if (!mode || mode === "all") return "";
  return mode;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const listing_id = String(body?.listing_id ?? "");
  const buyer_wallet = String(body?.buyer_wallet ?? "");
  const chain = String(body?.chain ?? "");
  const quantity = body?.quantity === undefined ? 1 : Number(body.quantity);

  if (!listing_id) return bad("listing_id required");
  if (!buyer_wallet || !buyer_wallet.startsWith("0x")) return bad("buyer_wallet required");
  if (!Number.isInteger(quantity) || quantity < 1) return bad("quantity must be >= 1");

  const { data: listing, error: listErr } = await admin
    .from("market_listings")
    .select("id,seller_id,price_amount,currency,is_active,stock_qty,payment_options,created_at")
    .eq("id", listing_id)
    .maybeSingle();

  if (listErr || !listing || !listing.is_active) return bad("Listing not found");
  if (listing.currency !== "USDC") return bad("Listing is not USDC");
  if (listing.seller_id === user.id) return bad("You cannot buy your own listing");
  if (listing.stock_qty !== null && Number(listing.stock_qty) < quantity) return bad("Not enough stock");
  if ((listing as any)?.payment_options?.out_of_stock === true) return bad("Listing is out of stock");
  const requiredChain = restrictedChain(((listing as any)?.payment_options ?? {}) as Record<string, unknown>);
  if (requiredChain && chain.toLowerCase() !== requiredChain) {
    return bad(`Listing only accepts checkout on ${requiredChain}`);
  }

  const expiresAt = (listing as any)?.payment_options?.expires_at;
  if (expiresAt) {
    const exp = Date.parse(String(expiresAt));
    const createdAt = Date.parse(String((listing as any)?.created_at || ""));
    const isStaleDraftExpiry = Number.isFinite(createdAt) && Number.isFinite(exp) && exp <= createdAt;
    if (!isStaleDraftExpiry && Number.isFinite(exp) && exp <= Date.now()) return bad("This listing has expired");
  }

  const baseUnitPrice = toPositiveDecimalString(listing.price_amount);
  if (!baseUnitPrice) return bad("Invalid listing price");

  let unit_price = baseUnitPrice;
  const discount = (listing as any)?.payment_options?.discount;
  if (discount?.enabled) {
    const endsAt = discount?.endsAt ? Date.parse(String(discount.endsAt)) : null;
    const stillValid = !endsAt || (Number.isFinite(endsAt) && endsAt > Date.now());
    const discounted = toPositiveDecimalString(discount?.discountedPrice);
    if (stillValid && discounted) {
      unit_price = discounted;
    }
  }
  const amount = multiplyDecimalByQuantity(unit_price, quantity);

  let reservedStock:
    | {
        stock_before: number | null;
        stock_after: number | null;
        depleted: boolean;
        listing_active: boolean;
      }
    | null = null;

  const restoreReservedStock = async () => {
    if (
      reservedStock &&
      reservedStock.stock_before !== null &&
      reservedStock.stock_after !== null
    ) {
      await admin
        .from("market_listings")
        .update({
          stock_qty: reservedStock.stock_before,
          is_active: true,
          payment_options: (listing as any)?.payment_options ?? {},
          updated_at: new Date().toISOString(),
        })
        .eq("id", listing.id)
        .eq("stock_qty", reservedStock.stock_after);
    }
  };

  if (listing.stock_qty !== null) {
    const { data: reserveData, error: reserveErr } = await admin.rpc("market_reserve_listing_stock", {
      p_listing_id: listing.id,
      p_quantity: quantity,
    });
    if (reserveErr) {
      const reserveMsg = String(reserveErr.message || "");
      if (reserveMsg.toLowerCase().includes("not enough stock")) return bad("Not enough stock");
      if (isListingEditGuardError(reserveMsg)) {
        return bad("Stock reservation is blocked by listing edit guard. Apply latest DB migration and retry.");
      }

      if (!isMissingReserveStockFunction(reserveMsg)) {
        return bad(reserveMsg || "Unable to reserve stock");
      }

      // Fallback path when SQL reservation function is missing on target DB.
      const stockBefore = Number(listing.stock_qty);
      if (!Number.isFinite(stockBefore) || stockBefore < quantity) return bad("Not enough stock");
      const stockAfter = stockBefore - quantity;
      const nextPaymentOptions = (() => {
        const base = { ...((listing as any)?.payment_options ?? {}) } as any;
        delete base.out_of_stock;
        delete base.out_of_stock_at;
        if (stockAfter <= 0) {
          base.out_of_stock = true;
          base.out_of_stock_at = new Date().toISOString();
        }
        return base;
      })();

      const { data: updated, error: updateErr } = await admin
        .from("market_listings")
        .update({
          stock_qty: stockAfter,
          is_active: stockAfter > 0,
          payment_options: nextPaymentOptions,
          updated_at: new Date().toISOString(),
        })
        .eq("id", listing.id)
        .eq("stock_qty", stockBefore)
        .select("id")
        .maybeSingle();
      if (isListingEditGuardError(updateErr?.message || "")) {
        return bad("Stock reservation is blocked by listing edit guard. Apply latest DB migration and retry.");
      }
      if (updateErr || !updated) return bad(updateErr?.message || "Unable to reserve stock");

      reservedStock = {
        stock_before: stockBefore,
        stock_after: stockAfter,
        depleted: stockAfter <= 0,
        listing_active: stockAfter > 0,
      };
    } else {
      const row: any = Array.isArray(reserveData) ? reserveData[0] : reserveData;
      reservedStock = {
        stock_before: row?.stock_before === null || row?.stock_before === undefined ? null : Number(row.stock_before),
        stock_after: row?.stock_after === null || row?.stock_after === undefined ? null : Number(row.stock_after),
        depleted: row?.depleted === true,
        listing_active: row?.listing_active === true,
      };
    }
  }

  const cfgQuery = admin
    .from("market_chain_config")
    .select("chain,usdc_address,escrow_address,chain_id,confirmations_required,active")
    .eq("active", true);

  let cfg: any = null;
  let cfgErr: any = null;
  if (chain) {
    const out = await cfgQuery.eq("chain", chain).maybeSingle();
    cfg = out.data;
    cfgErr = out.error;
  } else {
    const out = await cfgQuery;
    cfgErr = out.error;
    const rows = out.data ?? [];
    if (rows.length === 1) {
      cfg = rows[0];
    } else if (rows.length > 1) {
      await restoreReservedStock();
      return bad("chain required when multiple active chains are configured");
    }
  }

  if (cfgErr || !cfg) {
    await restoreReservedStock();
    return bad("Chain config missing");
  }

  const { data: sellerWallet } = await admin
    .from("crypto_wallets")
    .select("address")
    .eq("user_id", listing.seller_id)
    .eq("chain", cfg.chain)
    .maybeSingle();

  if (!sellerWallet?.address) {
    await restoreReservedStock();
    return bad("Seller wallet not found for this chain");
  }

  const { data: order, error: ordErr } = await admin
    .from("market_orders")
    .insert({
      buyer_id: user.id,
      seller_id: listing.seller_id,
      listing_id: listing.id,
      quantity,
      unit_price,
      amount,
      currency: "USDC",
      status: "CREATED",
    })
    .select("*")
    .single();

  if (ordErr || !order) {
    await restoreReservedStock();
    return bad(ordErr?.message ?? "Order create failed");
  }

  const orderKey = orderKeyKeccak(order.id);

  const { error: escErr } = await admin.from("market_crypto_escrows").upsert(
    {
      order_id: order.id,
      order_key: orderKey,
      chain: cfg.chain,
      buyer_wallet,
      seller_wallet: sellerWallet.address,
      token_address: cfg.usdc_address,
      escrow_address: cfg.escrow_address,
      amount_units: Number(order.amount),
      amount_raw: null,
    },
    { onConflict: "order_id" },
  );

  if (escErr) {
    await restoreReservedStock();
    await admin.from("market_orders").delete().eq("id", order.id);
    return bad(escErr.message);
  }

  await admin.from("market_audit_logs").insert({
    actor_id: user.id,
    actor_type: "user",
    action: "USDC_ORDER_CREATED",
    entity_type: "market_orders",
    entity_id: order.id,
    payload: {
      order_key: orderKey,
      buyer_wallet,
      seller_wallet: sellerWallet.address,
      escrow: cfg.escrow_address,
      usdc: cfg.usdc_address,
      chain: cfg.chain,
      quantity,
      amount,
      stock_before: reservedStock?.stock_before ?? null,
      stock_after: reservedStock?.stock_after ?? null,
      stock_depleted: reservedStock?.depleted === true,
    },
  });

  if (reservedStock?.depleted) {
    await admin.from("market_audit_logs").insert({
      actor_id: user.id,
      actor_type: "system",
      action: "LISTING_AUTO_CLOSED_OUT_OF_STOCK",
      entity_type: "market_listings",
      entity_id: listing.id,
      payload: {
        listing_id: listing.id,
        order_id: order.id,
        stock_before: reservedStock.stock_before,
        stock_after: reservedStock.stock_after,
      },
    });
  }

  return ok({
    ok: true,
    order,
    crypto: {
      order_key: orderKey,
      chain: cfg.chain,
      chain_id: cfg.chain_id,
      confirmations_required: cfg.confirmations_required,
      usdc_address: cfg.usdc_address,
      escrow_address: cfg.escrow_address,
    },
  });
});
