-- NaijaDeals — Checkpoint 3: Category Pill Navigation Bar
-- Enterprise Control Center (Pat's directive, 2026-09-16)
--
-- ARCHITECTURE (per Pat's locked-in decisions A1/B/C from this checkpoint's
-- approval message):
--
--   ONE CATEGORY TAXONOMY (categories table, unchanged structure)
--        |
--        +--> ALL CATEGORIES (mega-menu)     -> is_visible          [existing]
--        +--> HEADER CATEGORY PILLS (NEW)    -> nav_pill_visible / nav_pill_order
--        +--> HOMEPAGE RAILS (merchandising) -> is_featured_home / homepage_priority [existing]
--
-- SCOPE DISCIPLINE (matching migration 0062's established precedent):
--   - Zero destructive changes. No table dropped/rebuilt, no column removed.
--   - nav_pill_visible / nav_pill_order are GENUINELY NEW columns — B is
--     explicit that is_visible / is_featured_home / homepage_priority must
--     NOT be reused for pill selection, to keep the three mechanisms
--     completely independent (one admin toggle must never have an
--     unintended side effect on an unrelated UI surface).
--   - nav_label_override / nav_badge (migration 0062) are REUSED as-is for
--     pill label/badge — a category can have exactly one override label,
--     shown consistently everywhere it's used (mega-menu AND pill), never
--     two competing label fields for the same concept.
--   - Defaults: nav_pill_visible=0 for all 225 existing rows — zero
--     categories become a header pill on migration apply. This migration's
--     own seed UPDATEs below are what curate the initial 13-pill set; this
--     is NOT a silent "everything becomes a pill" behavior change.
--
-- A1 (Pat, approved): navigation-only display labels via the EXISTING
-- nav_label_override column — the underlying `name`, `slug`, SEO,
-- breadcrumbs, PDP references and category relationships are completely
-- untouched. "Grocery & Food" and "Books & Education" remain the real
-- category names everywhere except the header pill / mega-menu label.
--
-- Destination URLs: every pill's href is derived at read time as
-- `/shop?category=<slug>` (src/lib/category-pill-nav.ts) — shop.tsx already
-- resolves this at ANY depth via the materialized path (migration 0053), so
-- no per-pill hardcoded URL is ever stored or needed. Mixed-depth pills
-- (level-1 departments alongside level-2/3 subcategories) work identically.

ALTER TABLE categories ADD COLUMN nav_pill_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN nav_pill_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_categories_nav_pill ON categories(nav_pill_visible, nav_pill_order);

-- ============================================================
-- A1: navigation-only display label overrides (name/slug/SEO/breadcrumbs/
-- PDP/relationships all remain "Grocery & Food" / "Books & Education" — only
-- wherever nav_label_override is consumed, i.e. mega-menu + header pill,
-- does the customer see the alternate label).
-- ============================================================
UPDATE categories SET nav_label_override = 'Supermarket'      WHERE slug = 'grocery-and-food';
UPDATE categories SET nav_label_override = 'Books & Learning' WHERE slug = 'books-and-education';

-- ============================================================
-- Initial curated pill set (13 categories, intentionally MIXED depth —
-- level-1 departments alongside level-2 subcategories — per Pat's explicit
-- "must NOT simply be the first N database categories" directive). Every
-- slug below was verified to exist in the live taxonomy before this
-- migration was written (see Checkpoint 3 report, Section "DATABASE").
-- ============================================================
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 1  WHERE slug = 'electronics';               -- level 1
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 2  WHERE slug = 'fashion';                    -- level 1
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 3  WHERE slug = 'phones-and-tablets';         -- level 2 (under Electronics)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 4  WHERE slug = 'computers-and-laptops';      -- level 2 (under Electronics)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 5  WHERE slug = 'grocery-and-food';           -- level 1, displays as "Supermarket"
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 6  WHERE slug = 'beauty-and-personal-care';   -- level 1
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 7  WHERE slug = 'home-and-kitchen';           -- level 1
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 8  WHERE slug = 'automotive';                 -- level 1
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 9  WHERE slug = 'sports-and-fitness';         -- level 1
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 10 WHERE slug = 'african-fashion';            -- level 2 (under Fashion)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 11 WHERE slug = 'art-and-crafts';             -- level 1
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 12 WHERE slug = 'baby-and-kids';              -- level 1
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 13 WHERE slug = 'books-and-education';        -- level 1, displays as "Books & Learning"
