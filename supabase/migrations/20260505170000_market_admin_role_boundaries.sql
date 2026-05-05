-- Tighten marketplace admin role boundaries.
-- Super admin keeps all powers. Other roles only keep the module permissions
-- needed for their own workspace.

UPDATE public.market_admin_roles
SET
  description = 'Full control across support, marketplace operations, verification, escrow, chain controls, and admin management.',
  permissions = '[
    "admin.members.manage",
    "admin.roles.read",
    "users.read",
    "users.moderate",
    "users.delete",
    "listings.read",
    "listings.moderate",
    "listings.delete",
    "orders.read",
    "orders.manage",
    "disputes.read",
    "disputes.resolve",
    "evidence.read",
    "complaints.read",
    "complaints.respond",
    "verification.read",
    "verification.review",
    "escrow.read",
    "escrow.settle",
    "chain.read",
    "chain.admin",
    "audit.read",
    "analytics.read"
  ]'::jsonb,
  rank = 0,
  updated_at = now()
WHERE key = 'super_admin';

UPDATE public.market_admin_roles
SET
  description = 'Handles marketplace operations, user/listing moderation, disputes, and escrow settlement.',
  permissions = '[
    "users.read",
    "users.moderate",
    "listings.read",
    "listings.moderate",
    "orders.read",
    "orders.manage",
    "disputes.read",
    "disputes.resolve",
    "evidence.read",
    "complaints.read",
    "complaints.respond",
    "escrow.read",
    "escrow.settle",
    "audit.read",
    "analytics.read"
  ]'::jsonb,
  rank = 10,
  updated_at = now()
WHERE key = 'operations_admin';

UPDATE public.market_admin_roles
SET
  description = 'Handles only support queues: complaints, disputes, order context, and evidence review.',
  permissions = '[
    "users.read",
    "listings.read",
    "orders.read",
    "disputes.read",
    "disputes.resolve",
    "evidence.read",
    "complaints.read",
    "complaints.respond"
  ]'::jsonb,
  rank = 20,
  updated_at = now()
WHERE key = 'support_admin';

UPDATE public.market_admin_roles
SET
  description = 'Handles only verification and compliance review without marketplace moderation or settlement controls.',
  permissions = '[
    "users.read",
    "verification.read",
    "verification.review",
    "audit.read",
    "analytics.read"
  ]'::jsonb,
  rank = 30,
  updated_at = now()
WHERE key = 'compliance_admin';
