-- NaijaDeals — Category Homepage Merchandising (Checkpoint B, Pat's "Shop by
-- Category" / "Popular Categories" rail directive, 2026-09-15)
--
-- Problem being fixed:
--   Shop by Category and Popular Categories must become two genuinely
--   DIFFERENT, database-driven, image-real merchandising rails (not the
--   fixed icon-grid dump this replaces). That requires two independent
--   signals on `categories`:
--
--   1. is_featured_home / homepage_priority — Enterprise-Control-Center-style
--      curation flag for "Shop by Category" (curated/featured departments,
--      e.g. Phones, Fashion, Beauty, Home, Grocery, Electronics). Ordered by
--      homepage_priority ASC, exactly like brands.display_order and
--      hero_campaigns.display_order (same convention, migration 0006).
--
--   2. Popular Categories continues to use getPopularCategories()'s existing
--      product_count-DESC ranking (real sales/activity signal, unchanged) —
--      no new column needed there. The two rails are structurally different
--      queries (curated flag vs. live product-count ranking), so they will
--      NOT render identical content even where the underlying category sets
--      overlap.
--
-- image_url is intentionally NOT touched by this migration — no placeholder
-- strings are ever inserted. A later UPDATE pass (this same Checkpoint B,
-- immediately after this migration) backfills real photography for the ~22
-- categories flagged is_featured_home=1 plus enough top-product-count
-- subcategories to give Popular Categories real content too. Both rails'
-- queries filter on `image_url IS NOT NULL AND image_url NOT LIKE '/ph.svg%'`
-- — "show fewer, but all real," same principle as every other section fixed
-- in this audit (Top Brands, Popular Vendors, Country Discovery).

ALTER TABLE categories ADD COLUMN is_featured_home INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN homepage_priority INTEGER;

-- Curate the initial "Shop by Category" set — real, already-seeded
-- subcategories spanning the departments Pat explicitly named (Phones,
-- Fashion, Beauty, Home, Grocery, Electronics, African identity categories).
-- display priority ASC controls rail order; ties are impossible here since
-- every row gets a distinct value.
UPDATE categories SET is_featured_home = 1, homepage_priority = 1  WHERE slug = 'smartphones';
UPDATE categories SET is_featured_home = 1, homepage_priority = 2  WHERE slug = 'african-fashion';
UPDATE categories SET is_featured_home = 1, homepage_priority = 3  WHERE slug = 'african-beauty';
UPDATE categories SET is_featured_home = 1, homepage_priority = 4  WHERE slug = 'kitchen-appliances';
UPDATE categories SET is_featured_home = 1, homepage_priority = 5  WHERE slug = 'african-foods';
UPDATE categories SET is_featured_home = 1, homepage_priority = 6  WHERE slug = 'laptops';
UPDATE categories SET is_featured_home = 1, homepage_priority = 7  WHERE slug = 'mens-shoes';
UPDATE categories SET is_featured_home = 1, homepage_priority = 8  WHERE slug = 'womens-shoes';
UPDATE categories SET is_featured_home = 1, homepage_priority = 9  WHERE slug = 'furniture';
UPDATE categories SET is_featured_home = 1, homepage_priority = 10 WHERE slug = 'handbags';
UPDATE categories SET is_featured_home = 1, homepage_priority = 11 WHERE slug = 'jewelry';
UPDATE categories SET is_featured_home = 1, homepage_priority = 12 WHERE slug = 'african-crafts';
UPDATE categories SET is_featured_home = 1, homepage_priority = 13 WHERE slug = 'computer-accessories';
UPDATE categories SET is_featured_home = 1, homepage_priority = 14 WHERE slug = 'home-improvement';
UPDATE categories SET is_featured_home = 1, homepage_priority = 15 WHERE slug = 'office-furniture';
UPDATE categories SET is_featured_home = 1, homepage_priority = 16 WHERE slug = 'african-agriculture';
UPDATE categories SET is_featured_home = 1, homepage_priority = 17 WHERE slug = 'phone-accessories';
UPDATE categories SET is_featured_home = 1, homepage_priority = 18 WHERE slug = 'televisions';
UPDATE categories SET is_featured_home = 1, homepage_priority = 19 WHERE slug = 'ankara-fabric';
UPDATE categories SET is_featured_home = 1, homepage_priority = 20 WHERE slug = 'adire';
UPDATE categories SET is_featured_home = 1, homepage_priority = 21 WHERE slug = 'travel-accessories';
UPDATE categories SET is_featured_home = 1, homepage_priority = 22 WHERE slug = 'gift-sets';
