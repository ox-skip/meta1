-- Enable realtime publications for market order tracking
-- Run this in Supabase Dashboard SQL editor

-- Publish changes for order status and related entities
-- These enable real-time updates in the app without manual refresh

-- Enable publication for market_orders (order status changes)
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_orders;

-- Enable publication for market_crypto_intents (deposit/release status)
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_crypto_intents;

-- Enable publication for market_deliverables (file uploads)
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_deliverables;

-- Enable publication for market_order_otps (OTP generation/verification)
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_order_otps;

-- Enable publication for market_disputes (dispute status changes)
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_disputes;

-- Enable publication for market_dispute_messages (dispute messages in real-time)
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_dispute_messages;

-- Enable publication for dm_messages (direct messages between users)
ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_messages;

-- Enable publication for dm_message_reactions (reaction updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_message_reactions;

-- Note: If tables don't exist in the publication yet, you may need to create them:
-- CREATE PUBLICATION IF NOT EXISTS supabase_realtime FOR TABLE public.market_orders;
-- (Repeat for each table as needed)

-- Verify realtime is working by checking wal_level in Postgres config:
-- This should be 'logical' for realtime to work
-- SHOW wal_level;