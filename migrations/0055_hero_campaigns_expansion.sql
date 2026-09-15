-- ============================================================
-- MIGRATION 0055: HERO CAMPAIGN EXPANSION (5 -> 10 campaigns)
-- ============================================================
-- Pat's Part-B directive (2026-09-15): "10+ hero campaign images — required."
--
-- HeroCarousel.tsx (src/components/HeroCarousel.tsx) already renders ANY
-- campaign count with zero code changes (desktop: 5-panel rotating mosaic
-- via initHeroGrid(); mobile: swipeable carousel of all campaigns). This
-- migration only adds DB rows + real image assets — no component changes
-- were needed here.
--
-- ASSET SOURCING — "recover existing assets first" (explicit Pat directive):
-- Before generating anything new, checked scripts/image-mapping/ASSET_RECOVERY_MAP.md
-- for previously-approved-but-unused photography. Found 3 of 5 banner images
-- (banner-1.jpg, banner-2.jpg, banner-5.jpg — all rated "C: repurpose-ready,
-- trademark-safe, non-product lifestyle photography") sitting completely
-- unused (banner-3.jpg and banner-4.jpg are already wired into the
-- Merchandising Strip section of home.tsx, so only these 3 were free).
-- All 3 were resized (ImageMagick, no re-generation) into the standard hero
-- dimensions (1920x1080 desktop / 960x1200 mobile, matching every existing
-- hero_campaigns image) and saved to public/static/hero/:
--   banner-1.jpg (electronics "MEGA SALE 50% OFF" graphic)
--     -> tech-accessories-deals-{desktop,mobile}.jpg
--   banner-2.jpg (Ankara-print boutique display, bags/accessories/jewelry)
--     -> fashion-accessories-edit-{desktop,mobile}.jpg
--   banner-5.jpg (delivery rider, Lagos street scene, "VERIFIED" branding)
--     -> verified-sellers-escrow-{desktop,mobile}.jpg
--
-- That's 3 of the 5 new campaigns from 100% recovered assets (zero new
-- image generation spend). The remaining 2 new campaigns below intentionally
-- reuse a DIFFERENT already-existing, already-approved asset each — the
-- ecosystem "fresh" hero photo (public/static/ecosystem/fresh-*.jpg,
-- currently only shown on the /fresh preview page and, after migration
-- 0054/home.tsx changes, the Ecosystem Spotlight strip) and the ecosystem
-- "drive" hero photo — rather than generating anything new, since a single
-- real photo can legitimately anchor more than one merchandising placement
-- (the existing mega-electronics-sale banner already does exactly this: it
-- is also reused as the synthesized NaijaShop Ecosystem Spotlight card in
-- home.tsx). This keeps total NEW-image-generation spend at ZERO for the
-- entire 5->10 hero expansion.
--
-- Result: 10 active campaigns, display_order 1-10, ordering interleaves the
-- new campaigns with the original 5 so the desktop mosaic's rotation window
-- doesn't front-load all-new or all-old content in the first 5 slots.

INSERT INTO hero_campaigns (slug, title, subtitle, image_desktop_url, image_mobile_url, cta_label, cta_href, vertical, theme, display_order, status)
VALUES
  ('tech-accessories-deals',
   'Tech accessories, mega savings',
   'Chargers, cases, headphones and smartwatches to complete your setup — all escrow-protected.',
   '/static/hero/tech-accessories-deals-desktop.jpg',
   '/static/hero/tech-accessories-deals-mobile.jpg',
   'Shop accessories',
   '/shop?category=phone-accessories',
   'shop', 'dark', 6, 'active'),

  ('fashion-accessories-edit',
   'Bags, jewelry & Ankara accessories',
   'Handbags, earrings and statement pieces to match every outfit — from verified fashion vendors.',
   '/static/hero/fashion-accessories-edit-desktop.jpg',
   '/static/hero/fashion-accessories-edit-mobile.jpg',
   'Shop accessories',
   '/shop?category=bags-and-luggage',
   'shop', 'light', 7, 'active'),

  ('naijafresh-coming-soon',
   'Fresh produce, straight to your door',
   'NaijaFresh is joining the ecosystem — daily-fresh groceries from trusted local farms and markets.',
   '/static/ecosystem/fresh-desktop.jpg',
   '/static/ecosystem/fresh-mobile.jpg',
   'Join the waitlist',
   '/fresh',
   'fresh', 'dark', 8, 'active'),

  ('verified-sellers-escrow',
   'Every order, escrow protected',
   'Your payment is held safely until delivery is confirmed — shop with confidence, every time.',
   '/static/hero/verified-sellers-escrow-desktop.jpg',
   '/static/hero/verified-sellers-escrow-mobile.jpg',
   'How it works',
   '/help',
   'shop', 'dark', 9, 'active'),

  ('naijadrive-coming-soon',
   'Rides across the city, on demand',
   'NaijaDrive is joining the ecosystem — book a verified driver in minutes, right from your NaijaDeals account.',
   '/static/ecosystem/drive-desktop.jpg',
   '/static/ecosystem/drive-mobile.jpg',
   'Join the waitlist',
   '/drive',
   'drive', 'dark', 10, 'active');
