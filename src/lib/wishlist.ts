import type { ProductWithListingRow } from '../types'

/**
 * Wishlist rows joined to the same "buy box" shape used everywhere else a product renders as a
 * card (current price, primary seller, stock/availability) — matches the PRODUCT_CARD_SELECT
 * pattern in lib/catalog.ts so the wishlist page can reuse <ProductCard> unmodified. We deliberately
 * do NOT snapshot price/seller into the wishlists table itself: a wishlist row is a bookmark onto a
 * live product, not an order line, so it must always reflect the CURRENT buy-box winner, exactly
 * like Amazon/Jumia wishlists do.
 */
export interface WishlistItemRow extends ProductWithListingRow {
  wishlist_id: number
  wishlisted_at: string
}

export async function getWishlistForUser(db: D1Database, userId: number): Promise<WishlistItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id as wishlist_id, w.created_at as wishlisted_at,
              p.*,
              cat.name as category_name, cat.slug as category_slug,
              b.name as brand_name, b.slug as brand_slug,
              l.id as listing_id, l.vendor_id, v.name as vendor_name, v.slug as vendor_slug,
              l.price_kobo, l.compare_at_price_kobo, l.stock,
              l.delivery_days_min, l.delivery_days_max, l.is_plus,
              (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active = 1) as seller_count
       FROM wishlists w
       JOIN products p ON p.id = w.product_id
       JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
       JOIN vendors v ON v.id = l.vendor_id
       JOIN categories cat ON cat.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`
    )
    .bind(userId)
    .all<WishlistItemRow>()
  return results
}

export async function getWishlistProductIds(db: D1Database, userId: number): Promise<number[]> {
  const { results } = await db
    .prepare('SELECT product_id FROM wishlists WHERE user_id = ?')
    .bind(userId)
    .all<{ product_id: number }>()
  return results.map((r) => r.product_id)
}

export async function isWishlisted(db: D1Database, userId: number, productId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM wishlists WHERE user_id = ? AND product_id = ?')
    .bind(userId, productId)
    .first()
  return !!row
}

/** Idempotent add — UNIQUE(user_id, product_id) means a re-add is a harmless no-op via INSERT OR IGNORE. */
export async function addToWishlist(db: D1Database, userId: number, productId: number): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO wishlists (user_id, product_id) VALUES (?, ?)')
    .bind(userId, productId)
    .run()
}

export async function removeFromWishlist(db: D1Database, userId: number, productId: number): Promise<void> {
  await db.prepare('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?').bind(userId, productId).run()
}

export async function getWishlistCount(db: D1Database, userId: number): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as n FROM wishlists WHERE user_id = ?').bind(userId).first<{ n: number }>()
  return row?.n ?? 0
}
