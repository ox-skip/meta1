# Market Admin Architecture

## What Exists Today

Your app already has the core marketplace rails:

- `market_orders`, `market_listings`, `market_seller_profiles`, `market_disputes`, `market_deliverables`, `market_verification_requests`, `market_audit_logs`
- crypto escrow state in `market_crypto_escrows`, `market_crypto_intents`, and `market_chain_events`
- admin-capable edge functions for dispute resolution, stable settlement ops, chain sync, audit lookup, and PI/stable refund or release flows
- contract-level admin controls in `bestcity-crypto` for `pause`, `unpause`, `updateFeeBps`, `updateFeeRecipient`, `updateArbiter`, and wallet allow-list control

That means the admin dashboard should not be a random panel. It should be the internal control room for the exact tables and flows already powering your escrow marketplace.

## Admin Identity Model

Use three backend tables:

- `market_admin_roles`
  - defines roles and permission bundles
- `market_admin_users`
  - maps a Supabase user to an admin role
  - stores the admin password hash
  - can disable admin access instantly with `is_active = false`
- `market_admin_sessions`
  - short-lived unlocked admin sessions after the second password is verified

How login works:

1. User signs into the app normally with Supabase Auth.
2. `account.tsx` checks `market_admin_users` for the current `auth.uid()`.
3. Only active admin users see the admin entry point.
4. Opening `/market/admin` requires a second admin password.
5. That password is verified against the hash in `market_admin_users`.
6. A short-lived row is created in `market_admin_sessions`.
7. Sensitive admin edge functions require both the user JWT and the admin session token.

This gives you:

- no hardcoded admin password in the app
- no visible admin route for normal users
- admin removal directly from database
- password rotation directly from database
- auditability of who took the action

## Role Model

Recommended baseline roles:

- `super_admin`
  - full access, including admin management and chain-level controls
- `operations_admin`
  - listings, orders, disputes, evidence, settlement operations
- `support_admin`
  - user moderation, complaints, disputes, evidence review
- `compliance_admin`
  - verification, trust, policy review, audit visibility

Permissions should stay granular:

- `users.read`
- `users.moderate`
- `users.delete`
- `listings.read`
- `listings.moderate`
- `listings.delete`
- `orders.read`
- `orders.manage`
- `disputes.read`
- `disputes.resolve`
- `evidence.read`
- `complaints.read`
- `complaints.respond`
- `verification.read`
- `verification.review`
- `escrow.read`
- `escrow.settle`
- `chain.read`
- `chain.admin`
- `audit.read`
- `analytics.read`
- `admin.members.manage`

## Admin Dashboard Modules

### 1. Overview

Purpose:

- open disputes
- pending verification reviews
- orders in escrow
- disputed orders
- active vs paused listings
- active admins
- total users and sellers

### 2. Users

Purpose:

- search any account
- see seller profile, order volume, dispute history, uploaded evidence count, wallet activity summary
- ban account
- soft-disable store
- mark high risk
- delete account data only through controlled workflows

Important rule:

- never hard delete blindly; use soft bans and content takedowns first

### 3. Listings

Purpose:

- view all listings across categories
- pause or unpause listing
- remove scam or prohibited items
- inspect listing images, seller identity, order history, report count

### 4. Orders And Escrow

Purpose:

- inspect every order across buyer, seller, listing, chain, and payment rail
- see timeline: created, in escrow, deliverable uploaded, delivered, released, refunded
- see linked records from `market_escrow_ledger`, `market_crypto_escrows`, `market_crypto_intents`, `market_chain_events`
- manually trigger or supervise settlement actions only for authorized roles

### 5. Disputes And Complaints

Purpose:

- queue all open disputes
- show buyer statement, seller statement, timestamps, deliverables, media evidence, chain/payment state, audit trail
- assign dispute to admin
- move status from `OPEN` to `UNDER_REVIEW` to `RESOLVED`
- issue final result: refund buyer or release seller

Current note:

- your app already has `market_disputes`, but separate complaint threads are not modeled yet
- if you want richer support handling, add `market_complaints` and `market_complaint_messages`

### 6. Evidence Review

Purpose:

- show uploaded videos, images, previews, and files used as proof
- separate preview vs final deliverables
- allow secure signed URL generation for admins
- show file metadata, uploader, upload time, related order, and dispute

### 7. Verification And Compliance

Purpose:

- review `market_verification_requests`
- approve or reject seller verification
- inspect provider notes, admin notes, risk score, and seller activity before decision

### 8. Chain And Contract Operations

Purpose:

- view active chain config
- pause or unpause escrow contract
- rotate fee recipient
- update arbiter
- manage settlement-wallet allow list
- run reindex or sync operations

This must stay restricted to `super_admin` or tightly trusted operations admins.

### 9. Audit And Forensics

Purpose:

- show all admin actions from `market_audit_logs`
- filter by order, listing, user, admin, action type, and date
- compare dispute ruling with escrow action and contract events

## Data Model Additions Still Recommended

Your current schema is strong, but for a full admin system I would add next:

- `market_complaints`
  - general support ticket not always tied to final dispute yet
- `market_complaint_messages`
  - threaded support communication
- `market_dispute_evidence`
  - normalized dispute-specific evidence records if you want evidence outside deliverables
- `market_admin_assignments`
  - assign dispute/complaint/review queue to a specific admin
- `market_admin_action_notes`
  - private internal notes separate from public order notes
- `market_user_flags`
  - fraud/scam/risk labels and reasons

## Database-Only Password Management

Do not store plaintext passwords.

Set or rotate an admin password in SQL using bcrypt:

```sql
update public.market_admin_users
set
  password_hash = extensions.crypt('new-strong-admin-password', extensions.gen_salt('bf', 12)),
  last_password_change_at = now(),
  updated_at = now()
where user_id = 'ADMIN_USER_UUID';
```

To grant admin access:

```sql
insert into public.market_admin_users (user_id, role_key, password_hash, display_name)
values (
  'ADMIN_USER_UUID',
  'operations_admin',
  extensions.crypt('temporary-strong-password', extensions.gen_salt('bf', 12)),
  'Ops Admin'
)
on conflict (user_id) do update
set
  role_key = excluded.role_key,
  password_hash = excluded.password_hash,
  display_name = excluded.display_name,
  is_active = true,
  updated_at = now(),
  last_password_change_at = now();
```

## Security Rules

- Admin tab must never be shown unless `market_admin_users.is_active = true` for that exact user.
- Every sensitive admin edge function must require the normal user JWT plus an unlocked admin session.
- Every dispute decision must write to `market_audit_logs`.
- Chain and settlement controls must be permission-gated separately from moderation tools.
- Deleting user data should be a privileged workflow, not a one-click default action.
- Use short admin session expiry and force re-entry of the admin password after expiry.

## Recommended Build Order

1. Admin identity and session model
2. Overview dashboard
3. Disputes and evidence queue
4. User and listing moderation
5. Verification review
6. Escrow and chain operations
7. Audit explorer
8. Complaint ticketing and internal notes

Deployment commands and SQL assignment templates are in `docs/market-admin-deploy.md` and `supabase/sql/market_admin_assignments.sql`.
