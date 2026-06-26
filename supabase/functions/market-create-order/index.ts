import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

// market_orders.unit_price and market_orders.amount are both numeric(18,2)
// in the database (2 decimal places / cents). The amount-guard trigger
// (trg_market_orders_amount_guard) re-checks that
// round(amount, 2) = round(unit_price * quantity, 2) using the values that
// actually land in those columns. If we send a unit_price with more than 2
// decimal places, Postgres rounds it down when storing it, but our amount
// was computed from the *un-rounded* price — so the two numbers can drift
// apart by a cent and the trigger throws "amount must equal unit_price *
// quantity". Rounding unit_price to the same scale here, before computing
// amount, guarantees they always agree.
const ORDER_AMOUNT_SCALE = 2;

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

// Rounds a positive decimal string to `scale` decimal places using
// half-up rounding (matching Postgres's round() for positive numbers),
// done entirely in BigInt so there is no floating-point drift.
// Returns "0" if the value rounds down to zero at that scale.
function roundDecimalToScale(decimalStr: string, scale: number): string {
  const [wholeRaw, fracRaw = ""] = decimalStr.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";

  if (fracRaw.length <= scale) {
    const fracPart = fracRaw.replace(/0+$/, "");
    return fracPart ? `${whole}.${fracPart}` : whole;
  }

  const keep = fracRaw.slice(0, scale);
  const firstDroppedDigit = Number(fracRaw[scale] ?? "0");
  let combined = BigInt(`${whole}${keep}`.replace(/^0+(?=\d)/, "") || "0");
  if (firstDroppedDigit >= 5) combined += 1n;

  const combinedStr = combined.toString().padStart(scale + 1, "0");
  const intPart = combinedStr.slice(0, -scale) || "0";
  const fracPart = combinedStr.slice(-scale).replace(/0+$/, "");
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) return unauth();

  const body = await req.json().catch(() => ({}));
  const listing_id = String(body.listing_id ?? "");
  const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
  const delivery_address = body.delivery_address ?? {};

  if (!listing_id) return bad("listing_id required");
  if (!Number.isInteger(quantity) || quantity < 1) return bad("quantity must be >= 1");

  const { data: listing, error: le } = await admin
    .from("market_listings")
    .select("id,seller_id,price_amount,currency,is_active,stock_qty,payment_options,created_at")
    .eq("id", listing_id)
    .maybeSingle();

  if (le || !listing || !listing.is_active) return bad("Listing not found or inactive");
  if (listing.seller_id === u.user.id) return bad("You cannot buy your own listing");

  if (listing.stock_qty !== null && listing.stock_qty < quantity) {
    return bad("Not enough stock");
  }
  if ((listing as any)?.payment_options?.out_of_stock === true) {
    return bad("Listing is out of stock");
  }

  const expiresAt = (listing as any)?.payment_options?.expires_at;
  if (expiresAt) {
    const exp = Date.parse(String(expiresAt));
    const createdAt = Date.parse(String((listing as any)?.created_at || ""));
    const isStaleDraftExpiry = Number.isFinite(createdAt) && Number.isFinite(exp) && exp <= createdAt;
    if (!isStaleDraftExpiry && Number.isFinite(exp) && exp <= Date.now()) {
      return bad("This listing has expired");
    }
  }

  const baseUnitPrice = toPositiveDecimalString(listing.price_amount);
  if (!baseUnitPrice) return bad("Invalid listing price");

  let unit_price = baseUnitPrice;
  const d = (listing as any)?.payment_options?.discount;
  if (d?.enabled) {
    const endsAt = d?.endsAt ? Date.parse(String(d.endsAt)) : null;
    const stillValid = !endsAt || (Number.isFinite(endsAt) && endsAt > Date.now());
    const discounted = toPositiveDecimalString(d?.discountedPrice);
    if (stillValid && discounted) {
      unit_price = discounted;
    }
  }

  // Round to the same scale market_orders.unit_price actually stores
  // (numeric(18,2)) *before* multiplying, so the amount we compute here
  // matches exactly what the amount-guard trigger will recompute from the
  // stored unit_price. This is what prevents the
  // "amount must equal unit_price * quantity" error.
  unit_price = roundDecimalToScale(unit_price, ORDER_AMOUNT_SCALE);
  if (!unit_price || unit_price === "0") {
    return bad("Listing price is too small to process at order time.");
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

      // Fallback path if SQL function is missing in the target DB.
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

  const { data: order, error } = await admin
    .from("market_orders")
    .insert({
      buyer_id: u.user.id,
      seller_id: listing.seller_id,
      listing_id: listing.id,
      quantity,
      unit_price,
      amount,
      currency: listing.currency,
      status: "CREATED",
      delivery_address,
      note: body.note ? String(body.note) : null,
    })
    .select("*")
    .single();

  if (error) {
    // Best-effort restore if order insert fails after stock reservation.
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
    return bad(error.message);
  }

  await admin.from("market_audit_logs").insert({
    actor_id: u.user.id,
    actor_type: "user",
    action: "ORDER_CREATED",
    entity_type: "market_orders",
    entity_id: order.id,
    payload: {
      listing_id,
      quantity,
      amount,
      stock_before: reservedStock?.stock_before ?? null,
      stock_after: reservedStock?.stock_after ?? null,
      stock_depleted: reservedStock?.depleted === true,
    },
  });

  if (reservedStock?.depleted) {
    await admin.from("market_audit_logs").insert({
      actor_id: u.user.id,
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

  return ok({ order });
});