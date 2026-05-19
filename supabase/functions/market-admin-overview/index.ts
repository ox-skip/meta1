import { adminError, getAdminContext } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, { requireSession: true });
    if (ctx instanceof Response) return ctx;

    const admin = supabaseAdminClient();
    const canSeeSupportTickets = ctx.roleKey === "super_admin" || ctx.roleKey === "support_admin";

    const [
      disputesRes,
      supportTicketsRes,
      verificationRes,
      ordersInEscrowRes,
      ordersDisputedRes,
      deliverablesRes,
      listingsRes,
      pausedListingsRes,
      sellersRes,
      usersRes,
      adminsRes,
      rewardAccountsRes,
      rewardTasksRes,
      pendingRewardReviewsRes,
      activeRewardPromotionsRes,
      stockIdentitiesRes,
      pausedStockIdentitiesRes,
      pendingStockOrdersRes,
    ] = await Promise.all([
      admin.from("market_disputes").select("id", { count: "exact", head: true }).in("status", ["OPEN", "UNDER_REVIEW"]),
      canSeeSupportTickets
        ? admin.from("market_support_tickets").select("id", { count: "exact", head: true }).in("status", ["OPEN", "IN_PROGRESS"])
        : Promise.resolve({ count: 0, error: null }),
      admin.from("market_verification_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
      admin.from("market_orders").select("id", { count: "exact", head: true }).eq("status", "IN_ESCROW"),
      admin.from("market_orders").select("id", { count: "exact", head: true }).eq("status", "DISPUTED"),
      admin.from("market_deliverables").select("id", { count: "exact", head: true }),
      admin.from("market_listings").select("id", { count: "exact", head: true }).eq("is_active", true),
      admin.from("market_listings").select("id", { count: "exact", head: true }).eq("is_active", false),
      admin.from("market_seller_profiles").select("user_id", { count: "exact", head: true }),
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("market_admin_users").select("user_id", { count: "exact", head: true }).eq("is_active", true),
      admin.from("market_reward_accounts").select("user_id", { count: "exact", head: true }),
      admin.from("market_reward_tasks").select("id", { count: "exact", head: true }),
      admin.from("market_reward_task_completions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("market_reward_promotions").select("id", { count: "exact", head: true }).eq("active", true),
      admin.from("market_stock_identities").select("id", { count: "exact", head: true }),
      admin.from("market_stock_identities").select("id", { count: "exact", head: true }).gt("trading_paused_until", new Date().toISOString()),
      admin.from("market_stock_orders").select("id", { count: "exact", head: true }).in("status", ["pending", "submitted"]),
    ]);

    const failures = [
      disputesRes.error,
      supportTicketsRes.error,
      verificationRes.error,
      ordersInEscrowRes.error,
      ordersDisputedRes.error,
      deliverablesRes.error,
      listingsRes.error,
      pausedListingsRes.error,
      sellersRes.error,
      usersRes.error,
      adminsRes.error,
      rewardAccountsRes.error,
      rewardTasksRes.error,
      pendingRewardReviewsRes.error,
      activeRewardPromotionsRes.error,
      stockIdentitiesRes.error,
      pausedStockIdentitiesRes.error,
      pendingStockOrdersRes.error,
    ].filter(Boolean);
    if (failures.length) return bad(String(failures[0]?.message ?? "Could not load admin overview"));

    return ok({
      ok: true,
      admin: {
        user_id: ctx.userId,
        role_key: ctx.roleKey,
        role_name: ctx.roleName,
        permissions: ctx.permissions,
      },
      metrics: {
        open_disputes: Number(disputesRes.count ?? 0),
        open_support_tickets: Number(supportTicketsRes.count ?? 0),
        pending_verifications: Number(verificationRes.count ?? 0),
        orders_in_escrow: Number(ordersInEscrowRes.count ?? 0),
        disputed_orders: Number(ordersDisputedRes.count ?? 0),
        deliverables_uploaded: Number(deliverablesRes.count ?? 0),
        active_listings: Number(listingsRes.count ?? 0),
        paused_listings: Number(pausedListingsRes.count ?? 0),
        seller_profiles: Number(sellersRes.count ?? 0),
        total_users: Number(usersRes.count ?? 0),
        active_admins: Number(adminsRes.count ?? 0),
        reward_accounts: Number(rewardAccountsRes.count ?? 0),
        reward_tasks: Number(rewardTasksRes.count ?? 0),
        pending_reward_reviews: Number(pendingRewardReviewsRes.count ?? 0),
        active_reward_promotions: Number(activeRewardPromotionsRes.count ?? 0),
        stock_identities: Number(stockIdentitiesRes.count ?? 0),
        paused_stock_identities: Number(pausedStockIdentitiesRes.count ?? 0),
        pending_stock_orders: Number(pendingStockOrdersRes.count ?? 0),
      },
      modules: [
        {
          key: "support",
          title: "Support and disputes",
          description: "Review support tickets, respond to user reports, compare order context, and resolve active disputes.",
          permission: "complaints.read",
        },
        {
          key: "moderation",
          title: "Users and listings",
          description: "Ban accounts, pause stores, remove listings, and inspect seller history before taking action.",
          permission: "users.moderate",
        },
        {
          key: "verification",
          title: "Verification and trust",
          description: "Review KYC decisions, risk flags, and policy blocks around seller onboarding.",
          permission: "verification.review",
        },
        {
          key: "escrow",
          title: "Escrow and chain operations",
          description: "Track crypto settlement state, reconcile escrow events, and control chain-level operations.",
          permission: "escrow.settle",
        },
        {
          key: "stocks",
          title: "Stock market admin",
          description: "Manage stock identities, trading gates, permissions, orders, reinvestments, and identity contracts.",
          permission: "stock.read",
        },
        {
          key: "rewards",
          title: "Rewards and promotions",
          description: "Manage Noms tasks, rewarded ads, custom campaigns, sponsored placements, reviews, and balance adjustments.",
          permission: "rewards.read",
        },
        {
          key: "admins",
          title: "Admin members and roles",
          description: "Add admins, change roles, reset admin passwords, and remove admin access.",
          permission: "admin.members.manage",
        },
      ],
    });
  } catch (e) {
    return adminError(e);
  }
});
