import { adminError, getAdminContext, getForwardedAdminHeaders, type AdminContext } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

function can(ctx: AdminContext, permission: string) {
  return ctx.roleKey === "super_admin" || ctx.permissions.includes("*") || ctx.permissions.includes(permission);
}

function requirePermission(ctx: AdminContext, permission: string) {
  return can(ctx, permission) ? null : unauth();
}

function requireSupportTicketAccess(ctx: AdminContext, permission: string) {
  const blocked = requirePermission(ctx, permission);
  if (blocked) return blocked;
  return ctx.roleKey === "super_admin" || ctx.roleKey === "support_admin" ? null : unauth();
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

function adminPassword(input: unknown) {
  const password = String(input ?? "");
  return password.trim() ? password : null;
}

function cleanText(input: unknown, max = 500) {
  const value = String(input ?? "").trim();
  return value ? value.slice(0, max) : null;
}

function cleanKey(name: string, input: unknown) {
  const value = String(input ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_:-]{3,80}$/.test(value)) throw new Error(`${name} must be a lowercase key`);
  return value;
}

function optionalUuid(name: string, value: unknown) {
  const raw = String(value ?? "").trim();
  return raw ? requireUuid(name, raw) : null;
}

function optionalInt(input: unknown, fallback: number | null, min = 0, max = 1000000) {
  if (input === undefined || input === null || input === "") return fallback;
  const value = Math.trunc(Number(input));
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`number must be between ${min} and ${max}`);
  return value;
}

function optionalIsoDate(name: string, input: unknown) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} must be a valid date`);
  return date.toISOString();
}

function jsonObject(name: string, input: unknown) {
  if (input === undefined || input === null || input === "") return {};
  if (typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input === "string") {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }
  throw new Error(`${name} must be a JSON object`);
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

async function functionInvokeErrorMessage(error: any) {
  const fallback = String(error?.message || error || "Edge Function failed");
  const context = error?.context;
  if (!context || typeof context.text !== "function") return fallback;

  try {
    const res = typeof context.clone === "function" ? context.clone() : context;
    const text = await res.text();
    if (!text) return fallback;
    try {
      const json = JSON.parse(text);
      return String(json?.error || json?.message || text || fallback);
    } catch {
      return text.length < 600 ? text : fallback;
    }
  } catch {
    return fallback;
  }
}

async function invokeAdminFunction(admin: any, req: Request, name: string, body: Record<string, unknown>) {
  const { data, error } = await admin.functions.invoke(name, {
    body,
    headers: getForwardedAdminHeaders(req),
  });
  if (error) throw new Error(await functionInvokeErrorMessage(error));
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

async function setMarketStoreFeature(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "users.moderate");
  if (blocked) return blocked;

  const userId = requireUuid("user_id", body.user_id);
  const featured = requireBoolean("featured_enabled", body.featured_enabled);
  const featuredUntil = optionalIsoDate("featured_until", body.featured_until);
  const featuredListingLimit = optionalInt(body.featured_listing_limit, 12, 1, 100);

  const { data, error } = await admin
    .from("market_seller_profiles")
    .update({
      featured_enabled: featured,
      featured_until: featured ? featuredUntil : null,
      featured_listing_limit: featured ? featuredListingLimit : 12,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select("user_id,market_username,business_name,featured_enabled,featured_until,featured_listing_limit,updated_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: featured ? "MARKET_STORE_FEATURE_ENABLED" : "MARKET_STORE_FEATURE_DISABLED",
    entity_type: "market_seller_profiles",
    entity_id: userId,
    payload: {
      market_username: data.market_username,
      business_name: data.business_name,
      featured_until: data.featured_until,
      featured_listing_limit: data.featured_listing_limit,
      note: adminNote(body.note),
    },
  });

  return ok({ ok: true, seller: data });
}

async function banUser(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "users.delete");
  if (blocked) return blocked;

  const userId = requireUuid("user_id", body.user_id);
  if (userId === ctx.userId) return bad("You cannot ban your own admin account");

  const nowIso = new Date().toISOString();
  const banDuration = String(body.ban_duration ?? "876000h").trim() || "876000h";

  const { error: sellerError } = await admin
    .from("market_seller_profiles")
    .update({ active: false, updated_at: nowIso })
    .eq("user_id", userId);
  if (sellerError) return bad(sellerError.message);

  const { error: listingError } = await admin
    .from("market_listings")
    .update({ is_active: false, updated_at: nowIso })
    .eq("seller_id", userId);
  if (listingError) return bad(listingError.message);

  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banDuration,
  });
  const warning = error ? `Marketplace profile was banned, but login ban failed: ${error.message}` : null;

  await audit(admin, ctx, {
    action: error ? "USER_MARKETPLACE_BANNED_AUTH_FAILED" : "USER_LOGIN_BANNED",
    entity_type: "profiles",
    entity_id: userId,
    payload: { ban_duration: banDuration, auth_banned: !error, auth_error: error?.message ?? null, note: adminNote(body.note) },
  });

  return ok({ ok: true, user: data?.user ?? null, warning });
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

async function replySupportTicket(admin: any, ctx: AdminContext, body: any) {
  const blocked = requireSupportTicketAccess(ctx, "complaints.respond");
  if (blocked) return blocked;

  const ticketId = requireUuid("ticket_id", body.ticket_id);
  const message = String(body.body ?? "").trim().slice(0, 3000);
  const attachmentsInput = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
  if (!message && !attachmentsInput.length) return bad("Reply or attachment required");

  const { data: ticket, error: ticketError } = await admin
    .from("market_support_tickets")
    .select("id,user_id,status,subject")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError) return bad(ticketError.message);
  if (!ticket?.id) return bad("Support ticket not found");

  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("market_support_messages")
    .insert({
      ticket_id: ticketId,
      sender_id: ctx.userId,
      sender_kind: "ADMIN",
      body: message,
    })
    .select("id,ticket_id,sender_id,sender_kind,body,created_at")
    .single();
  if (error) return bad(error.message);

  let attachments: any[] = [];
  if (attachmentsInput.length) {
    let rows: any[];
    try {
      rows = attachmentsInput.map((item: any) => {
        const storagePath = String(item?.storage_path ?? "").trim();
        const storageBucket = String(item?.storage_bucket ?? "market-support").trim() || "market-support";
        const kind = String(item?.kind ?? "file").trim().toLowerCase();
        if (!storagePath) throw new Error("attachment storage_path required");
        if (!["image", "video", "audio", "file"].includes(kind)) throw new Error("unsupported attachment kind");
        if (storageBucket !== "market-support") throw new Error("unsupported attachment bucket");
        if (!storagePath.startsWith(`${ctx.userId}/`)) throw new Error("attachment path must belong to this admin");
        return {
          message_id: data.id,
          ticket_id: ticketId,
          uploaded_by: ctx.userId,
          kind,
          storage_bucket: storageBucket,
          storage_path: storagePath,
          public_url: item?.public_url ? String(item.public_url) : null,
          mime_type: item?.mime_type ? String(item.mime_type).slice(0, 160) : null,
          file_name: item?.file_name ? String(item.file_name).slice(0, 180) : null,
          file_size: Number.isFinite(Number(item?.file_size)) ? Number(item.file_size) : null,
        };
      });
    } catch (e) {
      return bad(String((e as any)?.message || e || "Invalid support attachment"));
    }
    const { data: attachmentRows, error: attachmentError } = await admin
      .from("market_support_message_attachments")
      .insert(rows)
      .select("id,message_id,ticket_id,uploaded_by,kind,storage_bucket,storage_path,public_url,mime_type,file_name,file_size,created_at");
    if (attachmentError) return bad(attachmentError.message);
    attachments = attachmentRows ?? [];
  }

  const nextStatus = String(ticket.status ?? "").toUpperCase() === "OPEN" ? "IN_PROGRESS" : ticket.status;
  const { error: updateError } = await admin
    .from("market_support_tickets")
    .update({
      assigned_admin_id: ctx.userId,
      status: nextStatus,
      last_message_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", ticketId);
  if (updateError) return bad(updateError.message);

  await audit(admin, ctx, {
    action: "SUPPORT_TICKET_REPLIED",
    entity_type: "market_support_tickets",
    entity_id: ticketId,
    payload: { user_id: ticket.user_id, subject: ticket.subject, note: adminNote(body.note) },
  });

  return ok({ ok: true, message: { ...data, attachments } });
}

async function updateSupportTicketStatus(admin: any, ctx: AdminContext, body: any) {
  const blocked = requireSupportTicketAccess(ctx, "complaints.respond");
  if (blocked) return blocked;

  const ticketId = requireUuid("ticket_id", body.ticket_id);
  const status = String(body.status ?? "").trim().toUpperCase();
  if (!["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(status)) return bad("Unsupported support status");

  const priority = body.priority === undefined ? null : String(body.priority ?? "").trim().toUpperCase();
  if (priority && !["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) return bad("Unsupported support priority");

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status,
    assigned_admin_id: ctx.userId,
    resolved_at: ["RESOLVED", "CLOSED"].includes(status) ? nowIso : null,
    updated_at: nowIso,
  };
  if (priority) patch.priority = priority;

  const { data, error } = await admin
    .from("market_support_tickets")
    .update(patch)
    .eq("id", ticketId)
    .select("id,user_id,subject,status,priority,assigned_admin_id,updated_at,resolved_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: "SUPPORT_TICKET_STATUS_UPDATED",
    entity_type: "market_support_tickets",
    entity_id: ticketId,
    payload: { status, priority, user_id: data.user_id, note: adminNote(body.note) },
  });

  return ok({ ok: true, ticket: data });
}

async function resolveProfileByEmail(admin: any, emailInput: unknown) {
  const email = String(emailInput ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("valid user email is required");

  const { data, error } = await admin
    .from("profiles")
    .select("id,email,username,full_name")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("No existing user profile found for that email. Ask the user to sign up first.");
  return data;
}

async function loadAdminRole(admin: any, roleKey: string) {
  const { data, error } = await admin
    .from("market_admin_roles")
    .select("key,name")
    .eq("key", roleKey)
    .maybeSingle();
  if (error) throw error;
  if (!data?.key) throw new Error("Unknown admin role");
  return data;
}

async function upsertAdminUser(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "admin.members.manage");
  if (blocked) return blocked;

  const roleKey = String(body.role_key ?? "").trim();
  if (!roleKey) return bad("role_key required");
  await loadAdminRole(admin, roleKey);

  const target = body.user_id
    ? { id: requireUuid("user_id", body.user_id), email: null }
    : await resolveProfileByEmail(admin, body.email);

  const isSelf = target.id === ctx.userId;
  const isActive = body.is_active === undefined ? true : requireBoolean("is_active", body.is_active);
  if (isSelf && roleKey !== ctx.roleKey) return bad("You cannot change your own admin role");
  if (isSelf && !isActive) return bad("You cannot remove your own admin access");

  const password = adminPassword(body.password);
  const displayName = String(body.display_name ?? "").trim() || null;

  const { data, error } = await admin.rpc("market_admin_upsert_user", {
    p_target_user_id: target.id,
    p_role_key: roleKey,
    p_password: password,
    p_display_name: displayName,
    p_is_active: isActive,
    p_actor_id: ctx.userId === "service-token" ? null : ctx.userId,
  });
  if (error) return bad(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  await audit(admin, ctx, {
    action: password ? "ADMIN_MEMBER_UPSERTED_PASSWORD_SET" : "ADMIN_MEMBER_UPSERTED",
    entity_type: "market_admin_users",
    entity_id: target.id,
    payload: {
      role_key: roleKey,
      is_active: isActive,
      email: target.email ?? body.email ?? null,
      password_changed: Boolean(password),
      note: adminNote(body.note),
    },
  });

  return ok({ ok: true, admin_user: row });
}

async function setAdminUserActive(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "admin.members.manage");
  if (blocked) return blocked;

  const userId = requireUuid("user_id", body.user_id);
  const isActive = requireBoolean("is_active", body.is_active);
  if (userId === ctx.userId && !isActive) return bad("You cannot remove your own admin access");

  const { data, error } = await admin
    .from("market_admin_users")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("user_id,role_key,is_active,display_name,updated_at,last_login_at,last_password_change_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: isActive ? "ADMIN_MEMBER_REACTIVATED" : "ADMIN_MEMBER_REMOVED",
    entity_type: "market_admin_users",
    entity_id: userId,
    payload: { target_role_key: data.role_key, note: adminNote(body.note) },
  });

  return ok({ ok: true, admin_user: data });
}

async function upsertRewardTask(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "rewards.tasks.manage");
  if (blocked) return blocked;

  const nowIso = new Date().toISOString();
  const taskId = optionalUuid("task_id", body.task_id);
  const category = String(body.category ?? "custom").trim().toLowerCase();
  if (!["watch", "market", "social", "onchain", "custom"].includes(category)) return bad("Unsupported reward task category");

  const triggerType = String(body.trigger_type ?? "client_claim").trim().toLowerCase();
  if (!["client_claim", "system_event", "admin_review", "ad_reward", "manual_adjustment"].includes(triggerType)) {
    return bad("Unsupported reward task trigger_type");
  }

  const title = cleanText(body.title, 140);
  if (!title || title.length < 3) return bad("title required");

  const patch: Record<string, unknown> = {
    task_key: cleanKey("task_key", body.task_key),
    title,
    description: cleanText(body.description, 1200),
    category,
    trigger_type: triggerType,
    reward_noms: optionalInt(body.reward_noms, 0, 0, 1000000),
    cooldown_seconds: optionalInt(body.cooldown_seconds, 0, 0, 31536000),
    daily_cap: optionalInt(body.daily_cap, null, 1, 1000000),
    weekly_cap: optionalInt(body.weekly_cap, null, 1, 1000000),
    lifetime_cap: optionalInt(body.lifetime_cap, null, 1, 1000000),
    requires_review: body.requires_review === undefined ? triggerType === "admin_review" : requireBoolean("requires_review", body.requires_review),
    active: body.active === undefined ? true : requireBoolean("active", body.active),
    starts_at: cleanText(body.starts_at, 80),
    ends_at: cleanText(body.ends_at, 80),
    sort_order: optionalInt(body.sort_order, 100, -100000, 100000),
    action_route: cleanText(body.action_route, 240),
    icon: cleanText(body.icon, 80),
    accent: cleanText(body.accent, 32),
    rules: jsonObject("rules", body.rules),
    ui: jsonObject("ui", body.ui),
    updated_by: ctx.userId === "service-token" ? null : ctx.userId,
    updated_at: nowIso,
  };

  const query = taskId
    ? admin.from("market_reward_tasks").update(patch).eq("id", taskId)
    : admin.from("market_reward_tasks").upsert(
        { ...patch, created_by: ctx.userId === "service-token" ? null : ctx.userId },
        { onConflict: "task_key" },
      );

  const { data, error } = await query
    .select("id,task_key,title,category,trigger_type,reward_noms,active,requires_review,sort_order,updated_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: taskId ? "REWARD_TASK_UPDATED" : "REWARD_TASK_UPSERTED",
    entity_type: "market_reward_tasks",
    entity_id: data.id,
    payload: { task_key: data.task_key, reward_noms: data.reward_noms, active: data.active, note: adminNote(body.note) },
  });

  return ok({ ok: true, task: data });
}

async function setRewardTaskActive(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "rewards.tasks.manage");
  if (blocked) return blocked;

  const taskId = requireUuid("task_id", body.task_id);
  const active = requireBoolean("active", body.active);
  const { data, error } = await admin
    .from("market_reward_tasks")
    .update({
      active,
      updated_by: ctx.userId === "service-token" ? null : ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .select("id,task_key,title,active,updated_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: active ? "REWARD_TASK_ACTIVATED" : "REWARD_TASK_PAUSED",
    entity_type: "market_reward_tasks",
    entity_id: taskId,
    payload: { task_key: data.task_key, note: adminNote(body.note) },
  });

  return ok({ ok: true, task: data });
}

async function upsertRewardPromotion(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "rewards.promotions.manage");
  if (blocked) return blocked;

  const promotionId = optionalUuid("promotion_id", body.promotion_id);
  const title = cleanText(body.title, 140);
  if (!title || title.length < 3) return bad("title required");

  const patch: Record<string, unknown> = {
    placement_key: cleanKey("placement_key", body.placement_key ?? "rewards_top"),
    store_id: optionalUuid("store_id", body.store_id),
    listing_id: optionalUuid("listing_id", body.listing_id),
    title,
    subtitle: cleanText(body.subtitle, 600),
    media_url: cleanText(body.media_url, 1000),
    sponsor_label: cleanText(body.sponsor_label, 80) || "Promoted",
    cta_label: cleanText(body.cta_label, 80),
    cta_route: cleanText(body.cta_route, 240),
    priority: optionalInt(body.priority, 100, -100000, 100000),
    active: body.active === undefined ? true : requireBoolean("active", body.active),
    starts_at: cleanText(body.starts_at, 80),
    ends_at: cleanText(body.ends_at, 80),
    metadata: jsonObject("metadata", body.metadata),
    updated_by: ctx.userId === "service-token" ? null : ctx.userId,
    updated_at: new Date().toISOString(),
  };

  const query = promotionId
    ? admin.from("market_reward_promotions").update(patch).eq("id", promotionId)
    : admin.from("market_reward_promotions").insert({
        ...patch,
        created_by: ctx.userId === "service-token" ? null : ctx.userId,
      });

  const { data, error } = await query
    .select("id,placement_key,title,subtitle,active,priority,starts_at,ends_at,updated_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: promotionId ? "REWARD_PROMOTION_UPDATED" : "REWARD_PROMOTION_CREATED",
    entity_type: "market_reward_promotions",
    entity_id: data.id,
    payload: { placement_key: data.placement_key, title: data.title, active: data.active, note: adminNote(body.note) },
  });

  return ok({ ok: true, promotion: data });
}

async function setRewardPromotionActive(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "rewards.promotions.manage");
  if (blocked) return blocked;

  const promotionId = requireUuid("promotion_id", body.promotion_id);
  const active = requireBoolean("active", body.active);
  const { data, error } = await admin
    .from("market_reward_promotions")
    .update({
      active,
      updated_by: ctx.userId === "service-token" ? null : ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", promotionId)
    .select("id,placement_key,title,active,updated_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: active ? "REWARD_PROMOTION_ACTIVATED" : "REWARD_PROMOTION_PAUSED",
    entity_type: "market_reward_promotions",
    entity_id: promotionId,
    payload: { placement_key: data.placement_key, title: data.title, note: adminNote(body.note) },
  });

  return ok({ ok: true, promotion: data });
}

async function adjustRewardBalance(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "rewards.adjust");
  if (blocked) return blocked;

  const userId = requireUuid("user_id", body.user_id);
  const rawAmount = Math.trunc(Number(body.amount ?? body.delta ?? 0));
  if (!Number.isFinite(rawAmount) || rawAmount === 0) return bad("amount must be a non-zero number");
  const amount = Math.abs(rawAmount);
  if (amount > 1000000) return bad("amount is too large");

  const note = adminNote(body.reason ?? body.note) || "Reward admin adjustment";
  const idempotencyKey = cleanText(body.idempotency_key, 160) || `admin-adjust:${ctx.userId}:${crypto.randomUUID()}`;
  const createdBy = ctx.userId === "service-token" ? null : ctx.userId;

  const rpcArgs = rawAmount > 0
    ? {
        p_user_id: userId,
        p_amount: amount,
        p_source: "admin_adjustment",
        p_reason: note,
        p_task_id: null,
        p_completion_id: null,
        p_entity_type: "admin_adjustment",
        p_entity_id: createdBy,
        p_idempotency_key: idempotencyKey,
        p_metadata: { note, adjusted_by: createdBy },
        p_created_by: createdBy,
      }
    : {
        p_user_id: userId,
        p_amount: amount,
        p_source: "admin_adjustment",
        p_reason: note,
        p_entity_type: "admin_adjustment",
        p_entity_id: createdBy,
        p_idempotency_key: idempotencyKey,
        p_metadata: { note, adjusted_by: createdBy },
        p_created_by: createdBy,
      };

  const { data, error } = await admin.rpc(rawAmount > 0 ? "market_reward_credit" : "market_reward_debit", rpcArgs);
  if (error) return bad(error.message);
  const ledger = Array.isArray(data) ? data[0] : data;

  await audit(admin, ctx, {
    action: rawAmount > 0 ? "REWARD_BALANCE_CREDITED" : "REWARD_BALANCE_DEBITED",
    entity_type: "market_reward_accounts",
    entity_id: userId,
    payload: { amount: rawAmount, ledger_id: ledger?.ledger_id ?? null, note },
  });

  return ok({ ok: true, ledger });
}

async function updateRewardReferralConfig(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "rewards.tasks.manage");
  if (blocked) return blocked;

  const enabled = body.enabled === undefined ? true : requireBoolean("enabled", body.enabled);
  const botEnabled = body.bot_filter_enabled === undefined ? true : requireBoolean("bot_filter_enabled", body.bot_filter_enabled);
  const joinerReward = optionalInt(body.joiner_reward_noms, 25, 0, 1000000);
  const referrerReward = optionalInt(body.referrer_reward_noms, 5, 0, 1000000);
  const maxIp = optionalInt(body.max_referrals_per_ip_hash, 5, 0, 1000000);
  const maxUserAgent = optionalInt(body.max_referrals_per_user_agent_hash, 10, 0, 1000000);
  const shareBaseUrl = cleanText(body.share_base_url, 500) || "https://bestcity-amber.vercel.app/register";

  const value = {
    enabled,
    joiner_reward_noms: joinerReward,
    referrer_reward_noms: referrerReward,
    qualification: "signup",
    share_base_url: shareBaseUrl,
    bot_filter: {
      enabled: botEnabled,
      max_referrals_per_ip_hash: maxIp,
      max_referrals_per_user_agent_hash: maxUserAgent,
      block_self_referral: true,
    },
  };

  const { data, error } = await admin
    .from("market_reward_config")
    .upsert({
      key: "referrals",
      value,
      public_read: true,
      updated_by: ctx.userId === "service-token" ? null : ctx.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" })
    .select("key,value,public_read,updated_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: "REWARD_REFERRAL_CONFIG_UPDATED",
    entity_type: "market_reward_config",
    entity_id: "referrals",
    payload: { value, note: adminNote(body.note) },
  });

  return ok({ ok: true, config: data });
}

async function setAppSystemControl(admin: any, ctx: AdminContext, body: any) {
  if (ctx.roleKey !== "super_admin") return unauth();

  const maintenanceEnabled = requireBoolean("maintenance_enabled", body.maintenance_enabled);
  const forceUpdate = body.force_update === undefined ? false : requireBoolean("force_update", body.force_update);
  const maintenanceMessage =
    cleanText(body.maintenance_message, 600) ||
    "BestCity Market is receiving a scheduled upgrade. Please check back soon.";
  const updateMessage =
    cleanText(body.update_message, 600) ||
    "A newer BestCity app version is required to continue.";

  const patch = {
    id: true,
    maintenance_enabled: maintenanceEnabled,
    maintenance_message: maintenanceMessage,
    maintenance_eta: cleanText(body.maintenance_eta, 140),
    force_update: forceUpdate,
    min_version: cleanText(body.min_version, 40) || "0.0.0",
    update_message: updateMessage,
    apk_url: cleanText(body.apk_url, 1000),
    updated_by: ctx.userId === "service-token" ? null : ctx.userId,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("app_system_control")
    .upsert(patch, { onConflict: "id" })
    .select("*")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: maintenanceEnabled ? "APP_MAINTENANCE_ENABLED" : "APP_MAINTENANCE_DISABLED",
    entity_type: "app_system_control",
    entity_id: "global",
    payload: {
      maintenance_enabled: maintenanceEnabled,
      force_update: forceUpdate,
      min_version: patch.min_version,
      note: adminNote(body.note),
    },
  });

  return ok({ ok: true, system_control: data });
}

async function reviewRewardCompletion(admin: any, ctx: AdminContext, body: any) {
  const blocked = requirePermission(ctx, "rewards.review");
  if (blocked) return blocked;

  const completionId = requireUuid("completion_id", body.completion_id);
  const decision = String(body.decision ?? body.status ?? "").trim().toLowerCase();
  if (!["approve", "approved", "reward", "rewarded", "reject", "rejected"].includes(decision)) {
    return bad("decision must be approve or reject");
  }

  const { data: completion, error: completionError } = await admin
    .from("market_reward_task_completions")
    .select("id,user_id,task_id,status,evidence,ledger_id")
    .eq("id", completionId)
    .maybeSingle();
  if (completionError) return bad(completionError.message);
  if (!completion?.id) return bad("Reward completion not found");

  const nowIso = new Date().toISOString();
  const reviewNote = adminNote(body.note);
  const reviewer = ctx.userId === "service-token" ? null : ctx.userId;

  if (["reject", "rejected"].includes(decision)) {
    const { data, error } = await admin
      .from("market_reward_task_completions")
      .update({
        status: "rejected",
        reviewed_by: reviewer,
        review_note: reviewNote,
        rejected_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", completionId)
      .select("id,user_id,task_id,status,review_note,rejected_at,updated_at")
      .single();
    if (error) return bad(error.message);

    await audit(admin, ctx, {
      action: "REWARD_COMPLETION_REJECTED",
      entity_type: "market_reward_task_completions",
      entity_id: completionId,
      payload: { user_id: data.user_id, task_id: data.task_id, note: reviewNote },
    });

    return ok({ ok: true, completion: data });
  }

  const { data: task, error: taskError } = await admin
    .from("market_reward_tasks")
    .select("id,task_key,title,reward_noms")
    .eq("id", completion.task_id)
    .maybeSingle();
  if (taskError) return bad(taskError.message);
  if (!task?.id) return bad("Reward task not found");

  let ledger: any = null;
  if (Number(task.reward_noms ?? 0) > 0 && completion.status !== "rewarded") {
    const { data: creditData, error: creditError } = await admin.rpc("market_reward_credit", {
      p_user_id: completion.user_id,
      p_amount: Number(task.reward_noms),
      p_source: "admin_review",
      p_reason: task.title,
      p_task_id: task.id,
      p_completion_id: completion.id,
      p_entity_type: "reward_task_completion",
      p_entity_id: completion.id,
      p_idempotency_key: `review:${completion.id}`,
      p_metadata: { task_key: task.task_key, review_note: reviewNote, evidence: completion.evidence ?? {} },
      p_created_by: reviewer,
    });
    if (creditError) return bad(creditError.message);
    ledger = Array.isArray(creditData) ? creditData[0] : creditData;
  }

  const { data, error } = await admin
    .from("market_reward_task_completions")
    .update({
      status: Number(task.reward_noms ?? 0) > 0 ? "rewarded" : "approved",
      ledger_id: ledger?.ledger_id ?? completion.ledger_id ?? null,
      reviewed_by: reviewer,
      review_note: reviewNote,
      completed_at: nowIso,
      rewarded_at: Number(task.reward_noms ?? 0) > 0 ? nowIso : null,
      updated_at: nowIso,
    })
    .eq("id", completionId)
    .select("id,user_id,task_id,status,ledger_id,review_note,rewarded_at,updated_at")
    .single();
  if (error) return bad(error.message);

  await audit(admin, ctx, {
    action: "REWARD_COMPLETION_APPROVED",
    entity_type: "market_reward_task_completions",
    entity_id: completionId,
    payload: { user_id: data.user_id, task_key: task.task_key, reward_noms: task.reward_noms, ledger_id: data.ledger_id, note: reviewNote },
  });

  return ok({ ok: true, completion: data, ledger });
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
    if (action === "set_market_store_feature") return await setMarketStoreFeature(admin, ctx, body);
    if (action === "ban_user") return await banUser(admin, ctx, body);
    if (action === "review_verification") return await reviewVerification(admin, ctx, body);
    if (action === "settle_order") return await settleOrder(admin, ctx, req, body);
    if (action === "set_stock_trading_pause") return await setStockTradingPause(admin, ctx, req, body);
    if (action === "stable_chain_action") return await stableChainAction(admin, ctx, req, body);
    if (action === "support_reply") return await replySupportTicket(admin, ctx, body);
    if (action === "support_update_status") return await updateSupportTicketStatus(admin, ctx, body);
    if (action === "upsert_admin_user") return await upsertAdminUser(admin, ctx, body);
    if (action === "set_admin_active") return await setAdminUserActive(admin, ctx, body);
    if (action === "set_app_system_control") return await setAppSystemControl(admin, ctx, body);
    if (action === "upsert_reward_task") return await upsertRewardTask(admin, ctx, body);
    if (action === "set_reward_task_active") return await setRewardTaskActive(admin, ctx, body);
    if (action === "upsert_reward_promotion") return await upsertRewardPromotion(admin, ctx, body);
    if (action === "set_reward_promotion_active") return await setRewardPromotionActive(admin, ctx, body);
    if (action === "adjust_reward_balance") return await adjustRewardBalance(admin, ctx, body);
    if (action === "update_reward_referral_config") return await updateRewardReferralConfig(admin, ctx, body);
    if (action === "review_reward_completion") return await reviewRewardCompletion(admin, ctx, body);

    return bad("Unsupported admin action");
  } catch (e) {
    return adminError(e);
  }
});
