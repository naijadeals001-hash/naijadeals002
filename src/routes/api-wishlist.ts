import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { getWishlistForUser, addToWishlist, removeFromWishlist, getWishlistProductIds } from '../lib/wishlist'
import { getOrCreateCartId, addToCart } from '../lib/cart'

export const wishlistApi = new Hono<AppEnv>()

wishlistApi.use('*', requireAuth)

wishlistApi.get('/', async (c) => {
  const user = c.get('user')!
  const items = await getWishlistForUser(c.env.DB, user.id)
  return c.json({ items })
})

wishlistApi.get('/ids', async (c) => {
  const user = c.get('user')!
  const ids = await getWishlistProductIds(c.env.DB, user.id)
  return c.json({ product_ids: ids })
})

wishlistApi.post('/', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ product_id: number }>().catch(() => null)
  if (!body?.product_id) return c.json({ error: 'product_id required' }, 400)

  const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').bind(body.product_id).first()
  if (!product) return c.json({ error: 'Product not found' }, 404)

  await addToWishlist(c.env.DB, user.id, body.product_id)
  const items = await getWishlistForUser(c.env.DB, user.id)
  return c.json({ success: true, count: items.length, items })
})

wishlistApi.delete('/:productId', async (c) => {
  const user = c.get('user')!
  const productId = Number(c.req.param('productId'))
  await removeFromWishlist(c.env.DB, user.id, productId)
  const items = await getWishlistForUser(c.env.DB, user.id)
  return c.json({ success: true, count: items.length, items })
})

/** Moves a wishlisted product into the cart (adds the product's current primary listing) and removes it from the wishlist — same semantics as cart's save-for-later "Move to cart". */
wishlistApi.post('/:productId/move-to-cart', async (c) => {
  const user = c.get('user')!
  const productId = Number(c.req.param('productId'))

  const listing = await c.env.DB
    .prepare('SELECT id, stock FROM product_listings WHERE product_id = ? AND is_primary = 1 AND is_active = 1')
    .bind(productId)
    .first<{ id: number; stock: number }>()
  if (!listing) return c.json({ error: 'This product is no longer available from any seller' }, 400)
  if (listing.stock <= 0) return c.json({ error: 'Out of stock' }, 400)

  const cartId = await getOrCreateCartId(c.env.DB, user.id, null)
  await addToCart(c.env.DB, cartId, listing.id, 1, null)
  await removeFromWishlist(c.env.DB, user.id, productId)

  const items = await getWishlistForUser(c.env.DB, user.id)
  return c.json({ success: true, count: items.length, items })
})
