import type { ProductWithListingRow, ListingRow, VendorRow, CategoryRow } from '../types'

/**
 * The "buy box" query — joins each product to its PRIMARY (lowest-price active) listing,
 * plus a seller_count subquery. This is the shape used everywhere a product is shown as a
 * single card (homepage carousels, search results, category grids). Seller comparison on the
 * PDP queries product_listings directly (see getListingsForProduct below) to show every offer.
 *
 * VISUAL AUDIT FIX (Pat's "Full Visual Asset Audit" directive, 2026-09-15, Finding #3):
 * `p.image_url NOT LIKE '/ph.svg%'` is the same real-asset-vs-placeholder test already
 * applied to getTopBrands()/getPopularVendors() (see those functions' comments for the
 * full rationale). Before this fix, a render-based homepage audit found 39 `/ph.svg`
 * occurrences across ~29 distinct products still surfacing inside otherwise-legitimate
 * carousels (Recommended, New Arrivals, Nigerian Brands, etc.) because every carousel is
 * built on this one shared SELECT and none of them had an eligibility filter for image
 * quality. Adding it HERE, once, closes the gap for all 13 functions built on this
 * constant simultaneously, and implements the same "show fewer, but all real" principle
 * (directive #19/20): a carousel with only 8 of its usual 12 products because the other 4
 * don't have real photography yet is correct behavior, not a bug — it will silently
 * backfill to the full count as more product-image batches ship (see phase0_mapping.json).
 */
const PRODUCT_CARD_SELECT = `
  SELECT p.*,
         cat.name as category_name, cat.slug as category_slug,
         b.name as brand_name, b.slug as brand_slug,
         l.id as listing_id, l.vendor_id, v.name as vendor_name, v.slug as vendor_slug,
         l.price_kobo, l.compare_at_price_kobo, l.stock,
         l.delivery_days_min, l.delivery_days_max, l.is_plus,
         (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active = 1) as seller_count
  FROM products p
  JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
  JOIN vendors v ON v.id = l.vendor_id
  JOIN categories cat ON cat.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  WHERE p.is_active = 1 AND p.image_url IS NOT NULL AND p.image_url NOT LIKE '/ph.svg%'
`

export async function getFlashDeals(db: D1Database, limit = 10): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} AND p.is_flash_deal = 1 ORDER BY p.id ASC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

export async function getBestSellers(db: D1Database, limit = 10): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} ORDER BY p.sales_count DESC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

export async function getNewArrivals(db: D1Database, limit = 10): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

export async function getTrending(db: D1Database, limit = 10): Promise<ProductWithListingRow[]> {
  // Trending = high rating_count relative to age; simple proxy for MVP without event tracking yet
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} ORDER BY p.rating_count DESC, p.rating_avg DESC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

export async function getRecommended(db: D1Database, limit = 12): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} ORDER BY p.rating_avg DESC, p.rating_count DESC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

export async function getDiscounted(db: D1Database, limit = 10): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} AND l.compare_at_price_kobo IS NOT NULL ORDER BY (l.compare_at_price_kobo - l.price_kobo) DESC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

export async function getNigerianBrandProducts(db: D1Database, limit = 10): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} AND b.is_nigerian = 1 ORDER BY p.rating_count DESC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

/**
 * Products in a category OR any of its descendants at any depth (department
 * -> group -> subcategory -> leaf), via the materialized path (migration
 * 0053). Replaces the old "direct children only" join, which silently
 * missed grandchildren/leaves once the taxonomy grew past 2 levels.
 */
export async function getByCategory(db: D1Database, categorySlug: string, limit = 20): Promise<ProductWithListingRow[]> {
  const root = await db.prepare(`SELECT id, path FROM categories WHERE slug = ?`).bind(categorySlug).first<{ id: number; path: string | null }>()
  if (!root) return []
  const prefix = `${root.path ?? root.id}/`
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} AND (cat.id = ? OR cat.path LIKE ?) ORDER BY p.sales_count DESC LIMIT ?`)
    .bind(root.id, `${prefix}%`, limit)
    .all<ProductWithListingRow>()
  return results
}

/**
 * "Top Brands" — hybrid merchandising ranking:
 *   1. Curated/featured brands first (is_featured = 1), ordered by display_order.
 *   2. Remaining brands fall back to real catalog activity (product_count DESC).
 * Only brands with a REAL, verified logo asset AND at least one active product are
 * eligible — a brand can never render in this section without a real, git-tracked
 * asset. status = 'active' gates future Admin Panel soft-hide without deleting rows.
 * This function is the ONLY place brand ordering/eligibility is decided; the UI
 * must never hardcode brand names, order, or image paths.
 *
 * VISUAL AUDIT FIX (Pat's "Full Visual Asset Audit" directive, 2026-09-15):
 * `logo_url IS NOT NULL` alone is NOT a valid "has a real image" test — every brand
 * row was seeded with a non-null placeholder string (`/ph.svg?label=...`), so the
 * old filter let all 38 brands (including all 12 is_featured ones) pass through and
 * render as broken/placeholder cards on the live homepage. The customer-facing
 * question is never "is this column non-null", it's "does this path point at a real
 * asset". `/ph.svg` is the ONE reserved placeholder-generator route in this app
 * (see public/ph.svg / wherever it's served) — no real asset ever lives under that
 * path, so excluding it is a safe, exact test, not a heuristic. Per directive #19/20
 * ("show fewer, but all real"): if this filter drops every brand below `limit`, the
 * caller (home.tsx `{feed.top_brands.length > 0 && ...}`) already hides the whole
 * section rather than padding it with placeholders — that is the CORRECT behavior,
 * not a bug to work around.
 */
export async function getTopBrands(db: D1Database, limit = 12) {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.slug, b.name, b.is_nigerian, b.logo_url, b.is_featured, b.display_order,
              COUNT(p.id) as product_count
       FROM brands b
       JOIN products p ON p.brand_id = b.id AND p.is_active = 1
       WHERE b.logo_url IS NOT NULL AND b.logo_url NOT LIKE '/ph.svg%' AND b.status = 'active'
       GROUP BY b.id
       ORDER BY b.is_featured DESC, b.display_order ASC, product_count DESC
       LIMIT ?`
    )
    .bind(limit)
    .all()
  return results
}

/**
 * Popular Vendors — same placeholder-exclusion fix as getTopBrands (see comment
 * above). Previously this query had NO image-quality filter at all, so it always
 * returned `is_verified = 1` vendors regardless of whether their logo_url pointed
 * at a real asset or the `/ph.svg` placeholder generator. Per directive #19/20,
 * vendors without a real logo are excluded rather than shown as blank/placeholder
 * cards; if that drops the result below `limit` (or to zero), the caller in
 * home.tsx already hides the section entirely via `{feed.popular_vendors.length >
 * 0 && ...}` — showing fewer real vendors is correct, not a shortfall to patch over.
 */
export async function getPopularVendors(db: D1Database, limit = 8): Promise<VendorRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM vendors
       WHERE is_verified = 1 AND logo_url IS NOT NULL AND logo_url NOT LIKE '/ph.svg%'
       ORDER BY rating_count DESC LIMIT ?`
    )
    .bind(limit)
    .all<VendorRow>()
  return results
}

/**
 * Top-level PRODUCT categories only (category_type='product') — this is the
 * NaijaShop marketplace taxonomy's departments (migration 0053, level=1).
 * BUG FIX (Phase 1a inspection): this function previously had no
 * category_type filter, so it could return NaijaGigs' SERVICE categories
 * (Home Services, Beauty Services, ...) on the product marketplace homepage.
 * getServiceCategories() in services.ts is the equivalent for category_type='service'.
 */
export async function getTopLevelCategories(db: D1Database): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM categories WHERE parent_id IS NULL AND category_type = 'product' ORDER BY sort_order ASC`)
    .all<CategoryRow>()
  return results
}

/** Direct children of a PRODUCT category, scoped to category_type='product' so a service-category slug can never leak subcategories into a marketplace context. */
export async function getSubcategories(db: D1Database, parentSlug: string): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare(`SELECT c.* FROM categories c JOIN categories p ON p.id = c.parent_id WHERE p.slug = ? AND c.category_type = 'product' ORDER BY c.sort_order ASC`)
    .bind(parentSlug)
    .all<CategoryRow>()
  return results
}

/** Every descendant (any depth) of a PRODUCT category, using the materialized path (migration 0053) instead of a recursive CTE — O(1) prefix scan, scales to the 100k-leaf target. */
export async function getCategoryDescendants(db: D1Database, categorySlug: string): Promise<CategoryRow[]> {
  const root = await db.prepare(`SELECT id, path FROM categories WHERE slug = ? AND category_type = 'product'`).bind(categorySlug).first<{ id: number; path: string | null }>()
  if (!root) return []
  const prefix = `${root.path ?? root.id}/`
  const { results } = await db
    .prepare(`SELECT * FROM categories WHERE category_type = 'product' AND (id = ? OR path LIKE ?) ORDER BY level ASC, sort_order ASC`)
    .bind(root.id, `${prefix}%`)
    .all<CategoryRow>()
  return results
}

/** All seller listings for a product, cheapest first — this is the "Compare Sellers" data source. */
export async function getListingsForProduct(db: D1Database, productId: number) {
  const { results } = await db
    .prepare(
      `SELECT l.*, v.name as vendor_name, v.slug as vendor_slug, v.is_verified, v.rating_avg as vendor_rating,
              v.positive_feedback_percent, v.city as vendor_city, v.state as vendor_state
       FROM product_listings l
       JOIN vendors v ON v.id = l.vendor_id
       WHERE l.product_id = ? AND l.is_active = 1
       ORDER BY l.price_kobo ASC`
    )
    .bind(productId)
    .all()
  return results
}

export async function getVariantsForListing(db: D1Database, listingId: number) {
  const { results } = await db
    .prepare('SELECT * FROM product_variants WHERE listing_id = ? ORDER BY sort_order ASC')
    .bind(listingId)
    .all()
  return results
}

/** "Limited-Time Deals" — same discounted pool as Today's Deals but ranked by % off, not absolute savings, so the two sections are genuinely different sets/orderings, not the same query twice. */
export async function getLimitedTimeDeals(db: D1Database, limit = 10): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(
      `${PRODUCT_CARD_SELECT} AND l.compare_at_price_kobo IS NOT NULL
       ORDER BY ((l.compare_at_price_kobo - l.price_kobo) * 100.0 / l.compare_at_price_kobo) DESC, p.id DESC LIMIT ?`
    )
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

/**
 * "Popular Categories" — subcategories ranked by live product-count activity, a
 * genuinely different signal from "Shop by Category" (which is a curated
 * is_featured_home/homepage_priority list — see getFeaturedHomeCategories below
 * and migration 0056's header comment for why these must stay two distinct
 * queries, not the same list twice).
 *
 * CHECKPOINT B FIX (Pat's "NO SHORTCUTS / EXACT REFERENCE FIDELITY" directive,
 * 2026-09-16): this query previously had NO image-quality filter at all — it
 * would rank and return categories regardless of whether image_url pointed at
 * a real asset, a `/ph.svg` placeholder, or NULL. Since Checkpoint B replaces
 * the old icon+text grid with a MerchandisingRail that requires a dominant
 * REAL photo per card (no icons, no placeholders, no empty cards — directive
 * item 4), the same "show fewer, but all real" filter used by getTopBrands/
 * getPopularVendors/PRODUCT_CARD_SELECT is now applied here too. `image_url`
 * is added to the SELECT list so the rail has something to render.
 */
export async function getPopularCategories(db: D1Database, limit = 10) {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.icon, c.image_url, COUNT(p.id) as product_count
       FROM categories c
       JOIN products p ON p.category_id = c.id AND p.is_active = 1
       WHERE c.parent_id IS NOT NULL AND c.category_type = 'product'
         AND c.image_url IS NOT NULL AND c.image_url NOT LIKE '/ph.svg%'
       GROUP BY c.id ORDER BY product_count DESC LIMIT ?`
    )
    .bind(limit)
    .all()
  return results
}

/**
 * "Shop by Category" — curated/featured departments (migration 0056's
 * is_featured_home flag), ordered by homepage_priority ASC — same convention
 * as brands.display_order and hero_campaigns.display_order. This is a
 * DIFFERENT dataset from getPopularCategories() by design: one is editorial
 * curation (what we want to feature), the other is live activity ranking
 * (what customers are actually buying). They may overlap (verified: 6 of 22
 * curated categories are also in the top-12-by-product-count set) but are
 * never forced to be identical.
 *
 * Real-asset filter matches every other homepage merchandising query in this
 * file — a curated category without a real photo yet is excluded rather than
 * rendered as a placeholder/icon card (directive: "no placeholder, no empty
 * cards"). If this drops the result below `limit`, MerchandisingRail renders
 * fewer cards — correct behavior, not a bug to patch over.
 */
export async function getFeaturedHomeCategories(db: D1Database, limit = 12): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM categories
       WHERE is_featured_home = 1 AND category_type = 'product'
         AND image_url IS NOT NULL AND image_url NOT LIKE '/ph.svg%'
       ORDER BY homepage_priority ASC LIMIT ?`
    )
    .bind(limit)
    .all<CategoryRow>()
  return results
}

/**
 * "Deals Near You" — real filter on vendor.city of the primary listing, not a decorative label.
 * Location-dependent, so this is called live per-request (not through the TTL cache) using the
 * city the visitor has selected in the header (defaults to Lagos, matching Layout's default).
 */
export async function getDealsNearYou(db: D1Database, city: string, limit = 10): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} AND l.compare_at_price_kobo IS NOT NULL AND v.city = ? ORDER BY p.rating_count DESC LIMIT ?`)
    .bind(city, limit)
    .all<ProductWithListingRow>()
  if (results.length > 0) return results
  // Graceful fallback if no vendor is based in that exact city yet — still real data, just a wider radius.
  const { results: fallback } = await db
    .prepare(`${PRODUCT_CARD_SELECT} AND l.compare_at_price_kobo IS NOT NULL ORDER BY p.rating_count DESC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return fallback
}

/**
 * "African Discovery" rails (Phase 1b) — products whose DIRECT category node
 * is scoped to a specific country (migration 0053's country_iso column,
 * e.g. "Ankara Fabric" -> NG). This is the real in-tree African layer, not a
 * collections/banner substitute — see migration 0053's header comment and
 * scripts/seed/generate_phase1a_seed.py's country_iso inheritance logic.
 */
export async function getProductsByCountry(db: D1Database, countryIso: string, limit = 12): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} AND cat.country_iso = ? ORDER BY p.rating_count DESC, p.id DESC LIMIT ?`)
    .bind(countryIso, limit)
    .all<ProductWithListingRow>()
  return results
}

/** Fetches product cards by an explicit id list, preserving the given order — used to hydrate "Recently Viewed" from client-side localStorage ids. */
export async function getProductsByIds(db: D1Database, ids: number[]): Promise<ProductWithListingRow[]> {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db
    .prepare(`${PRODUCT_CARD_SELECT} AND p.id IN (${placeholders})`)
    .bind(...ids)
    .all<ProductWithListingRow>()
  const byId = new Map(results.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is ProductWithListingRow => !!r)
}
