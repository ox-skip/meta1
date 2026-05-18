import { adminError, getAdminContext, type AdminContext } from "../_shared/market/admin.ts";
import { methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

const DEFAULT_LIMIT = 30;
const DISPUTE_BUCKET = "market-disputes";

function can(ctx: AdminContext, permission: string) {
  return ctx.roleKey === "super_admin" || ctx.permissions.includes("*") || ctx.permissions.includes(permission);
}

function canAny(ctx: AdminContext, permissions: string[]) {
  return permissions.some((permission) => can(ctx, permission));
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

async function loadListingsByIds(admin: any, ids: string[]) {
  const list = unique(ids);
  if (!list.length) return {};

  const { data, error } = await admin
    .from("market_listings")
    .select("id,seller_id,category,sub_category,title,price_amount,currency,delivery_type,stock_qty,is_active,created_at,updated_at")
    .in("id", list);
  if (error) throw error;
  return byId(data);
}

async function loadOrdersByIds(admin: any, ids: string[]) {
  const list = unique(ids);
  if (!list.length) return {};

  const { data, error } = await admin
    .from("market_orders")
    .select("id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,currency,status,version,fee_amount,delivery_address,note,created_at,in_escrow_at,out_for_delivery_at,deliverable_uploaded_at,delivered_at,released_at,refunded_at,cancelled_at")
    .in("id", list);
  if (error) throw error;
  return byId(data);
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
  const bucket = String(attachment?.storage_bucket || DISPUTE_BUCKET);
  const path = String(attachment?.storage_path || "");
  if (publicUrl || !path) return { ...attachment, signed_url: publicUrl || null };

  try {
    const { data } = await admin.storage.from(bucket).createSignedUrl(path, 3600);
    return { ...attachment, signed_url: data?.signedUrl ?? null };
  } catch {
    return { ...attachment, signed_url: null };
  }
}

async function loadSupport(admin: any, ctx: AdminContext) {
  const canUseTicketQueue = ctx.roleKey === "super_admin" || ctx.roleKey === "support_admin";
  const [disputesRes, ticketsRes] = await Promise.all([
    admin
      .from("market_disputes")
      .select("id,order_id,opened_by,reason,status,resolution,resolved_by,created_at,updated_at")
      .in("status", ["OPEN", "UNDER_REVIEW"])
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    canUseTicketQueue
      ? admin
          .from("market_support_tickets")
          .select("id,user_id,subject,category,priority,status,related_order_id,assigned_admin_id,message_slug,last_message_at,resolved_at,created_at,updated_at")
          .order("last_message_at", { ascending: false })
          .limit(DEFAULT_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (disputesRes.error) throw disputesRes.error;
  if (ticketsRes.error) throw ticketsRes.error;
  const disputes = disputesRes.data ?? [];
  const tickets = ticketsRes.data ?? [];

  const orderIds = unique((disputes ?? []).map((row: any) => row.order_id));
  const orders = await loadOrdersByIds(admin, orderIds);
  const listingIds = unique(Object.values(orders).map((row: any) => row?.listing_id));
  const listings = await loadListingsByIds(admin, listingIds);

  const { data: deliverables, error: deliverableError } = orderIds.length
    ? await admin.from("market_deliverables").select("id,order_id,uploaded_by,created_at").in("order_id", orderIds)
    : { data: [], error: null };
  if (deliverableError) throw deliverableError;
  const deliverablesByOrder = byId(deliverables, "order_id");

  const disputeIds = unique((disputes ?? []).map((row: any) => row.id));
  const { data: disputeMessages, error: disputeMessagesError } = disputeIds.length
    ? await admin
        .from("market_dispute_messages")
        .select("id,dispute_id,order_id,sender_id,sender_kind,body,created_at")
        .in("dispute_id", disputeIds)
        .order("created_at", { ascending: true })
        .limit(400)
    : { data: [], error: null };
  if (disputeMessagesError) throw disputeMessagesError;

  const disputeMessageIds = unique((disputeMessages ?? []).map((row: any) => row.id));
  const { data: disputeAttachments, error: disputeAttachmentsError } = disputeMessageIds.length
    ? await admin
        .from("market_dispute_attachments")
        .select("id,dispute_id,message_id,order_id,uploaded_by,kind,storage_bucket,storage_path,public_url,mime_type,file_name,file_size,created_at")
        .in("message_id", disputeMessageIds)
        .order("created_at", { ascending: true })
        .limit(800)
    : { data: [], error: null };
  if (disputeAttachmentsError) throw disputeAttachmentsError;

  const signedDisputeAttachments = await Promise.all((disputeAttachments ?? []).map((attachment: any) => signAttachment(admin, attachment)));
  const disputeAttachmentsByMessage: Record<string, any[]> = {};
  for (const attachment of signedDisputeAttachments) {
    const messageId = String(attachment?.message_id ?? "");
    if (!messageId) continue;
    disputeAttachmentsByMessage[messageId] = [...(disputeAttachmentsByMessage[messageId] ?? []), attachment];
  }

  const messagesByDispute: Record<string, any[]> = {};
  for (const message of disputeMessages ?? []) {
    const disputeId = String(message.dispute_id ?? "");
    if (!disputeId) continue;
    messagesByDispute[disputeId] = [...(messagesByDispute[disputeId] ?? []), message];
  }

  const ticketIds = unique((tickets ?? []).map((row: any) => row.id));
  const { data: ticketMessages, error: ticketMessagesError } = ticketIds.length
    ? await admin
        .from("market_support_messages")
        .select("id,ticket_id,sender_id,sender_kind,message_slug,body,created_at")
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: true })
        .limit(300)
    : { data: [], error: null };
  if (ticketMessagesError) throw ticketMessagesError;

  const messageIds = unique((ticketMessages ?? []).map((row: any) => row.id));
  const { data: messageAttachments, error: messageAttachmentsError } = messageIds.length
    ? await admin
        .from("market_support_message_attachments")
        .select("id,message_id,ticket_id,uploaded_by,kind,storage_bucket,storage_path,public_url,mime_type,file_name,file_size,created_at")
        .in("message_id", messageIds)
        .order("created_at", { ascending: true })
        .limit(500)
    : { data: [], error: null };
  if (messageAttachmentsError) throw messageAttachmentsError;

  const attachmentsByMessage: Record<string, any[]> = {};
  for (const attachment of messageAttachments ?? []) {
    const messageId = String(attachment.message_id ?? "");
    if (!messageId) continue;
    attachmentsByMessage[messageId] = [...(attachmentsByMessage[messageId] ?? []), attachment];
  }

  const messagesByTicket: Record<string, any[]> = {};
  for (const message of ticketMessages ?? []) {
    const ticketId = String(message.ticket_id ?? "");
    if (!ticketId) continue;
    messagesByTicket[ticketId] = [...(messagesByTicket[ticketId] ?? []), message];
  }

  const profileIds = unique([
    ...(disputes ?? []).flatMap((row: any) => [row.opened_by, row.resolved_by]),
    ...Object.values(orders).flatMap((row: any) => [row?.buyer_id, row?.seller_id]),
    ...Object.values(listings).map((row: any) => row?.seller_id),
    ...(disputeMessages ?? []).map((row: any) => row.sender_id),
    ...(disputeAttachments ?? []).map((row: any) => row.uploaded_by),
    ...(tickets ?? []).flatMap((row: any) => [row.user_id, row.assigned_admin_id]),
    ...(ticketMessages ?? []).map((row: any) => row.sender_id),
  ]);
  const profiles = await loadProfiles(admin, profileIds);
  const sellers = await loadSellerProfiles(admin, profileIds);

  return {
    disputes: (disputes ?? []).map((dispute: any) => {
      const order = orders[String(dispute.order_id)] ?? null;
      const listing = order ? listings[String(order.listing_id)] ?? null : null;
      return {
        ...dispute,
        order,
        listing,
        deliverable: deliverablesByOrder[String(dispute.order_id)] ?? null,
        opened_by_user: userBundle(dispute.opened_by, profiles, sellers),
        buyer: userBundle(order?.buyer_id, profiles, sellers),
        seller: userBundle(order?.seller_id, profiles, sellers),
        messages: (messagesByDispute[String(dispute.id)] ?? []).map((message: any) => ({
          ...message,
          sender: userBundle(message.sender_id, profiles, sellers),
          attachments: disputeAttachmentsByMessage[String(message.id)] ?? [],
        })),
      };
    }),
    tickets: (tickets ?? []).map((ticket: any) => ({
      ...ticket,
      user: userBundle(ticket.user_id, profiles, sellers),
      assigned_admin: userBundle(ticket.assigned_admin_id, profiles, sellers),
      messages: (messagesByTicket[String(ticket.id)] ?? []).map((message: any) => ({
        ...message,
        sender: userBundle(message.sender_id, profiles, sellers),
        attachments: attachmentsByMessage[String(message.id)] ?? [],
      })),
    })),
  };
}

async function loadModeration(admin: any) {
  const [sellerRes, listingRes] = await Promise.all([
    admin
      .from("market_seller_profiles")
      .select("user_id,market_username,display_name,business_name,is_verified,risk_score,active,payout_tier,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    admin
      .from("market_listings")
      .select("id,seller_id,category,sub_category,title,price_amount,currency,delivery_type,stock_qty,is_active,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
  ]);

  if (sellerRes.error) throw sellerRes.error;
  if (listingRes.error) throw listingRes.error;

  const profileIds = unique([
    ...(sellerRes.data ?? []).map((row: any) => row.user_id),
    ...(listingRes.data ?? []).map((row: any) => row.seller_id),
  ]);
  const profiles = await loadProfiles(admin, profileIds);
  const sellers = await loadSellerProfiles(admin, profileIds);

  return {
    sellers: (sellerRes.data ?? []).map((seller: any) => ({
      ...seller,
      profile: profiles[String(seller.user_id)] ?? null,
    })),
    listings: (listingRes.data ?? []).map((listing: any) => ({
      ...listing,
      seller: userBundle(listing.seller_id, profiles, sellers),
    })),
  };
}

async function loadVerification(admin: any) {
  const { data, error } = await admin
    .from("market_verification_requests")
    .select("id,user_id,status,note,admin_note,submitted_at,reviewed_at,reviewed_by,created_at,updated_at,provider,verification_type,provider_applicant_id,provider_external_user_id,provider_level_name,provider_review_status,provider_review_answer,provider_review_reject_type,provider_reject_labels,country_code,document_type,provider_last_event_type,provider_last_event_at,verified_at,last_error")
    .order("updated_at", { ascending: false })
    .limit(DEFAULT_LIMIT);
  if (error) throw error;

  const profileIds = unique((data ?? []).flatMap((row: any) => [row.user_id, row.reviewed_by]));
  const profiles = await loadProfiles(admin, profileIds);
  const sellers = await loadSellerProfiles(admin, profileIds);

  return {
    requests: (data ?? []).map((request: any) => ({
      ...request,
      user: userBundle(request.user_id, profiles, sellers),
      reviewed_by_user: userBundle(request.reviewed_by, profiles, sellers),
    })),
  };
}

async function loadEscrow(admin: any) {
  const [ordersRes, chainsRes, stocksRes, auditsRes] = await Promise.all([
    admin
      .from("market_orders")
      .select("id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,currency,status,version,fee_amount,created_at,in_escrow_at,out_for_delivery_at,deliverable_uploaded_at,delivered_at,released_at,refunded_at,cancelled_at")
      .in("status", ["IN_ESCROW", "DISPUTED", "OUT_FOR_DELIVERY", "DELIVERABLE_UPLOADED", "DELIVERED"])
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    admin
      .from("market_chain_config")
      .select("id,chain,chain_id,escrow_address,confirmations_required,active,created_at,updated_at")
      .order("chain", { ascending: true }),
    admin
      .from("market_stock_identities")
      .select("id,store_id,slug,name,symbol,chain,token_address,pool_address,active,launch_guard_until,trading_paused_until,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    admin
      .from("market_audit_logs")
      .select("id,actor_id,actor_type,action,entity_type,entity_id,payload,created_at")
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
  ]);

  if (ordersRes.error) throw ordersRes.error;
  if (chainsRes.error) throw chainsRes.error;
  if (stocksRes.error) throw stocksRes.error;
  if (auditsRes.error) throw auditsRes.error;

  const orderIds = unique((ordersRes.data ?? []).map((row: any) => row.id));
  const listingIds = unique((ordersRes.data ?? []).map((row: any) => row.listing_id));
  const profileIds = unique([
    ...(ordersRes.data ?? []).flatMap((row: any) => [row.buyer_id, row.seller_id]),
    ...(stocksRes.data ?? []).map((row: any) => row.store_id),
    ...(auditsRes.data ?? []).map((row: any) => row.actor_id),
  ]);

  const [listings, profiles, sellers, escrowsRes, intentsRes, disputesRes] = await Promise.all([
    loadListingsByIds(admin, listingIds),
    loadProfiles(admin, profileIds),
    loadSellerProfiles(admin, profileIds),
    orderIds.length
      ? admin.from("market_crypto_escrows").select("order_id,chain,buyer_wallet,seller_wallet,token_address,escrow_address,amount_units,amount_raw,deposited_tx_hash,released_tx_hash,refunded_tx_hash,deposited_at,released_at,refunded_at,order_key,created_at,updated_at").in("order_id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? admin.from("market_crypto_intents").select("id,order_id,intent_type,status,chain,from_wallet,to_wallet,amount_units,amount_raw,client_reference,tx_hash,failure_reason,created_at,updated_at").in("order_id", orderIds).order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? admin.from("market_disputes").select("id,order_id,status,resolution,created_at,updated_at").in("order_id", orderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (escrowsRes.error) throw escrowsRes.error;
  if (intentsRes.error) throw intentsRes.error;
  if (disputesRes.error) throw disputesRes.error;

  const escrows = byId(escrowsRes.data, "order_id");
  const disputes = byId(disputesRes.data, "order_id");
  const intentsByOrder: Record<string, any[]> = {};
  for (const intent of intentsRes.data ?? []) {
    const orderId = String(intent.order_id ?? "");
    if (!orderId) continue;
    intentsByOrder[orderId] = [...(intentsByOrder[orderId] ?? []), intent];
  }

  return {
    orders: (ordersRes.data ?? []).map((order: any) => ({
      ...order,
      listing: listings[String(order.listing_id)] ?? null,
      buyer: userBundle(order.buyer_id, profiles, sellers),
      seller: userBundle(order.seller_id, profiles, sellers),
      crypto_escrow: escrows[String(order.id)] ?? null,
      crypto_intents: intentsByOrder[String(order.id)] ?? [],
      dispute: disputes[String(order.id)] ?? null,
    })),
    chains: chainsRes.data ?? [],
    stocks: (stocksRes.data ?? []).map((stock: any) => ({
      ...stock,
      store: userBundle(stock.store_id, profiles, sellers),
    })),
    audit_events: auditsRes.data ?? [],
  };
}

async function loadAdminMembers(admin: any) {
  const [adminsRes, rolesRes] = await Promise.all([
    admin
      .from("market_admin_users")
      .select("user_id,role_key,is_active,display_name,notes,created_by,created_at,updated_at,last_login_at,last_password_change_at")
      .order("updated_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    admin
      .from("market_admin_roles")
      .select("key,name,description,permissions,rank,created_at,updated_at")
      .order("rank", { ascending: true }),
  ]);

  if (adminsRes.error) throw adminsRes.error;
  if (rolesRes.error) throw rolesRes.error;

  const profileIds = unique([
    ...(adminsRes.data ?? []).flatMap((row: any) => [row.user_id, row.created_by]),
  ]);
  const profiles = await loadProfiles(admin, profileIds);

  return {
    users: (adminsRes.data ?? []).map((adminUser: any) => ({
      ...adminUser,
      profile: profiles[String(adminUser.user_id)] ?? null,
      created_by_profile: profiles[String(adminUser.created_by)] ?? null,
    })),
    roles: rolesRes.data ?? [],
  };
}

async function loadRewards(admin: any) {
  const [accountsRes, tasksRes, pendingRes, promotionsRes, ledgerRes, adSessionsRes, storeRes, listingRes, configRes, referralsRes, referralLeaderboardRes] = await Promise.all([
    admin
      .from("market_reward_accounts")
      .select("user_id,balance,lifetime_earned,lifetime_spent,tier_key,daily_streak,longest_streak,last_earned_at,last_spent_at,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    admin
      .from("market_reward_tasks")
      .select("id,task_key,title,description,category,trigger_type,reward_noms,cooldown_seconds,daily_cap,weekly_cap,lifetime_cap,requires_review,active,sort_order,action_route,icon,accent,rules,ui,created_at,updated_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(120),
    admin
      .from("market_reward_task_completions")
      .select("id,user_id,task_id,status,progress,evidence,review_note,reviewed_by,rewarded_at,created_at,updated_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    admin
      .from("market_reward_promotions")
      .select("id,placement_key,store_id,listing_id,title,subtitle,media_url,sponsor_label,cta_label,cta_route,priority,active,starts_at,ends_at,metadata,created_by,created_at,updated_at")
      .order("priority", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(80),
    admin
      .from("market_reward_ledger")
      .select("id,user_id,task_id,delta,balance_after,source,reason,entity_type,entity_id,status,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    admin
      .from("market_reward_ad_sessions")
      .select("id,user_id,task_id,provider,platform,ad_unit_id,reward_noms,status,provider_transaction_id,created_at,shown_at,client_earned_at,verified_at,rewarded_at,expires_at")
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    admin
      .from("market_seller_profiles")
      .select("user_id,market_username,display_name,business_name,is_verified,risk_score,active,payout_tier,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(250),
    admin
      .from("market_listings")
      .select("id,seller_id,category,sub_category,title,price_amount,currency,delivery_type,stock_qty,is_active,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(250),
    admin
      .from("market_reward_config")
      .select("key,value,public_read,updated_at")
      .in("key", ["referrals", "noms_economy", "rewards_ui"]),
    admin
      .from("market_referrals")
      .select("id,referrer_id,referred_user_id,referral_code,status,joiner_reward_noms,referrer_reward_noms,bot_score,bot_signals,qualified_at,rewarded_at,rejected_at,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    admin
      .from("market_referral_leaderboard_v")
      .select("user_id,code,username,full_name,public_uid,market_username,display_name,business_name,total_referrals,successful_referrals,referral_noms_earned,balance,lifetime_earned,last_referral_at")
      .order("successful_referrals", { ascending: false })
      .order("balance", { ascending: false })
      .limit(30),
  ]);

  if (accountsRes.error) throw accountsRes.error;
  if (tasksRes.error) throw tasksRes.error;
  if (pendingRes.error) throw pendingRes.error;
  if (promotionsRes.error) throw promotionsRes.error;
  if (ledgerRes.error) throw ledgerRes.error;
  if (adSessionsRes.error) throw adSessionsRes.error;
  if (storeRes.error) throw storeRes.error;
  if (listingRes.error) throw listingRes.error;
  if (configRes.error) throw configRes.error;
  if (referralsRes.error) throw referralsRes.error;
  if (referralLeaderboardRes.error) throw referralLeaderboardRes.error;

  const tasksById = byId(tasksRes.data);
  const config: Record<string, unknown> = {};
  for (const row of configRes.data ?? []) {
    config[String(row.key)] = row.value ?? {};
  }
  const profileIds = unique([
    ...(accountsRes.data ?? []).map((row: any) => row.user_id),
    ...(pendingRes.data ?? []).flatMap((row: any) => [row.user_id, row.reviewed_by]),
    ...(ledgerRes.data ?? []).map((row: any) => row.user_id),
    ...(adSessionsRes.data ?? []).map((row: any) => row.user_id),
    ...(storeRes.data ?? []).map((row: any) => row.user_id),
    ...(listingRes.data ?? []).map((row: any) => row.seller_id),
    ...(referralsRes.data ?? []).flatMap((row: any) => [row.referrer_id, row.referred_user_id]),
    ...(referralLeaderboardRes.data ?? []).map((row: any) => row.user_id),
  ]);
  const profiles = await loadProfiles(admin, profileIds);
  const sellers = await loadSellerProfiles(admin, profileIds);

  return {
    accounts: (accountsRes.data ?? []).map((account: any) => ({
      ...account,
      user: userBundle(account.user_id, profiles, sellers),
    })),
    tasks: tasksRes.data ?? [],
    pending_reviews: (pendingRes.data ?? []).map((completion: any) => ({
      ...completion,
      task: tasksById[String(completion.task_id)] ?? null,
      user: userBundle(completion.user_id, profiles, sellers),
      reviewed_by_user: userBundle(completion.reviewed_by, profiles, sellers),
    })),
    stores: (storeRes.data ?? []).map((seller: any) => ({
      ...seller,
      profile: profiles[String(seller.user_id)] ?? null,
    })),
    listings: (listingRes.data ?? []).map((listing: any) => ({
      ...listing,
      seller: userBundle(listing.seller_id, profiles, sellers),
    })),
    promotions: promotionsRes.data ?? [],
    ledger: (ledgerRes.data ?? []).map((entry: any) => ({
      ...entry,
      task: tasksById[String(entry.task_id)] ?? null,
      user: userBundle(entry.user_id, profiles, sellers),
    })),
    ad_sessions: (adSessionsRes.data ?? []).map((session: any) => ({
      ...session,
      task: tasksById[String(session.task_id)] ?? null,
      user: userBundle(session.user_id, profiles, sellers),
    })),
    config,
    referrals: (referralsRes.data ?? []).map((referral: any) => ({
      ...referral,
      referrer: userBundle(referral.referrer_id, profiles, sellers),
      referred_user: userBundle(referral.referred_user_id, profiles, sellers),
    })),
    referral_leaderboard: referralLeaderboardRes.data ?? [],
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, { requireSession: true });
    if (ctx instanceof Response) return ctx;

    const admin = supabaseAdminClient();
    const modules: Record<string, unknown> = {};

    if (canAny(ctx, ["disputes.read", "disputes.resolve", "complaints.read", "complaints.respond"])) {
      modules.support = await loadSupport(admin, ctx);
    }

    if (canAny(ctx, ["users.moderate", "users.delete", "listings.moderate", "listings.delete"])) {
      modules.moderation = await loadModeration(admin);
    }

    if (canAny(ctx, ["verification.read", "verification.review"])) {
      modules.verification = await loadVerification(admin);
    }

    if (canAny(ctx, ["escrow.read", "escrow.settle", "chain.read", "chain.admin"])) {
      modules.escrow = await loadEscrow(admin);
    }

    if (canAny(ctx, ["admin.members.manage", "admin.roles.read"])) {
      modules.admins = await loadAdminMembers(admin);
    }

    if (canAny(ctx, ["rewards.read", "rewards.tasks.manage", "rewards.promotions.manage", "rewards.adjust", "rewards.review", "rewards.analytics"])) {
      modules.rewards = await loadRewards(admin);
    }

    return ok({
      ok: true,
      generated_at: new Date().toISOString(),
      admin: {
        user_id: ctx.userId,
        role_key: ctx.roleKey,
        role_name: ctx.roleName,
        permissions: ctx.permissions,
      },
      modules,
    });
  } catch (e) {
    return adminError(e);
  }
});
