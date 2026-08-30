import type { CartItemRow } from '../types'

/** Resolves (or creates) the cart id for a logged-in user or a guest token. */
export async function getOrCreateCartId(
  db: D1Database,
  userId: number | null,
  guestToken: string | null
): Promise<number> {
  if (userId) {
    const existing = await db.prepare('SELECT id FROM carts WHERE user_id = ?').bind(userId).first<{ id: number }>()
    if (existing) return existing.id
    const inserted = await db.prepare('INSERT INTO carts (user_id) VALUES (?)').bind(userId).run()
    return inserted.meta.last_row_id as number
  }

  if (guestToken) {
    const existing = await db
      .prepare('SELECT id FROM carts WHERE guest_token = ?')
      .bind(guestToken)
      .first<{ id: number }>()
    if (existing) return existing.id
  }

  const inserted = await db.prepare('INSERT INTO carts (guest_token) VALUES (?)').bind(guestToken).run()
  return inserted.meta.last_row_id as number
}

/** When a guest logs in, merge their guest cart into their user cart. */
export async function mergeGuestCartIntoUser(db: D1Database, guestToken: string, userId: number) {
  const guestCart = await db
    .prepare('SELECT id FROM carts WHERE guest_token = ?')
    .bind(guestToken)
    .first<{ id: number }>()
  if (!guestCart) return

  const userCartId = await getOrCreateCartId(db, userId, null)
  const guestItems = await db
    .prepare('SELECT listing_id, variant_id, quantity FROM cart_items WHERE cart_id = ?')
    .bind(guestCart.id)
    .all<{ listing_id: number; variant_id: number | null; quantity: number }>()

  for (const item of guestItems.results) {
    await addToCart(db, userCartId, item.listing_id, item.quantity, item.variant_id)
  }

  await db.prepare('DELETE FROM carts WHERE id = ?').bind(guestCart.id).run()
}

/** Cart items ready to render — joined with listing/product/vendor/variant context. Excludes saved-for-later. */
export async function getCartItems(db: D1Database, cartId: number): Promise<CartItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ci.id, ci.cart_id, ci.listing_id, ci.variant_id, ci.quantity, ci.is_saved_for_later,
              p.id as product_id, p.title, p.slug, p.image_url,
              l.price_kobo, l.compare_at_price_kobo, l.stock, l.vendor_id,
              l.delivery_days_min, l.delivery_days_max,
              v.name as vendor_name, v.slug as vendor_slug, v.is_verified,
              pv.variant_value
       FROM cart_items ci
       JOIN product_listings l ON l.id = ci.listing_id
       JOIN products p ON p.id = l.product_id
       JOIN vendors v ON v.id = l.vendor_id
       LEFT JOIN product_variants pv ON pv.id = ci.variant_id
       WHERE ci.cart_id = ? AND ci.is_saved_for_later = 0
       ORDER BY ci.id ASC`
    )
    .bind(cartId)
    .all<CartItemRow>()
  return results
}

export async function getSavedForLaterItems(db: D1Database, cartId: number): Promise<CartItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ci.id, ci.cart_id, ci.listing_id, ci.variant_id, ci.quantity, ci.is_saved_for_later,
              p.id as product_id, p.title, p.slug, p.image_url,
              l.price_kobo, l.compare_at_price_kobo, l.stock, l.vendor_id,
              l.delivery_days_min, l.delivery_days_max,
              v.name as vendor_name, v.slug as vendor_slug, v.is_verified,
              pv.variant_value
       FROM cart_items ci
       JOIN product_listings l ON l.id = ci.listing_id
       JOIN products p ON p.id = l.product_id
       JOIN vendors v ON v.id = l.vendor_id
       LEFT JOIN product_variants pv ON pv.id = ci.variant_id
       WHERE ci.cart_id = ? AND ci.is_saved_for_later = 1
       ORDER BY ci.id ASC`
    )
    .bind(cartId)
    .all<CartItemRow>()
  return results
}

/**
 * IMPORTANT: SQLite's UNIQUE(cart_id, listing_id, variant_id) constraint does NOT treat two NULL
 * variant_ids as equal — so `INSERT ... ON CONFLICT` silently INSERTs a duplicate row instead of
 * upserting whenever variant_id is NULL (the common case: most listings have no color/size variants).
 * We therefore look up the existing row manually with an explicit NULL-safe comparison, rather than
 * relying on the DB constraint to dedupe for us.
 */
export async function addToCart(
  db: D1Database,
  cartId: number,
  listingId: number,
  quantity: number,
  variantId: number | null = null
) {
  const existing = await db
    .prepare(
      `SELECT id, quantity FROM cart_items
       WHERE cart_id = ? AND listing_id = ?
         AND ((variant_id IS NULL AND ? IS NULL) OR variant_id = ?)
         AND is_saved_for_later = 0`
    )
    .bind(cartId, listingId, variantId, variantId)
    .first<{ id: number; quantity: number }>()

  if (existing) {
    await db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').bind(existing.quantity + quantity, existing.id).run()
  } else {
    await db
      .prepare('INSERT INTO cart_items (cart_id, listing_id, variant_id, quantity) VALUES (?, ?, ?, ?)')
      .bind(cartId, listingId, variantId, quantity)
      .run()
  }
}

export async function updateCartItemQuantity(db: D1Database, cartId: number, cartItemId: number, quantity: number) {
  if (quantity <= 0) {
    await db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND id = ?').bind(cartId, cartItemId).run()
  } else {
    await db
      .prepare('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND id = ?')
      .bind(quantity, cartId, cartItemId)
      .run()
  }
}

export async function removeFromCart(db: D1Database, cartId: number, cartItemId: number) {
  await db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND id = ?').bind(cartId, cartItemId).run()
}

export async function setSavedForLater(db: D1Database, cartId: number, cartItemId: number, saved: boolean) {
  await db
    .prepare('UPDATE cart_items SET is_saved_for_later = ? WHERE cart_id = ? AND id = ?')
    .bind(saved ? 1 : 0, cartId, cartItemId)
    .run()
}

export async function clearCart(db: D1Database, cartId: number) {
  await db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND is_saved_for_later = 0').bind(cartId).run()
}

/**
 * Removes only the specific listing_ids that were just paid for. Used after a successful payment
 * instead of a blanket clearCart(), so that a "Buy Now" purchase (which bypasses the persisted cart
 * entirely) never wipes out unrelated items the customer still had sitting in their real cart.
 */
export async function removeCartItemsByListingIds(db: D1Database, cartId: number, listingIds: number[]) {
  if (listingIds.length === 0) return
  const placeholders = listingIds.map(() => '?').join(',')
  await db
    .prepare(`DELETE FROM cart_items WHERE cart_id = ? AND is_saved_for_later = 0 AND listing_id IN (${placeholders})`)
    .bind(cartId, ...listingIds)
    .run()
}

/**
 * Resolves a single listing into the same CartItemRow shape used everywhere else, WITHOUT touching
 * the persisted cart_items table at all. This backs the "Buy Now" flow: price, vendor, and stock are
 * always re-read fresh from product_listings here (never trusted from the client), so a customer can
 * never end up paying Seller B's price for something they clicked "Buy Now" on under Seller A.
 */
export async function getBuyNowItem(
  db: D1Database,
  listingId: number,
  quantity: number,
  variantId: number | null = null
): Promise<CartItemRow | null> {
  const row = await db
    .prepare(
      `SELECT -1 as id, -1 as cart_id, l.id as listing_id, ? as variant_id, ? as quantity, 0 as is_saved_for_later,
              p.id as product_id, p.title, p.slug, p.image_url,
              l.price_kobo, l.compare_at_price_kobo, l.stock, l.vendor_id,
              l.delivery_days_min, l.delivery_days_max,
              v.name as vendor_name, v.slug as vendor_slug, v.is_verified,
              pv.variant_value
       FROM product_listings l
       JOIN products p ON p.id = l.product_id
       JOIN vendors v ON v.id = l.vendor_id
       LEFT JOIN product_variants pv ON pv.id = ?
       WHERE l.id = ? AND l.is_active = 1 AND p.is_active = 1`
    )
    .bind(variantId, quantity, variantId, listingId)
    .first<CartItemRow>()
  return row ?? null
}

/** Groups cart items by vendor — used for multi-seller cart display and per-seller order splitting. */
export function groupByVendor(items: CartItemRow[]): Map<number, { vendorName: string; items: CartItemRow[] }> {
  const groups = new Map<number, { vendorName: string; items: CartItemRow[] }>()
  for (const item of items) {
    if (!groups.has(item.vendor_id)) {
      groups.set(item.vendor_id, { vendorName: item.vendor_name, items: [] })
    }
    groups.get(item.vendor_id)!.items.push(item)
  }
  return groups
}
