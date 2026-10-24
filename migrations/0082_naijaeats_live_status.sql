-- Migration 0082: Promote NaijaEats to live
--
-- NaijaEats now has a functional customer ordering surface, seeded restaurant
-- data, cart/checkout/order flows, and operator order workflows. Its ecosystem
-- status must therefore match the product users can actually use.
--
-- This is an idempotent configuration update. It does not alter restaurant,
-- payment, wallet, settlement, or order data.

UPDATE ecosystem_verticals
SET status = 'live',
    cta_label = 'Explore NaijaEats',
    seo_title = 'NaijaEats — Restaurant Food Delivery in Nigeria',
    seo_description = 'Order from restaurants and local food vendors across Nigeria for pickup or delivery with NaijaEats.'
WHERE slug = 'eats';

-- The header navigation is cache-first. Remove the stale payload so the live
-- status is visible immediately after this migration instead of waiting for
-- the 120-second cache TTL.
DELETE FROM homepage_feed_cache
WHERE section_key = 'ecosystem_nav_header';
