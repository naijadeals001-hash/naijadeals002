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
    .prepare('SELECT product_id, quantity FROM cart_items WHERE cart_id = ?')
    .bind(guestCart.id)
    .all<{ product_id: number; quantity: number }>()

  for (const item of guestItems.results) {
    await db
      .prepare(
        `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)
         ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity`
      )
      .bind(userCartId, item.product_id, item.quantity)
      .run()
  }

  await db.prepare('DELETE FROM carts WHERE id = ?').bind(guestCart.id).run()
}

export async function getCartItems(db: D1Database, cartId: number): Promise<CartItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ci.id, ci.cart_id, ci.product_id, ci.quantity,
              p.title, p.slug, p.image_url, p.price_kobo, p.stock
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = ?
       ORDER BY ci.id ASC`
    )
    .bind(cartId)
    .all<CartItemRow>()
  return results
}

export async function addToCart(db: D1Database, cartId: number, productId: number, quantity: number) {
  await db
    .prepare(
      `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)
       ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity`
    )
    .bind(cartId, productId, quantity)
    .run()
}

export async function updateCartItemQuantity(db: D1Database, cartId: number, productId: number, quantity: number) {
  if (quantity <= 0) {
    await db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').bind(cartId, productId).run()
  } else {
    await db
      .prepare('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?')
      .bind(quantity, cartId, productId)
      .run()
  }
}

export async function removeFromCart(db: D1Database, cartId: number, productId: number) {
  await db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').bind(cartId, productId).run()
}

export async function clearCart(db: D1Database, cartId: number) {
  await db.prepare('DELETE FROM cart_items WHERE cart_id = ?').bind(cartId).run()
}
