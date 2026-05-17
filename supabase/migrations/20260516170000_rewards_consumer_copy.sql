BEGIN;

UPDATE public.market_admin_roles
SET
  description = 'Manages noms, reward tasks, sponsored placements, reviews, and balance adjustments.',
  updated_at = now()
WHERE key = 'reward_admin';

UPDATE public.market_reward_tasks
SET
  title = data.title,
  description = data.description,
  action_route = data.action_route,
  ui = data.ui::jsonb,
  updated_at = now()
FROM (
  VALUES
    (
      'watch_rewarded_video',
      'Watch a sponsored video',
      'Watch a short sponsored video and earn noms when it finishes.',
      NULL,
      '{"tone":"gold","badge":"Daily","primaryLabel":"Watch"}'
    ),
    (
      'create_store_profile',
      'Open your store',
      'Create your public store profile so buyers can recognize and trust you.',
      '/market/profile/create',
      '{"badge":"Starter","primaryLabel":"Create profile"}'
    ),
    (
      'complete_store_profile',
      'Make your store stand out',
      'Add your logo, bio, location, contact, and delivery details.',
      '/market/profile/edit',
      '{"badge":"Trust","primaryLabel":"Finish profile"}'
    ),
    (
      'publish_first_listing',
      'List your first item',
      'Add a product or service buyers can discover in the marketplace.',
      '/market/(tabs)/sell',
      '{"badge":"Seller","primaryLabel":"Create listing"}'
    ),
    (
      'first_purchase_completed',
      'Make your first purchase',
      'Complete one marketplace order as a buyer.',
      '/market/(tabs)',
      '{"badge":"Buyer","primaryLabel":"Shop"}'
    ),
    (
      'first_sale_completed',
      'Make your first sale',
      'Complete one marketplace order as a seller.',
      '/market/(tabs)/orders',
      '{"badge":"Seller","primaryLabel":"View orders"}'
    ),
    (
      'follow_first_store',
      'Follow a store',
      'Follow a seller you want to keep up with.',
      '/market/social',
      '{"badge":"Social","primaryLabel":"Find stores"}'
    ),
    (
      'create_social_post',
      'Share a market update',
      'Post a launch, find, or update in the market feed.',
      '/market/social',
      '{"badge":"Social","primaryLabel":"Post"}'
    ),
    (
      'create_stock_identity',
      'Launch your store stock',
      'Create your store stock profile for the stock market.',
      '/market/stock/create',
      '{"badge":"Growth","primaryLabel":"Create stock"}'
    ),
    (
      'buy_store_stock',
      'Buy store stock',
      'Support a store by buying its digital stock.',
      '/market/stock',
      '{"badge":"Trade","primaryLabel":"Buy stock"}'
    ),
    (
      'sell_store_stock',
      'Sell store stock',
      'Complete a sell trade from your stock portfolio.',
      '/market/stock/portfolio',
      '{"badge":"Trade","primaryLabel":"Portfolio"}'
    ),
    (
      'custom_campaign_review',
      'Bonus challenge',
      'Complete a featured marketplace challenge and submit proof.',
      NULL,
      '{"badge":"Bonus","primaryLabel":"Submit proof"}'
    )
) AS data(task_key, title, description, action_route, ui)
WHERE market_reward_tasks.task_key = data.task_key;

INSERT INTO public.market_reward_config (key, value, public_read)
VALUES
  (
    'noms_economy',
    '{
      "name":"noms",
      "transferable":false,
      "cash_out":false,
      "onchain":false,
      "daily_ad_cap":5,
      "history_limit":50,
      "tiers":[
        {"key":"starter","label":"Starter","min":0},
        {"key":"rising","label":"Rising Seller","min":1000},
        {"key":"trusted","label":"Trusted Market Pro","min":5000},
        {"key":"elite","label":"Elite Operator","min":15000}
      ],
      "redemption_catalog":[
        {"key":"listing_boost","title":"Listing Boost","subtitle":"Give one listing a stronger spotlight in buyer discovery.","cost_noms":750,"icon":"rocket-outline","accent":"#2DD4BF"},
        {"key":"sponsored_top_display","title":"Sponsored Top Display","subtitle":"Put your store in a premium rewards placement for shoppers to notice.","cost_noms":2500,"icon":"megaphone-outline","accent":"#F4B75D"},
        {"key":"profile_glow","title":"Profile Glow","subtitle":"Add a premium look to your store profile when this reward opens.","cost_noms":1200,"icon":"diamond-outline","accent":"#A78BFA"}
      ]
    }'::jsonb,
    true
  ),
  (
    'rewards_ui',
    '{
      "hero_title":"Noms Rewards",
      "hero_subtitle":"Earn noms for videos, store activity, shopping, social actions, and stock milestones.",
      "empty_promotion_title":"Featured stores",
      "empty_promotion_subtitle":"Sponsored stores and special offers can appear here."
    }'::jsonb,
    true
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, public_read = EXCLUDED.public_read, updated_at = now();

COMMIT;
