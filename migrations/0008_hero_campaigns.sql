-- NaijaDeals — Hero Campaign Carousel foundation
--
-- Replaces the hardcoded <img src="/static/banners/banner-N.jpg"> tags in home.tsx
-- (5 static images, 2 of them reused later on the page, zero DB backing, no CTA
-- metadata, no way to schedule/rotate/retire a promo) with a real merchandising
-- table. home.tsx is NOT wired to this table yet in this migration/pass — see
-- src/lib/hero-campaigns.ts and src/components/HeroCarousel.tsx, which exist as
-- the ready-to-use foundation for the eventual homepage rebuild.
--
-- Follows the exact precedent established in 0006_brand_merchandising.sql:
--   status         TEXT     'active' = eligible to appear in the carousel.
--                            'inactive' = admin-deactivated without deleting the row
--                            (keeps campaign history/assets for reuse next season).
--   display_order  INTEGER  Lower number = earlier slide position. Ties broken by id.
-- Admin Panel (future): every column below becomes directly editable once an Admin
-- hero-campaign screen exists. home.tsx (and any other consumer) must always read
-- from this table via getActiveHeroCampaigns() — never hardcode a campaign in TSX.
--
-- Scheduling: starts_at/ends_at let merchandising queue up a campaign in advance
-- (e.g. create next month's promo today with a future starts_at) and have it expire
-- automatically without a manual deactivation step. NULL starts_at = live immediately.
-- NULL ends_at = no expiry. Both compared against SQLite datetime('now') (UTC).
--
-- theme: the one additional "visual metadata" field beyond the user's suggested list
-- that is genuinely useful here (not present on brands, because logos don't need it) —
-- the carousel overlays a title/subtitle/CTA directly on top of the image, and whether
-- that text should render light-on-dark or dark-on-light depends on the artwork's own
-- brightness in the zone the text sits in. Letting each campaign declare it (rather
-- than hardcoding one treatment in the component) is what keeps artwork changeable by
-- Admin Panel later without a code deploy.

CREATE TABLE IF NOT EXISTS hero_campaigns (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  subtitle           TEXT,
  image_desktop_url  TEXT NOT NULL,   -- repo-persistent path, e.g. /static/hero/mega-electronics-sale-desktop.jpg
  image_mobile_url   TEXT NOT NULL,   -- repo-persistent path, e.g. /static/hero/mega-electronics-sale-mobile.jpg
  cta_label          TEXT NOT NULL,
  cta_href           TEXT NOT NULL,
  vertical           TEXT NOT NULL,   -- 'shop' | 'ecosystem' | 'send' | future verticals (fresh/eats/gigs/stay/drive)
  theme              TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light')),
  display_order      INTEGER NOT NULL DEFAULT 100,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  starts_at          TEXT,            -- NULL = live immediately
  ends_at            TEXT,            -- NULL = never expires
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hero_campaigns_status_order ON hero_campaigns(status, display_order);

-- ---------------------------------------------------------------------------
-- Initial campaign set — 5 real, complete campaigns. Every image is a persistent,
-- git-tracked asset under public/static/hero/ (desktop 1920x1080 16:9, mobile
-- 960x1200 4:5 crop). No placeholder art, no stock-photo watermarks, no temporary
-- URLs. Deliberately NOT one-per-vertical: NaijaShop gets 3 slots (its own mega
-- sale, a fashion edit, groceries) because it is the only live vertical today and
-- deserves the deepest merchandising; NaijaDeals-the-ecosystem and NaijaSend each
-- get one slot to build awareness of what's coming, matching the explicit
-- instruction not to force every vertical in if it becomes repetitive.
-- ---------------------------------------------------------------------------

INSERT INTO hero_campaigns (slug, title, subtitle, image_desktop_url, image_mobile_url, cta_label, cta_href, vertical, theme, display_order, status) VALUES
  ('mega-electronics-sale',
   'Up to 50% off electronics',
   'Laptops, phones, headphones and smartwatches from verified sellers — escrow protected.',
   '/static/hero/mega-electronics-sale-desktop.jpg', '/static/hero/mega-electronics-sale-mobile.jpg',
   'Shop electronics', '/shop?category=electronics&deals=1', 'shop', 'dark', 1, 'active'),

  ('ankara-fashion-edit',
   'The Ankara Edit',
   'Bold prints, statement pieces and accessories from Nigerian fashion vendors.',
   '/static/hero/ankara-fashion-edit-desktop.jpg', '/static/hero/ankara-fashion-edit-mobile.jpg',
   'Shop fashion', '/shop?category=fashion', 'shop', 'light', 2, 'active'),

  ('naijadeals-ecosystem',
   'One account. One ecosystem.',
   'Shopping is live today. Food, gigs, stays, rides and courier — all coming to the same NaijaDeals account.',
   '/static/hero/naijadeals-ecosystem-desktop.jpg', '/static/hero/naijadeals-ecosystem-mobile.jpg',
   'Explore the ecosystem', '/ecosystem', 'ecosystem', 'dark', 3, 'active'),

  ('everyday-groceries',
   'Groceries, delivered fast',
   'Rice, staples, fresh produce and household essentials from sellers in your delivery city.',
   '/static/hero/everyday-groceries-desktop.jpg', '/static/hero/everyday-groceries-mobile.jpg',
   'Shop groceries', '/shop?category=groceries', 'shop', 'light', 4, 'active'),

  ('naijasend-nationwide',
   'Delivered nationwide, on time',
   'Every NaijaDeals order ships with tracked, escrow-protected delivery to all 36 states.',
   '/static/hero/naijasend-nationwide-desktop.jpg', '/static/hero/naijasend-nationwide-mobile.jpg',
   'See how it works', '/help', 'send', 'dark', 5, 'active');
