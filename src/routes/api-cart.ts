import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getOrCreateCartId, getCartItems, getSavedForLaterItems, addToCart, updateCartItemQuantity, removeFromCart, setSavedForLater } from '../lib/cart'
import { getOrSetGuestToken } from '../lib/guest'

export const cartApi = new Hono<AppEnv>()

async function resolveCartId(c: any): Promise<number> {
  const user = c.get('user')
  const guestToken = user ? null : getOrSetGuestToken(c)
  return getOrCreateCartId(c.env.DB, user?.id ?? null, guestToken)
}

function summarize(items: Awaited<ReturnType<typeof getCartItems>>) {
  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  const count = items.reduce((s, i) => s + i.quantity, 0)
  return { subtotal_kobo: subtotal, count }
}

cartApi.get('/', async (c) => {
  const cartId = await resolveCartId(c)
  const items = await getCartItems(c.env.DB, cartId)
  const saved = await getSavedForLaterItems(c.env.DB, cartId)
  return c.json({ items, saved, ...summarize(items) })
})

cartApi.post('/items', async (c) => {
  const body = await c.req.json<{ listing_id: number; quantity?: number; variant_id?: number }>().catch(() => null)
  if (!body?.listing_id) return c.json({ error: 'listing_id required' }, 400)

  const listing = await c.env.DB.prepare('SELECT id, stock FROM product_listings WHERE id = ? AND is_active = 1')
    .bind(body.listing_id)
    .first<{ id: number; stock: number }>()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  if (listing.stock <= 0) return c.json({ error: 'Out of stock' }, 400)

  const cartId = await resolveCartId(c)
  await addToCart(c.env.DB, cartId, body.listing_id, Math.max(1, body.quantity ?? 1), body.variant_id ?? null)
  const items = await getCartItems(c.env.DB, cartId)
  return c.json({ success: true, ...summarize(items) })
})

cartApi.put('/items/:cartItemId', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const body = await c.req.json<{ quantity: number }>().catch(() => null)
  if (body?.quantity === undefined) return c.json({ error: 'quantity required' }, 400)

  const cartId = await resolveCartId(c)
  await updateCartItemQuantity(c.env.DB, cartId, cartItemId, body.quantity)
  const items = await getCartItems(c.env.DB, cartId)
  return c.json({ items, ...summarize(items) })
})

cartApi.delete('/items/:cartItemId', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const cartId = await resolveCartId(c)
  await removeFromCart(c.env.DB, cartId, cartItemId)
  const items = await getCartItems(c.env.DB, cartId)
  return c.json({ items, ...summarize(items) })
})

cartApi.post('/items/:cartItemId/save-for-later', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const cartId = await resolveCartId(c)
  await setSavedForLater(c.env.DB, cartId, cartItemId, true)
  const items = await getCartItems(c.env.DB, cartId)
  const saved = await getSavedForLaterItems(c.env.DB, cartId)
  return c.json({ items, saved, ...summarize(items) })
})

cartApi.post('/items/:cartItemId/move-to-cart', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const cartId = await resolveCartId(c)
  await setSavedForLater(c.env.DB, cartId, cartItemId, false)
  const items = await getCartItems(c.env.DB, cartId)
  const saved = await getSavedForLaterItems(c.env.DB, cartId)
  return c.json({ items, saved, ...summarize(items) })
})
