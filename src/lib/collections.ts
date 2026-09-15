/**
 * Marketplace Engine 2.0 — Merchandising Collections (spec section 26) and
 * Africa-first taxonomy (spec section 6).
 *
 * Collections are SEPARATE from category/brand taxonomy: a product can
 * belong to any number of collections without its canonical category_id
 * ever changing. Follows the same PRODUCT_CARD_SELECT-style join precedent
 * established in src/lib/catalog.ts rather than reinventing the query
 * shape.
 */
import type { CollectionRow, ProductWithListingRow } from '../types'

const PRODUCT_CARD_SELECT = `
  SELECT
    p.*, l.id AS listing_id, l.vendor_id, v.name AS vendor_name, v.slug AS vendor_slug,
    l.price_kobo, l.compare_at_price_kobo, l.stock, l.delivery_days_min, l.delivery_days_max, l.is_plus,
    c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, b.slug AS brand_slug,
    (SELECT COUNT(*) FROM product_listings pl2 WHERE pl2.product_id = p.id AND pl2.is_active = 1) AS seller_count
  FROM products p
  JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
  JOIN vendors v ON v.id = l.vendor_id
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
`

export async function getAllCollections(db: D1Database, collectionType?: string): Promise<CollectionRow[]> {
  const sql = collectionType
    ? 'SELECT * FROM collections WHERE is_active = 1 AND collection_type = ? ORDER BY sort_order ASC'
    : 'SELECT * FROM collections WHERE is_active = 1 ORDER BY sort_order ASC'
  const { results } = collectionType
    ? await db.prepare(sql).bind(collectionType).all<CollectionRow>()
    : await db.prepare(sql).all<CollectionRow>()
  return results
}

export async function getCollectionBySlug(db: D1Database, slug: string): Promise<CollectionRow | null> {
  return db.prepare('SELECT * FROM collections WHERE slug = ? AND is_active = 1').bind(slug).first<CollectionRow>()
}

/**
 * Products in a collection, in the same buy-box product-card shape used everywhere else
 * (catalog.ts precedent). VISUAL AUDIT FIX (Pat's directive, 2026-09-15): same real-asset
 * filter as catalog.ts's PRODUCT_CARD_SELECT — a product without a verified photo must
 * never render in a merchandising collection either, even though this endpoint isn't
 * wired into the homepage yet (it's exposed via /api/catalog/collections for future use).
 */
export async function getProductsInCollection(db: D1Database, collectionSlug: string, limit = 24): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(
      `${PRODUCT_CARD_SELECT}
       JOIN product_collections pc ON pc.product_id = p.id
       JOIN collections col ON col.id = pc.collection_id
       WHERE col.slug = ? AND col.is_active = 1 AND p.is_active = 1
         AND p.image_url IS NOT NULL AND p.image_url NOT LIKE '/ph.svg%'
       ORDER BY pc.sort_order ASC, p.sales_count DESC
       LIMIT ?`
    )
    .bind(collectionSlug, limit)
    .all<ProductWithListingRow>()
  return results
}

/** Adds a product to a collection. Idempotent (INSERT OR IGNORE on the UNIQUE(collection_id, product_id) constraint). */
export async function addProductToCollection(db: D1Database, collectionId: number, productId: number, sortOrder = 0): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO product_collections (collection_id, product_id, sort_order) VALUES (?, ?, ?)')
    .bind(collectionId, productId, sortOrder)
    .run()
}

export async function removeProductFromCollection(db: D1Database, collectionId: number, productId: number): Promise<void> {
  await db.prepare('DELETE FROM product_collections WHERE collection_id = ? AND product_id = ?').bind(collectionId, productId).run()
}

/** Which collections a given product currently belongs to (seller-facing "tag this product" UI). */
export async function getCollectionsForProduct(db: D1Database, productId: number): Promise<CollectionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT col.* FROM collections col
       JOIN product_collections pc ON pc.collection_id = col.id
       WHERE pc.product_id = ?
       ORDER BY col.sort_order ASC`
    )
    .bind(productId)
    .all<CollectionRow>()
  return results
}
