/**
 * NaijaFresh — data layer (migration 0077 foundation).
 *
 * Scopes every query to the existing `fresh-food` category tree (id=100 and
 * its descendants — categories 101-114 pre-existing, 400-405 added by
 * migration 0077). This module NEVER creates a parallel taxonomy or a
 * second buy-box join — it reuses catalog.ts's exact PRODUCT_CARD_SELECT
 * shape (real-asset filter, is_primary/is_active listing join, seller_count
 * subquery) and only ADDS the Fresh-specific listing columns
 * (unit_of_measure, is_variable_weight, ...) and vendor city/state that the
 * base catalog.ts SELECT does not project. See catalog.ts's own header
 * comment for why the real-asset (`/ph.svg` exclusion) filter exists — the
 * same rule applies here without exception.
 */
import type { ProductWithListingRow, CategoryRow } from '../types'

/** The fresh-food department id. Never hardcode `100` elsewhere — import this constant. */
export const FRESH_ROOT_CATEGORY_ID = 100

/**
 * Buy-box product card select, Fresh-flavored: same join shape as
 * catalog.ts's PRODUCT_CARD_SELECT, plus the columns a Fresh product card
 * needs that the generic one doesn't select (unit_of_measure,
 * is_variable_weight, variable_weight_tolerance_pct, vendor city/state for
 * the "seller location" line, and a wholesale-tier existence flag).
 */
const FRESH_PRODUCT_CARD_SELECT = `
  SELECT p.*,
         cat.name as category_name, cat.slug as category_slug,
         b.name as brand_name, b.slug as brand_slug,
         l.id as listing_id, l.vendor_id, v.name as vendor_name, v.slug as vendor_slug,
         v.city as vendor_city, v.state as vendor_state,
         l.price_kobo, l.compare_at_price_kobo, l.currency, l.stock,
         l.delivery_days_min, l.delivery_days_max, l.is_plus,
         l.unit_of_measure, l.unit_quantity, l.is_variable_weight, l.variable_weight_tolerance_pct,
         (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active = 1) as seller_count,
         (SELECT COUNT(*) FROM product_pricing_tiers pt WHERE pt.listing_id = l.id AND pt.is_active = 1) as has_wholesale_pricing,
         (SELECT GROUP_CONCAT(col.slug) FROM product_collections pc JOIN collections col ON col.id = pc.collection_id WHERE pc.product_id = p.id) as collection_slugs
  FROM products p
  JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
  JOIN vendors v ON v.id = l.vendor_id
  JOIN categories cat ON cat.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  WHERE p.is_active = 1 AND p.image_url IS NOT NULL AND p.image_url NOT LIKE '/ph.svg%'
    AND (cat.id = ${FRESH_ROOT_CATEGORY_ID} OR cat.path LIKE '${FRESH_ROOT_CATEGORY_ID}/%')
`

/** Direct children of the fresh-food department (id=100) — the category discovery grid on /fresh. DB-driven, never hardcoded. */
export async function getFreshCategories(db: D1Database): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM categories WHERE parent_id = ? AND category_type = 'product' ORDER BY sort_order ASC`)
    .bind(FRESH_ROOT_CATEGORY_ID)
    .all<CategoryRow>()
  return results
}

/** Resolves one Fresh category by slug — must be id=100 itself or a descendant, otherwise callers must treat it as "not a Fresh category" (honest zero, never a silent cross-vertical leak). */
export async function getFreshCategoryBySlug(db: D1Database, slug: string): Promise<CategoryRow | null> {
  const row = await db.prepare(`SELECT * FROM categories WHERE slug = ?`).bind(slug).first<CategoryRow>()
  if (!row) return null
  if (row.id === FRESH_ROOT_CATEGORY_ID) return row
  if (row.path && row.path.startsWith(`${FRESH_ROOT_CATEGORY_ID}/`)) return row
  return null
}

/** "Fresh Today" — most recently added Fresh products, newest first. Real query, no fabricated array. */
export async function getFreshToday(db: D1Database, limit = 12): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${FRESH_PRODUCT_CARD_SELECT} ORDER BY p.id DESC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

/** Products tagged into a merchandising collection (farm-direct/market-fresh/wholesale/bulk/imported), scoped to the Fresh tree. */
export async function getFreshCollection(db: D1Database, collectionSlug: string, limit = 12): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(
      `${FRESH_PRODUCT_CARD_SELECT}
         AND EXISTS (
           SELECT 1 FROM product_collections pc2 JOIN collections col2 ON col2.id = pc2.collection_id
           WHERE pc2.product_id = p.id AND col2.slug = ? AND col2.is_active = 1
         )
       ORDER BY p.id DESC LIMIT ?`
    )
    .bind(collectionSlug, limit)
    .all<ProductWithListingRow>()
  return results
}

/** African Foods rail — the African Traditional Foods leaf category (403) specifically, per Pat's §15 "African Foods" section. */
export async function getFreshAfricanFoods(db: D1Database, limit = 12): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(`${FRESH_PRODUCT_CARD_SELECT} AND cat.slug = 'fresh-african-traditional-foods' ORDER BY p.id DESC LIMIT ?`)
    .bind(limit)
    .all<ProductWithListingRow>()
  return results
}

export interface FreshBrowseFilters {
  category?: string
  q?: string
  minPrice?: string
  maxPrice?: string
  sort?: string
  variableWeight?: string
  wholesale?: string
  collection?: string
  page?: number
  perPage?: number
}

export interface FreshBrowseResult {
  products: ProductWithListingRow[]
  total: number
  totalPages: number
  activeCategory: CategoryRow | null
  categoryLookupFailed: boolean
}

/**
 * Category listing + search, scoped to the Fresh tree — this is the exact
 * shop.tsx pattern (dynamic WHERE, honest-zero on unknown category slug,
 * real sort options) applied to fresh-food(100) instead of the whole
 * catalog. Deliberately NOT calling into shop.tsx's own function (it isn't
 * exported as a reusable helper — it's a page handler) — this is the one
 * new query this feature needs, built the same way, not a duplicate engine.
 */
export async function browseFreshProducts(db: D1Database, filters: FreshBrowseFilters): Promise<FreshBrowseResult> {
  const perPage = filters.perPage ?? 24
  const page = Math.max(1, filters.page ?? 1)
  const offset = (page - 1) * perPage

  let sql = FRESH_PRODUCT_CARD_SELECT
  const binds: any[] = []
  let activeCategory: CategoryRow | null = null
  let categoryLookupFailed = false

  if (filters.category) {
    activeCategory = await getFreshCategoryBySlug(db, filters.category)
    if (activeCategory) {
      sql += ' AND (cat.id = ? OR cat.path LIKE ?)'
      binds.push(activeCategory.id, `${activeCategory.path ?? activeCategory.id}/%`)
    } else {
      categoryLookupFailed = true
      sql += ' AND 1 = 0' // honest zero — unknown/non-Fresh category slug, never a silent full-tree fallback
    }
  }
  if (filters.q) {
    sql += ' AND (p.title LIKE ? OR p.description LIKE ? OR v.name LIKE ?)'
    binds.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`)
  }
  if (filters.minPrice) {
    sql += ' AND l.price_kobo >= ?'
    binds.push(Number(filters.minPrice) * 100)
  }
  if (filters.maxPrice) {
    sql += ' AND l.price_kobo <= ?'
    binds.push(Number(filters.maxPrice) * 100)
  }
  if (filters.variableWeight === '1') {
    sql += ' AND l.is_variable_weight = 1'
  }
  if (filters.wholesale === '1') {
    sql += ' AND EXISTS (SELECT 1 FROM product_pricing_tiers pt WHERE pt.listing_id = l.id AND pt.is_active = 1)'
  }
  if (filters.collection) {
    sql += ' AND EXISTS (SELECT 1 FROM product_collections pc3 JOIN collections col3 ON col3.id = pc3.collection_id WHERE pc3.product_id = p.id AND col3.slug = ? AND col3.is_active = 1)'
    binds.push(filters.collection)
  }

  const countSql = sql.replace(/SELECT p\.\*[\s\S]*?FROM products p/, 'SELECT COUNT(*) as total FROM products p')
  const countRow = await db.prepare(countSql).bind(...binds).first<{ total: number }>()
  const total = countRow?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  switch (filters.sort) {
    case 'price_asc': sql += ' ORDER BY l.price_kobo ASC'; break
    case 'price_desc': sql += ' ORDER BY l.price_kobo DESC'; break
    case 'rating': sql += ' ORDER BY p.rating_avg DESC, p.rating_count DESC'; break
    case 'bestselling': sql += ' ORDER BY p.sales_count DESC'; break
    default: sql += ' ORDER BY p.id DESC'
  }
  sql += ' LIMIT ? OFFSET ?'
  binds.push(perPage, offset)

  const products = await db.prepare(sql).bind(...binds).all<ProductWithListingRow>()
  return { products: products.results, total, totalPages, activeCategory, categoryLookupFailed }
}

/** Human-readable label + Material-icon + Tailwind color for products.freshness_status. Mirrors gigs.tsx's URGENCY_LABEL/REQUEST_STATUS_LABEL map pattern. */
export const FRESHNESS_LABEL: Record<string, { label: string; icon: string; color: string }> = {
  harvested_today: { label: 'Harvested Today', icon: 'eco', color: 'bg-primary text-white' },
  harvested_this_week: { label: 'Harvested This Week', icon: 'eco', color: 'bg-primary-light text-primary-dark' },
  fresh_daily: { label: 'Fresh Daily', icon: 'water_drop', color: 'bg-primary text-white' },
  caught_today: { label: 'Caught Today', icon: 'set_meal', color: 'bg-blue-600 text-white' },
  baked_today: { label: 'Baked Today', icon: 'bakery_dining', color: 'bg-amber-600 text-white' },
  frozen: { label: 'Frozen', icon: 'ac_unit', color: 'bg-sky-600 text-white' },
}

/** Merchandising-collection badge labels — src/lib/collections.ts already owns the DB rows; this is purely the customer-facing short label for the small badge on a Fresh product card/PDP. */
export const COLLECTION_BADGE_LABEL: Record<string, string> = {
  'farm-direct': 'Farm Direct',
  'market-fresh': 'Market Fresh',
  wholesale: 'Wholesale',
  bulk: 'Bulk',
  imported: 'Imported',
}
