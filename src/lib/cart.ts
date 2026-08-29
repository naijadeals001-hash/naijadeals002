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
    await db
      .prepare(
        `INSERT INTO cart_items (cart_id, listing_id, variant_id, quantity) VALUES (?, ?, ?, ?)
         ON CONFLICT(cart_id, listing_id, variant_id) DO UPDATE SET quantity = quantity + excluded.quantity`
      )
      .bind(userCartId, item.listing_id, item.variant_id, item.quantity)
      .run()
  }

  await db.prepare('DELETE FROM carts WHERE id = ?').bind(guestCart.id).run()
}

/** Cart items ready to render — joined with listing/product/vendor/variant context. Excludes saved-for-later. */
export async function getCartItems(db: D1Database, cartId: number): Promise<CartItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ci.id, ci.cart_id, ci.listing_id, ci.variant_id, ci.quantity, ci.is_saved_for_later,
              p.id as product_id, p.title, p.slug, p.image_url,
              l.price_kobo, l.stock, l.vendor_id, v.name as vendor_name,
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
              l.price_kobo, l.stock, l.vendor_id, v.name as vendor_name,
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

export async function addToCart(
  db: D1Database,
  cartId: number,
  listingId: number,
  quantity: number,
  variantId: number | null = null
) {
  await db
    .prepare(
      `INSERT INTO cart_items (cart_id, listing_id, variant_id, quantity) VALUES (?, ?, ?, ?)
       ON CONFLICT(cart_id, listing_id, variant_id) DO UPDATE SET quantity = quantity + excluded.quantity`
    )
    .bind(cartId, listingId, variantId, quantity)
    .run()
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
