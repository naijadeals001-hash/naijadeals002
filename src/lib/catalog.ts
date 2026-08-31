import type { ProductWithListingRow, ListingRow, VendorRow, CategoryRow } from '../types'

/**
 * The "buy box" query — joins each product to its PRIMARY (lowest-price active) listing,
 * plus a seller_count subquery. This is the shape used everywhere a product is shown as a
 * single card (homepage carousels, search results, category grids). Seller comparison on the
 * PDP queries product_listings directly (see getListingsForProduct below) to show every offer.
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
  WHERE p.is_active = 1
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

export async function getByCategory(db: D1Database, categorySlug: string, limit = 20): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(
      `${PRODUCT_CARD_SELECT} AND (cat.slug = ? OR cat.parent_id = (SELECT id FROM categories WHERE slug = ?)) ORDER BY p.sales_count DESC LIMIT ?`
    )
    .bind(categorySlug, categorySlug, limit)
    .all<ProductWithListingRow>()
  return results
}

/**
 * "Top Brands" — hybrid merchandising ranking:
 *   1. Curated/featured brands first (is_featured = 1), ordered by display_order.
 *   2. Remaining brands fall back to real catalog activity (product_count DESC).
 * Only brands with logo_url set AND at least one active product are eligible —
 * a brand can never render in this section without a real, git-tracked asset.
 * status = 'active' gates future Admin Panel soft-hide without deleting rows.
 * This function is the ONLY place brand ordering/eligibility is decided; the UI
 * must never hardcode brand names, order, or image paths.
 */
export async function getTopBrands(db: D1Database, limit = 12) {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.slug, b.name, b.is_nigerian, b.logo_url, b.is_featured, b.display_order,
              COUNT(p.id) as product_count
       FROM brands b
       JOIN products p ON p.brand_id = b.id AND p.is_active = 1
       WHERE b.logo_url IS NOT NULL AND b.status = 'active'
       GROUP BY b.id
       ORDER BY b.is_featured DESC, b.display_order ASC, product_count DESC
       LIMIT ?`
    )
    .bind(limit)
    .all()
  return results
}

export async function getPopularVendors(db: D1Database, limit = 8): Promise<VendorRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM vendors WHERE is_verified = 1 ORDER BY rating_count DESC LIMIT ?')
    .bind(limit)
    .all<VendorRow>()
  return results
}

export async function getTopLevelCategories(db: D1Database): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY sort_order ASC')
    .all<CategoryRow>()
  return results
}

export async function getSubcategories(db: D1Database, parentSlug: string): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare('SELECT c.* FROM categories c JOIN categories p ON p.id = c.parent_id WHERE p.slug = ? ORDER BY c.sort_order ASC')
    .bind(parentSlug)
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

/** Subcategories ranked by live product count — "Popular Categories" (distinct from the fixed top-level "Shop by Category" list). */
export async function getPopularCategories(db: D1Database, limit = 10) {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.icon, COUNT(p.id) as product_count
       FROM categories c
       JOIN products p ON p.category_id = c.id AND p.is_active = 1
       WHERE c.parent_id IS NOT NULL
       GROUP BY c.id ORDER BY product_count DESC LIMIT ?`
    )
    .bind(limit)
    .all()
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
