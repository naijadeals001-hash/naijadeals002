-- NaijaDeals — Brand Merchandising Migration (Top Brands fix)
--
-- Problem being fixed:
--   1. brands.logo_url is NULL for all 30 rows -> homepage "Top Brands" section
--      was rendering text-initial circles instead of real brand imagery.
--   2. Top Brands ordering was driven purely by ad-hoc product_count with no way
--      for merchandising/curation to override it, and no path forward for an
--      Admin Panel to control the list later.
--
-- This migration is purely additive (ALTER TABLE ADD COLUMN) because the brands
-- table already has real seeded data — no destructive rebuild.
--
-- New columns:
--   is_featured    INTEGER  1 = curated/priority brand (shown first regardless of
--                            product_count), 0 = ranked by catalog activity only.
--   display_order  INTEGER  Lower number = higher priority among featured brands.
--                            NULL for non-featured brands (ranking falls back to
--                            product_count DESC).
--   status         TEXT     'active' = eligible to appear anywhere brand listings
--                            are rendered. 'inactive' reserved for future admin use
--                            (e.g. temporarily hiding a brand without deleting it).
--
-- Hybrid Top Brands ranking (implemented in src/lib/catalog.ts):
--   ORDER BY is_featured DESC, display_order ASC, product_count DESC
--
-- Admin Panel (future): is_featured / display_order / status become directly
-- editable columns once an Admin brand-merchandising screen exists. No UI code
-- should ever hardcode brand order — it must always come from this table.

ALTER TABLE brands ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE brands ADD COLUMN display_order INTEGER;
ALTER TABLE brands ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- ---------------------------------------------------------------------------
-- Populate logo_url for every brand that currently has at least one active
-- product (the 24 "viable" brands eligible to appear in Top Brands / anywhere
-- brand imagery is shown). Every asset below is a persistent, git-tracked file
-- under public/static/brands/ — no external/temporary image dependencies.
-- ---------------------------------------------------------------------------

UPDATE brands SET logo_url = '/static/brands/apple.png'        WHERE slug = 'apple';
UPDATE brands SET logo_url = '/static/brands/samsung.png'      WHERE slug = 'samsung';
UPDATE brands SET logo_url = '/static/brands/nike.png'         WHERE slug = 'nike';
UPDATE brands SET logo_url = '/static/brands/sony.png'         WHERE slug = 'sony';
UPDATE brands SET logo_url = '/static/brands/lg.png'           WHERE slug = 'lg';
UPDATE brands SET logo_url = '/static/brands/hp.png'           WHERE slug = 'hp';
UPDATE brands SET logo_url = '/static/brands/nestle.png'       WHERE slug = 'nestle';
UPDATE brands SET logo_url = '/static/brands/indomie.png'      WHERE slug = 'indomie';
UPDATE brands SET logo_url = '/static/brands/golden-penny.png' WHERE slug = 'golden-penny';
UPDATE brands SET logo_url = '/static/brands/peak.png'         WHERE slug = 'peak';
UPDATE brands SET logo_url = '/static/brands/dyson.png'        WHERE slug = 'dyson';
UPDATE brands SET logo_url = '/static/brands/jbl.png'          WHERE slug = 'jbl';
UPDATE brands SET logo_url = '/static/brands/midea.png'        WHERE slug = 'midea';
UPDATE brands SET logo_url = '/static/brands/hisense.png'      WHERE slug = 'hisense';
UPDATE brands SET logo_url = '/static/brands/scanfrost.png'    WHERE slug = 'scanfrost';
UPDATE brands SET logo_url = '/static/brands/tecno.png'        WHERE slug = 'tecno';
UPDATE brands SET logo_url = '/static/brands/infinix.png'      WHERE slug = 'infinix';
UPDATE brands SET logo_url = '/static/brands/anker.png'        WHERE slug = 'anker';
UPDATE brands SET logo_url = '/static/brands/binatone.png'     WHERE slug = 'binatone';
UPDATE brands SET logo_url = '/static/brands/ariel.png'        WHERE slug = 'ariel';
UPDATE brands SET logo_url = '/static/brands/dettol.png'       WHERE slug = 'dettol';
UPDATE brands SET logo_url = '/static/brands/maybelline.png'   WHERE slug = 'maybelline';
UPDATE brands SET logo_url = '/static/brands/zaron.png'        WHERE slug = 'zaron';
UPDATE brands SET logo_url = '/static/brands/orijin.png'       WHERE slug = 'orijin';

-- ---------------------------------------------------------------------------
-- Curated priority ordering (development dataset). Globally/locally recognized
-- flagship brands are featured first; the rest rank by catalog activity via
-- the product_count fallback in getTopBrands(). This is a sensible starting
-- point only — Admin Panel will make this fully editable later.
-- ---------------------------------------------------------------------------

UPDATE brands SET is_featured = 1, display_order = 1  WHERE slug = 'apple';
UPDATE brands SET is_featured = 1, display_order = 2  WHERE slug = 'samsung';
UPDATE brands SET is_featured = 1, display_order = 3  WHERE slug = 'nike';
UPDATE brands SET is_featured = 1, display_order = 4  WHERE slug = 'sony';
UPDATE brands SET is_featured = 1, display_order = 5  WHERE slug = 'lg';
UPDATE brands SET is_featured = 1, display_order = 6  WHERE slug = 'nestle';
UPDATE brands SET is_featured = 1, display_order = 7  WHERE slug = 'indomie';
UPDATE brands SET is_featured = 1, display_order = 8  WHERE slug = 'golden-penny';
UPDATE brands SET is_featured = 1, display_order = 9  WHERE slug = 'hp';
UPDATE brands SET is_featured = 1, display_order = 10 WHERE slug = 'peak';
UPDATE brands SET is_featured = 1, display_order = 11 WHERE slug = 'dyson';
UPDATE brands SET is_featured = 1, display_order = 12 WHERE slug = 'tecno';

-- Non-viable brands (0 active products) are left with logo_url = NULL and
-- is_featured = 0. They are excluded from Top Brands by the existing INNER
-- JOIN ... product_count >= 1 filter in getTopBrands(), so a NULL logo_url
-- here never reaches the UI. If/when these brands gain active products, this
-- same audit process must supply a real logo before they can be displayed.
