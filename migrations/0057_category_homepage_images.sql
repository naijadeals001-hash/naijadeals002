-- NaijaDeals — Category Homepage Merchandising: real image backfill
-- (Checkpoint B, Pat's "NO SHORTCUTS / EXACT REFERENCE FIDELITY" directive,
-- 2026-09-16)
--
-- Backfills categories.image_url with real, generated premium-photography
-- assets (fal-ai/z-image/turbo, 1:1, "clean bright background, no visible
-- brand logos or text" — zero trademark risk, unlike the Top Brands logo
-- problem in Part C) for:
--
--   1. All 22 categories flagged is_featured_home=1 by migration 0056
--      (drives "Shop by Category" rail)
--   2. kenyan-coffee — a real product-count-ranked category OUTSIDE the
--      curated set, imaged specifically so "Popular Categories" (which
--      ranks by getPopularCategories()'s existing product_count DESC query,
--      unchanged) has at least one real-image row that is NOT also in the
--      curated set, keeping the two rails' rendered content genuinely
--      distinct rather than Popular Categories being a strict subset.
--
-- Files live at public/static/categories/<slug>.jpg, served as static
-- assets (Cloudflare Pages serveStatic). No placeholder strings inserted —
-- every row here gets a real, checked-in image file.
--
-- Both getFeaturedHomeCategories() (Shop by Category) and the updated
-- getPopularCategories() (Popular Categories) filter on
-- `image_url IS NOT NULL AND image_url NOT LIKE '/ph.svg%'`, so only rows
-- touched by this migration will ever render in either rail.

UPDATE categories SET image_url = '/static/categories/smartphones.jpg'          WHERE slug = 'smartphones';
UPDATE categories SET image_url = '/static/categories/african-fashion.jpg'      WHERE slug = 'african-fashion';
UPDATE categories SET image_url = '/static/categories/african-beauty.jpg'       WHERE slug = 'african-beauty';
UPDATE categories SET image_url = '/static/categories/kitchen-appliances.jpg'   WHERE slug = 'kitchen-appliances';
UPDATE categories SET image_url = '/static/categories/african-foods.jpg'        WHERE slug = 'african-foods';
UPDATE categories SET image_url = '/static/categories/laptops.jpg'              WHERE slug = 'laptops';
UPDATE categories SET image_url = '/static/categories/mens-shoes.jpg'           WHERE slug = 'mens-shoes';
UPDATE categories SET image_url = '/static/categories/womens-shoes.jpg'         WHERE slug = 'womens-shoes';
UPDATE categories SET image_url = '/static/categories/furniture.jpg'            WHERE slug = 'furniture';
UPDATE categories SET image_url = '/static/categories/handbags.jpg'             WHERE slug = 'handbags';
UPDATE categories SET image_url = '/static/categories/jewelry.jpg'              WHERE slug = 'jewelry';
UPDATE categories SET image_url = '/static/categories/african-crafts.jpg'       WHERE slug = 'african-crafts';
UPDATE categories SET image_url = '/static/categories/computer-accessories.jpg' WHERE slug = 'computer-accessories';
UPDATE categories SET image_url = '/static/categories/home-improvement.jpg'     WHERE slug = 'home-improvement';
UPDATE categories SET image_url = '/static/categories/office-furniture.jpg'     WHERE slug = 'office-furniture';
UPDATE categories SET image_url = '/static/categories/african-agriculture.jpg'  WHERE slug = 'african-agriculture';
UPDATE categories SET image_url = '/static/categories/phone-accessories.jpg'    WHERE slug = 'phone-accessories';
UPDATE categories SET image_url = '/static/categories/televisions.jpg'          WHERE slug = 'televisions';
UPDATE categories SET image_url = '/static/categories/ankara-fabric.jpg'        WHERE slug = 'ankara-fabric';
UPDATE categories SET image_url = '/static/categories/adire.jpg'                WHERE slug = 'adire';
UPDATE categories SET image_url = '/static/categories/travel-accessories.jpg'   WHERE slug = 'travel-accessories';
UPDATE categories SET image_url = '/static/categories/gift-sets.jpg'            WHERE slug = 'gift-sets';

-- Popular-Categories-only real image (not in the curated is_featured_home set)
UPDATE categories SET image_url = '/static/categories/kenyan-coffee.jpg'        WHERE slug = 'kenyan-coffee';
