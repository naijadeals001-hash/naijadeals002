-- Migration 0053: NaijaShop Marketplace Taxonomy Foundation (Phase 1a)
--
-- Purpose: fix the live "categories" bug (getTopLevelCategories/getSubcategories/
-- getPopularCategories return ALL categories regardless of category_type, so the
-- product-marketplace homepage was capable of rendering NaijaGigs' SERVICE
-- categories) and lay the scalable taxonomy foundation the NaijaShop directive
-- requires: 4-level hierarchy (department/group/subcategory/leaf), African/
-- country-scoped category nodes woven into the SAME tree (not a parallel
-- taxonomy), and a seed/live provenance marker on catalog rows.
--
-- NON-NEGOTIABLE COMPATIBILITY RULES (matching this project's established
-- migration discipline — see migrations 0038/0040 headers):
--   - Zero destructive changes. No table dropped or rebuilt. No existing
--     column removed, renamed, or reinterpreted.
--   - All 36 existing category rows (category_type='service', backing
--     NaijaGigs) are completely untouched by this migration's DDL. They are
--     NOT re-leveled/re-pathed here (see note on backfill below) — service
--     category consumers (services.ts) don't read level/path/country_iso,
--     so leaving them NULL is fully backward compatible.
--   - Every ALTER TABLE ADD COLUMN uses a CONSTANT literal default (never
--     datetime('now') or any function call) per the SQLite restriction
--     already documented in migrations 0027/0037/0038.
--   - Every new table/index is additive (IF NOT EXISTS).

PRAGMA foreign_keys = OFF;

-- ============================================================
-- 1. CATEGORY HIERARCHY DEPTH (department/group/subcategory/leaf)
-- ============================================================
-- level: 1=department, 2=group, 3=subcategory, 4=leaf. NULL on pre-existing
-- rows (not backfilled — see header) means "depth not yet classified",
-- which is honest: those rows predate this hierarchy concept entirely.
ALTER TABLE categories ADD COLUMN level INTEGER;

-- path: materialized ancestor path as '/'-joined ids, e.g. '1/14/203' for a
-- leaf whose department is id=1 and group is id=14. Enables O(1) ancestor/
-- descendant lookups ("all products under Fashion") via a single LIKE/prefix
-- query instead of a recursive CTE — the standard scalable pattern at the
-- 100k-row target this taxonomy must support. Root nodes get path = their
-- own id as text (e.g. '1'), set by the seed script since it is computed
-- from each row's own freshly-assigned id.
ALTER TABLE categories ADD COLUMN path TEXT;

-- country_iso: NULL = global/pan-African category (e.g. "Fashion", "African
-- Fashion"). Set = a country-specific node scoped under its region (e.g.
-- "Nigerian Fashion" -> country_iso='NG'). This is the mechanism that puts
-- the African/country layer INSIDE the one taxonomy tree, not in a second
-- disconnected system — a category simply IS global or IS country-scoped,
-- by construction. References cc_countries.iso_code informally (no FK: this
-- table lives in D1 and cc_countries may list a country not yet LIVE, e.g.
-- Kenya/Ghana/Morocco, which is fine — categories can exist ahead of a
-- country going operationally LIVE for delivery).
ALTER TABLE categories ADD COLUMN country_iso TEXT;

CREATE INDEX IF NOT EXISTS idx_categories_level ON categories(level);
CREATE INDEX IF NOT EXISTS idx_categories_country ON categories(country_iso);
CREATE INDEX IF NOT EXISTS idx_categories_type_level ON categories(category_type, level);
-- Prefix scans on path (e.g. WHERE path LIKE '1/14/%') are satisfied well
-- enough by SQLite's default TEXT collation on an indexed column; a
-- dedicated index still helps equality/prefix lookups at scale.
CREATE INDEX IF NOT EXISTS idx_categories_path ON categories(path);

-- ============================================================
-- 2. SEED / LIVE PROVENANCE MARKER (spec: "clearly distinguish seed/demo
--    catalog content from live merchant inventory")
-- ============================================================
-- Constant-literal default 'live' means every pre-existing product row (there
-- are none today, but this must be correct for any future direct-insert path
-- too) and every row inserted through the real seller pipeline
-- (seller-products.ts's createProduct/createListing, unchanged by this
-- migration) is unambiguously 'live' by default. Only this migration's own
-- seed script explicitly sets 'seed'.
ALTER TABLE products ADD COLUMN source_type TEXT NOT NULL DEFAULT 'live';
ALTER TABLE product_listings ADD COLUMN source_type TEXT NOT NULL DEFAULT 'live';
-- Valid values (not a CHECK constraint, matching this project's existing
-- convention of enforcing such enums in application code — see
-- moderation_status's precedent in migration 0038): seed | live | imported.

CREATE INDEX IF NOT EXISTS idx_products_source_type ON products(source_type);
CREATE INDEX IF NOT EXISTS idx_product_listings_source_type ON product_listings(source_type);

PRAGMA foreign_keys = ON;
