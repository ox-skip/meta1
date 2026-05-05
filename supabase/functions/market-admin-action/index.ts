import { adminError, getAdminContext, getForwardedAdminHeaders, type AdminContext } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

function can(ctx: AdminContext, permission: string) {
  return ctx.roleKey === "super_admin" || ctx.permissions.includes("*") || ctx.permissions.includes(permission);
}

function requirePermission(ctx: AdminContext, permission: string) {
  return can(ctx, permission) ? null : unauth();
}

function requireUuid(name: string, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    throw new Error(`${name} must be a uuid`);
  }
  return raw;
}

function requireBoolean(name: string, value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false`);
}

function adminNote(input: unknown) {
  return String(input ?? "").trim().slice(0, 1000) || null;
}

async function audit(admin: any, ctx: AdminContext, input: {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  payload?: Record<string, unknown>;
}) {
  const { error } = await admin.from("market_audit_logs").insert({
    actor_id: ctx.userId === "service-token" ? null : ctx.userId,
    actor_type: "admin",
    action: input.action,
    entity_type: input.entity_type,
    entity_id: input.entity_id ?? null,
    payload: {
      role_key: ctx.roleKey,
      ...(input.payload ?? {}),
    },
  });
  if (error) console.warn("[market-admin-action] audit skipped:", error.message);
}

async function invokeAdminFunction(admin: any, req: Request, name: string, body: Record<string, unknown>) {
  const { data, error } = await admin.functions.invoke(name, {
    body,
    headers: getForwardedAdminHeaders(req),
  });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data;
}

async function markDisputeUnderReview(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "disputes.resolve");
  if (blocked) return blocked;

  const disputeId = body.dispute_id ? requireUuid("dispute_id", body.dispute_id) : null;
  const orderId = body.order_id ? requireUuid("order_id", body.order_id) : null;
  if (!disputeId && !orderId) return bad("dispute_id or order_id required");

  let query = admin
    .from("market_disputes")
    .update({ status: "UNDER_REVIEW", updated_at: new Date().toISOString() });
  query = disputeId ? query.eq("id", disputeId) : query.eq("order_id", orderId);
  const { data, error } = await query.select("id,order_id,status").single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: "DISPUTE_MARKED_UNDER_REVIEW",
    entity_type: "market_disputes",
    entity_id: data.id,
    payload: { order_id: data.order_id, note: adminNote(body.note) },
  });

  return ok({ ok: true, dispute: data });
}

async function resolveDispute(admin: any, ctx: AdminContext, req: Request, body: any) {
  const blocked = requirePermission(ctx, "disputes.resolve");
  if (blocked) return blocked;

  const orderId = requireUuid("order_id", body.order_id);
  const decision = String(body.decision ?? "").trim().toUpperCase();
  if (!["REFUND", "RELEASE"].includes(decision)) return bad("decision must be REFUND or RELEASE");

  const data = await invokeAdminFunction(admin, req, "market-admin-resolve-dispute", {
    order_id: orderId,
    decision,
    note: adminNote(body.note),
  });

  return ok({ ok: true, result: data });
}

async function setListingActive(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "listings.moderate");
  if (blocked) return blocked;

  const listingId = requireUuid("listing_id", body.listing_id);
  const isActive = requireBoolean("is_active", body.is_active);

  const { data, error } = await admin
    .from("market_listings")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", listingId)
    .select("id,seller_id,title,is_active,updated_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: isActive ? "LISTING_RE_ENABLED" : "LISTING_DISABLED",
    entity_type: "market_listings",
    entity_id: listingId,
    payload: { seller_id: data.seller_id, title: data.title, note: adminNote(body.note) },
  });

  return ok({ ok: true, listing: data });
}

async function setSellerActive(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "users.moderate");
  if (blocked) return blocked;

  const userId = requireUuid("user_id", body.user_id);
  const active = requireBoolean("active", body.active);
  const disableListings = body.disable_listings === undefined ? !active : requireBoolean("disable_listings", body.disable_listings);

  const { data, error } = await admin
    .from("market_seller_profiles")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("user_id,market_username,business_name,active,updated_at")
    .single();
  if (error) return bad(error.message);

  if (!active && disableListings) {
    const { error: listingError } = await admin
      .from("market_listings")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("seller_id", userId);
    if (listingError) return bad(listingError.message);
  }

  await audit(admin, ctx, {
    action: active ? "SELLER_PROFILE_REACTIVATED" : "SELLER_PROFILE_PAUSED",
    entity_type: "market_seller_profiles",
    entity_id: userId,
    payload: { disable_listings: disableListings, note: adminNote(body.note) },
  });

  return ok({ ok: true, seller: data });
}

async function banUser(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "users.delete");
  if (blocked) return blocked;

  const userId = requireUuid("user_id", body.user_id);
  if (userId === ctx.userId) return bad("You cannot ban your own admin account");

  const banDuration = String(body.ban_duration ?? "876000h").trim() || "876000h";
  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banDuration,
  });
  if (error) return bad(error.message);

  await admin.from("market_seller_profiles").update({ active: false, updated_at: new Date().toISOString() }).eq("user_id", userId);
  await admin.from("market_listings").update({ is_active: false, updated_at: new Date().toISOString() }).eq("seller_id", userId);

  await audit(admin, ctx, {
    action: "USER_LOGIN_BANNED",
    entity_type: "profiles",
    entity_id: userId,
    payload: { ban_duration: banDuration, note: adminNote(body.note) },
  });

  return ok({ ok: true, user: data.user ?? null });
}

async function reviewVerification(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "verification.review");
  if (blocked) return blocked;

  const requestId = body.request_id ? requireUuid("request_id", body.request_id) : null;
  const userId = body.user_id ? requireUuid("user_id", body.user_id) : null;
  if (!requestId && !userId) return bad("request_id or user_id required");

  const status = String(body.status ?? "").trim().toUpperCase();
  if (!["PENDING", "IN_REVIEW", "VERIFIED", "REJECTED", "RESUBMISSION_REQUIRED", "EXPIRED"].includes(status)) {
    return bad("Unsupported verification status");
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status,
    admin_note: adminNote(body.note),
    reviewed_by: ctx.userId === "service-token" ? null : ctx.userId,
    updated_at: nowIso,
  };

  if (["VERIFIED", "REJECTED", "RESUBMISSION_REQUIRED", "EXPIRED"].includes(status)) {
    patch.reviewed_at = nowIso;
  }
  if (status === "VERIFIED") {
    patch.verified_at = nowIso;
    patch.verification_url = null;
    patch.verification_url_expires_at = null;
    patch.last_error = null;
  }

  let query = admin.from("market_verification_requests").update(patch);
  query = requestId ? query.eq("id", requestId) : query.eq("user_id", userId);
  const { data, error } = await query.select("id,user_id,status,admin_note,reviewed_at,reviewed_by,verified_at").single();
  if (error) return bad(error.message);

  if (status === "VERIFIED" || status === "REJECTED" || status === "RESUBMISSION_REQUIRED" || status === "EXPIRED") {
    const { error: sellerError } = await admin
      .from("market_seller_profiles")
      .update({ is_verified: status === "VERIFIED", updated_at: nowIso })
      .eq("user_id", data.user_id);
    if (sellerError) return bad(sellerError.message);
  }

  await audit(admin, ctx, {
    action: "VERIFICATION_REVIEWED",
    entity_type: "market_verification_requests",
    entity_id: data.id,
    payload: { user_id: data.user_id, status, note: adminNote(body.note) },
  });

  return ok({ ok: true, verification: data });
}

async function settleOrder(admin: any, ctx: AdminContext, req: Request, body: any) {
  const blocked = requirePermission(ctx, "escrow.settle");
  if (blocked) return blocked;

  const orderId = requireUuid("order_id", body.order_id);
  const decision = String(body.decision ?? "").trim().toUpperCase();
  if (!["REFUND", "RELEASE"].includes(decision)) return bad("decision must be REFUND or RELEASE");

  const { data: order, error } = await admin.from("market_orders").select("id,currency,status").eq("id", orderId).maybeSingle();
  if (error) return bad(error.message);
  if (!order) return bad("Order not found");

  const stableOrder = ["USDC", "USDT"].includes(String(order.currency ?? "").toUpperCase());
  if (stableOrder) {
    const data = await invokeAdminFunction(admin, req, "market-stable-admin-settle", {
      order_id: orderId,
      decision,
      note: adminNote(body.note),
    });
    return ok({ ok: true, result: data });
  }

  const { data: piRows, error: piError } = await admin
    .from("market_pi_payments")
    .select("id,status")
    .eq("order_id", orderId)
    .in("status", ["UNDERPAID", "SETTLED"])
    .limit(1);
  if (piError) return bad(piError.message);

  if (Array.isArray(piRows) && piRows.length > 0) {
    const fn = decision === "RELEASE" ? "market-pi-release-intent" : "market-pi-refund-intent";
    const data = await invokeAdminFunction(admin, req, fn, {
      order_id: orderId,
      note: adminNote(body.note),
    });
    return ok({ ok: true, result: data });
  }

  return bad("This order is not a stablecoin or Pi escrow order. Use dispute resolution for wallet orders.");
}

async function setStockTradingPause(admin: any, ctx: AdminContext, req: Request, body: any) {
  const blocked = requirePermission(ctx, "chain.admin");
  if (blocked) return blocked;

  const stockId = requireUuid("stock_id", body.stock_id);
  const pauseMinutes = Math.max(0, Math.min(Number(body.pause_minutes ?? 0), 10080));
  const data = await invokeAdminFunction(admin, req, "stock-chain-sync", {
    action: "set_trading_pause",
    stock_id: stockId,
    pause_minutes: pauseMinutes,
  });

  await audit(admin, ctx, {
    action: "STOCK_TRADING_PAUSE_SET",
    entity_type: "market_stock_identities",
    entity_id: stockId,
    payload: { pause_minutes: pauseMinutes, note: adminNote(body.note) },
  });

  return ok({ ok: true, result: data });
}

async function stableChainAction(admin: any, ctx: AdminContext, req: Request, body: any) {
  const blocked = requirePermission(ctx, "chain.admin");
  if (blocked) return blocked;

  const chain = String(body.chain ?? "").trim();
  const action = String(body.chain_action ?? body.stable_action ?? "").trim();
  if (!chain) return bad("chain required");
  if (!action) return bad("chain_action required");

  const data = await invokeAdminFunction(admin, req, "market-stable-admin-ops", {
    ...body,
    action,
    chain,
    note: adminNote(body.note),
  });

  return ok({ ok: true, result: data });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, { requireSession: true });
    if (ctx instanceof Response) return ctx;

    const admin = supabaseAdminClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim().toLowerCase();

    if (action === "mark_dispute_under_review") return await markDisputeUnderReview(admin, ctx, body);
    if (action === "resolve_dispute") return await resolveDispute(admin, ctx, req, body);
    if (action === "set_listing_active") return await setListingActive(admin, ctx, body);
    if (action === "set_seller_active") return await setSellerActive(admin, ctx, body);
    if (action === "ban_user") return await banUser(admin, ctx, body);
    if (action === "review_verification") return await reviewVerification(admin, ctx, body);
    if (action === "settle_order") return await settleOrder(admin, ctx, req, body);
    if (action === "set_stock_trading_pause") return await setStockTradingPause(admin, ctx, req, body);
    if (action === "stable_chain_action") return await stableChainAction(admin, ctx, req, body);

    return bad("Unsupported admin action");
  } catch (e) {
    return adminError(e);
  }
});
