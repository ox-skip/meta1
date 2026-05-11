import { adminError, getAdminContext, type AdminContext } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

const SUPPORT_BUCKET = "market-support";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function can(ctx: AdminContext, permission: string) {
  return ctx.roleKey === "super_admin" || ctx.permissions.includes("*") || ctx.permissions.includes(permission);
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function byId(rows: any[] | null | undefined, key = "id") {
  const map: Record<string, any> = {};
  for (const row of rows ?? []) {
    const id = String(row?.[key] ?? "");
    if (id) map[id] = row;
  }
  return map;
}

async function loadProfiles(admin: any, ids: string[]) {
  const list = unique(ids);
  if (!list.length) return {};

  const { data, error } = await admin
    .from("profiles")
    .select("id,email,username,full_name,public_uid,created_at")
    .in("id", list);
  if (error) throw error;
  return byId(data);
}

async function loadSellerProfiles(admin: any, ids: string[]) {
  const list = unique(ids);
  if (!list.length) return {};

  const { data, error } = await admin
    .from("market_seller_profiles")
    .select("user_id,market_username,display_name,business_name,is_verified,risk_score,active,payout_tier,created_at,updated_at")
    .in("user_id", list);
  if (error) throw error;
  return byId(data, "user_id");
}

function userBundle(userId: string | null | undefined, profiles: Record<string, any>, sellers: Record<string, any>) {
  const id = String(userId ?? "");
  if (!id) return null;
  return {
    id,
    profile: profiles[id] ?? null,
    seller: sellers[id] ?? null,
  };
}

async function signAttachment(admin: any, attachment: any) {
  const publicUrl = String(attachment?.public_url || "");
  const bucket = String(attachment?.storage_bucket || SUPPORT_BUCKET);
  const path = String(attachment?.storage_path || "");
  if (publicUrl || !path) return { ...attachment, signed_url: publicUrl || null };

  try {
    const { data } = await admin.storage.from(bucket).createSignedUrl(path, 3600);
    return { ...attachment, signed_url: data?.signedUrl ?? null };
  } catch {
    return { ...attachment, signed_url: null };
  }
}

async function loadSupportTicket(admin: any, ticketId: string) {
  const { data: ticket, error: ticketError } = await admin
    .from("market_support_tickets")
    .select("id,user_id,subject,category,priority,status,related_order_id,assigned_admin_id,message_slug,last_message_at,resolved_at,created_at,updated_at")
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError) throw ticketError;
  if (!ticket) return null;

  const { data: messages, error: messageError } = await admin
    .from("market_support_messages")
    .select("id,ticket_id,sender_id,sender_kind,message_slug,body,created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(300);
  if (messageError) throw messageError;

  const messageIds = unique((messages ?? []).map((row: any) => row.id));
  const { data: attachments, error: attachmentError } = messageIds.length
    ? await admin
        .from("market_support_message_attachments")
        .select("id,message_id,ticket_id,uploaded_by,kind,storage_bucket,storage_path,public_url,mime_type,file_name,file_size,created_at")
        .in("message_id", messageIds)
        .order("created_at", { ascending: true })
        .limit(500)
    : { data: [], error: null };
  if (attachmentError) throw attachmentError;

  const signedAttachments = await Promise.all((attachments ?? []).map((attachment: any) => signAttachment(admin, attachment)));
  const attachmentsByMessage: Record<string, any[]> = {};
  for (const attachment of signedAttachments) {
    const messageId = String(attachment?.message_id ?? "");
    if (!messageId) continue;
    attachmentsByMessage[messageId] = [...(attachmentsByMessage[messageId] ?? []), attachment];
  }

  const profileIds = unique([
    ticket.user_id,
    ticket.assigned_admin_id,
    ...(messages ?? []).map((row: any) => row.sender_id),
  ]);
  const profiles = await loadProfiles(admin, profileIds);
  const sellers = await loadSellerProfiles(admin, profileIds);

  return {
    ...ticket,
    user: userBundle(ticket.user_id, profiles, sellers),
    assigned_admin: userBundle(ticket.assigned_admin_id, profiles, sellers),
    messages: (messages ?? []).map((message: any) => ({
      ...message,
      sender: userBundle(message.sender_id, profiles, sellers),
      attachments: attachmentsByMessage[String(message.id)] ?? [],
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return methodNotAllowed(req);
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, { requireSession: true });
    if (ctx instanceof Response) return ctx;

    if (ctx.roleKey !== "super_admin" && ctx.roleKey !== "support_admin") return unauth();
    if (!can(ctx, "complaints.read") && !can(ctx, "complaints.respond")) return unauth();

    const body = await req.json().catch(() => ({}));
    const ticketId = String(body?.ticket_id ?? "").trim();
    if (!UUID_RE.test(ticketId)) return bad("Valid ticket_id is required");

    const admin = supabaseAdminClient();
    const ticket = await loadSupportTicket(admin, ticketId);
    if (!ticket) return bad("Support ticket not found");

    return ok({
      ok: true,
      generated_at: new Date().toISOString(),
      admin: {
        user_id: ctx.userId,
        role_key: ctx.roleKey,
        role_name: ctx.roleName,
        permissions: ctx.permissions,
      },
      ticket,
    });
  } catch (e) {
    return adminError(e);
  }
});
