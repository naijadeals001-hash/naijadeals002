-- NaijaDeals — Rewire Brand Assets (Top Brands fix, take 2)
--
-- ROOT CAUSE (proven via d1_migrations.applied_at timestamps, not guessed):
--   Migration 0006_brand_merchandising.sql ran at 2026-09-15 16:32:57 and tried
--   to UPDATE brands.logo_url for 24 slugs — but the `brands` table was EMPTY at
--   that moment (brands are only INSERTed 6+ hours later, at 22:49:11, by
--   seed-phase1a-taxonomy-catalog.sql). Every UPDATE in 0006 matched zero rows
--   and was silently a no-op. The seed migration then inserted all 38 brand rows
--   fresh with their original `/ph.svg?label=...` placeholder logo_urls, with no
--   knowledge that 0006 ever intended to override them.
--
--   This migration re-applies the mapping AFTER the data exists, so the UPDATEs
--   actually match rows this time.
--
-- SECOND, INDEPENDENT DEFECT FOUND DURING THIS FIX (also from 0006, undetected
-- until now because the first bug made it moot): several of 0006's slug targets
-- do not exist verbatim in the seed's brand taxonomy, and several DO exist but
-- have zero active products (getTopBrands() INNER JOINs products, so a brand
-- with a perfect logo and 0 products still never appears). A full reconciliation
-- of the 24 real, git-tracked PNGs in public/static/brands/ against the live
-- `brands` table (via the live D1 binding, not just CLI) was performed:
--
--   VIABLE (real asset + exact/corrected slug match + product_count > 0) — 12:
--     apple, samsung, sony, lg, hp, nestle, golden-penny, hisense, tecno,
--     infinix, nike, and zaron.png -> brand slug 'zaron-cosmetics' (the asset
--     filename doesn't exactly match the seed's slug; the brand IS the same
--     entity, so this is a legitimate corrected mapping, not a fabrication).
--
--   ORPHANED (real asset exists, but NO brand row with this slug exists in the
--   current 38-row taxonomy) — 8: anker, ariel, binatone, jbl, maybelline,
--   midea, orijin, scanfrost. These assets stay unused until/unless a brand row
--   for that name is added to the catalog with real product(s) attached — we do
--   NOT invent a brand row here just to consume an unused asset.
--
--   ZERO-PRODUCT (brand row + slug match exists, but 0 active products, so the
--   existing getTopBrands() query correctly excludes it regardless of logo) — 3:
--     dettol, indomie, peak.png -> 'peak-milk'. Logo is wired below anyway (it's
--     free, real, and correct) so these three activate automatically the moment
--     a product is ever assigned to that brand_id — no future migration needed.
--
-- Per Pat's directive: DO NOT regenerate/fabricate replacements for the 8
-- orphaned assets or invent product assignments to force the 3 zero-product
-- brands to qualify. "Show fewer, but all real" — 12 real brands on the
-- homepage today, more as the catalog grows, is correct behavior.

UPDATE brands SET logo_url = '/static/brands/apple.png'        WHERE slug = 'apple';
UPDATE brands SET logo_url = '/static/brands/samsung.png'      WHERE slug = 'samsung';
UPDATE brands SET logo_url = '/static/brands/sony.png'         WHERE slug = 'sony';
UPDATE brands SET logo_url = '/static/brands/lg.png'           WHERE slug = 'lg';
UPDATE brands SET logo_url = '/static/brands/hp.png'           WHERE slug = 'hp';
UPDATE brands SET logo_url = '/static/brands/nestle.png'       WHERE slug = 'nestle';
UPDATE brands SET logo_url = '/static/brands/golden-penny.png' WHERE slug = 'golden-penny';
UPDATE brands SET logo_url = '/static/brands/hisense.png'      WHERE slug = 'hisense';
UPDATE brands SET logo_url = '/static/brands/tecno.png'        WHERE slug = 'tecno';
UPDATE brands SET logo_url = '/static/brands/infinix.png'      WHERE slug = 'infinix';
UPDATE brands SET logo_url = '/static/brands/nike.png'         WHERE slug = 'nike';
UPDATE brands SET logo_url = '/static/brands/zaron.png'        WHERE slug = 'zaron-cosmetics';

-- Wired for free / future-proofing (currently 0 products, so invisible until
-- a product is assigned to these brand_ids — see comment above):
UPDATE brands SET logo_url = '/static/brands/dettol.png'       WHERE slug = 'dettol';
UPDATE brands SET logo_url = '/static/brands/indomie.png'      WHERE slug = 'indomie';
UPDATE brands SET logo_url = '/static/brands/peak.png'         WHERE slug = 'peak-milk';

-- ---------------------------------------------------------------------------
-- Curated priority ordering for the 12 currently-viable brands. Re-applied
-- here (not just in 0006) because 0006's is_featured/display_order UPDATEs
-- suffered the exact same "table was empty" no-op as the logo_url UPDATEs.
-- ---------------------------------------------------------------------------

UPDATE brands SET is_featured = 1, display_order = 1  WHERE slug = 'apple';
UPDATE brands SET is_featured = 1, display_order = 2  WHERE slug = 'samsung';
UPDATE brands SET is_featured = 1, display_order = 3  WHERE slug = 'nike';
UPDATE brands SET is_featured = 1, display_order = 4  WHERE slug = 'sony';
UPDATE brands SET is_featured = 1, display_order = 5  WHERE slug = 'lg';
UPDATE brands SET is_featured = 1, display_order = 6  WHERE slug = 'nestle';
UPDATE brands SET is_featured = 1, display_order = 7  WHERE slug = 'golden-penny';
UPDATE brands SET is_featured = 1, display_order = 8  WHERE slug = 'hp';
UPDATE brands SET is_featured = 1, display_order = 9  WHERE slug = 'hisense';
UPDATE brands SET is_featured = 1, display_order = 10 WHERE slug = 'tecno';
UPDATE brands SET is_featured = 1, display_order = 11 WHERE slug = 'infinix';
UPDATE brands SET is_featured = 1, display_order = 12 WHERE slug = 'zaron-cosmetics';
