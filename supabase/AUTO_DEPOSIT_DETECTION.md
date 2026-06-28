# Automated Deposit Detection System

## Overview
This system automatically detects deposit transactions on the source chain without requiring manual resync. When a buyer submits a deposit (USDC/USDT), the system:
1. Monitors for `EscrowDeposited` events on-chain
2. Automatically updates the order status from `CREATED` to `IN_ESCROW`
3. Updates the deposit intent to `CONFIRMED` status

## Changes Made

### 1. Enhanced Poller (`market-escrow-poller/index.ts`)
- Added `deposit_scan` mode: `GET /market-escrow-poller?mode=deposit_scan`
- Scans for pending deposits on all active chains using `EscrowDeposited` event topics
- Auto-applies deposits when detected on-chain by order_key matching

### 2. Service Function (`services/market/usdcCheckout.ts`)
- Added `autoSyncPendingDeposit(orderId)` - client-callable function for automatic sync
- Uses existing `market-escrow-reindex` function to detect deposits

### 3. Database Migration (`migrations/20260628000000_market_auto_deposit_sync.sql`)
- Adds `market_poll_deposit_sync_rpc` for audit logging (table `market_chain_sync` may already exist)

## Setup Instructions

### Option A: Supabase Scheduled Job (Recommended)
Create a scheduled job in Supabase Dashboard → Database → Scheduled Jobs:

```sql
-- Run every 2 minutes to detect pending deposits
SELECT cron.schedule(
  'deposit-auto-sync',
  '*/2 * * * *',
  $$SELECT http_get('https://YOUR-PROJECT.supabase.co/functions/v1/market-escrow-poller?mode=deposit_scan')$$,
  'true'
);
```

### Option B: Manual Trigger via API
```bash
curl -X GET "https://YOUR-PROJECT.supabase.co/functions/v1/market-escrow-poller?mode=deposit_scan"
```

### Option C: Client-side Auto-Sync
```typescript
import { autoSyncPendingDeposit } from "@/services/market/usdcCheckout";

// Call when order is in CREATED status and deposit was submitted
const result = await autoSyncPendingDeposit(orderId);
if (result.ok && !result.already_settled) {
  // Deposit detected, order now in escrow
}
```

## How It Works

1. **Order in CREATED status** - Buyer has submitted deposit transaction
2. **Poller finds pending deposits** - Queries orders with `status='CREATED'` and no `deposited_tx_hash`
3. **Chain log scanning** - Queries RPC for `EscrowDeposited` events matching order_keys
4. **Auto-apply** - Calls `applyChainDeposit` which updates:
   - `market_crypto_intents.status = CONFIRMED`
   - `market_crypto_escrows.deposited_tx_hash`
   - `market_orders.status = IN_ESCROW`
5. **Realtime updates** - Supabase Realtime pushes changes to subscribed clients

## Key Benefits

- **No manual resync button needed** - automatic background detection every 2 minutes
- **Handles AA wallets** - scans by `order_key` without requiring tx_hash upfront
- **Idempotent** - safe to run repeatedly, won't double-process
- **Fast detection** - typically <2 minutes from on-chain confirmation to escrow status