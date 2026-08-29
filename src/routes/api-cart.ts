import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getOrCreateCartId, getCartItems, addToCart, updateCartItemQuantity, removeFromCart } from '../lib/cart'
import { getOrSetGuestToken } from '../lib/guest'

export const cartApi = new Hono<AppEnv>()

async function resolveCartId(c: any): Promise<number> {
  const user = c.get('user')
  const guestToken = user ? null : getOrSetGuestToken(c)
  return getOrCreateCartId(c.env.DB, user?.id ?? null, guestToken)
}

cartApi.get('/', async (c) => {
  const cartId = await resolveCartId(c)
  const items = await getCartItems(c.env.DB, cartId)
  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  return c.json({ items, subtotal_kobo: subtotal, count: items.reduce((s, i) => s + i.quantity, 0) })
})

cartApi.post('/items', async (c) => {
  const body = await c.req.json<{ product_id: number; quantity?: number }>().catch(() => null)
  if (!body?.product_id) return c.json({ error: 'product_id required' }, 400)

  const product = await c.env.DB.prepare('SELECT id, stock FROM products WHERE id = ? AND is_active = 1')
    .bind(body.product_id)
    .first<{ id: number; stock: number }>()
  if (!product) return c.json({ error: 'Product not found' }, 404)
  if (product.stock <= 0) return c.json({ error: 'Out of stock' }, 400)

  const cartId = await resolveCartId(c)
  await addToCart(c.env.DB, cartId, body.product_id, Math.max(1, body.quantity ?? 1))
  const items = await getCartItems(c.env.DB, cartId)
  return c.json({ success: true, count: items.reduce((s, i) => s + i.quantity, 0) })
})

cartApi.put('/items/:productId', async (c) => {
  const productId = Number(c.req.param('productId'))
  const body = await c.req.json<{ quantity: number }>().catch(() => null)
  if (body?.quantity === undefined) return c.json({ error: 'quantity required' }, 400)

  const cartId = await resolveCartId(c)
  await updateCartItemQuantity(c.env.DB, cartId, productId, body.quantity)
  const items = await getCartItems(c.env.DB, cartId)
  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  return c.json({ items, subtotal_kobo: subtotal, count: items.reduce((s, i) => s + i.quantity, 0) })
})

cartApi.delete('/items/:productId', async (c) => {
  const productId = Number(c.req.param('productId'))
  const cartId = await resolveCartId(c)
  await removeFromCart(c.env.DB, cartId, productId)
  const items = await getCartItems(c.env.DB, cartId)
  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  return c.json({ items, subtotal_kobo: subtotal, count: items.reduce((s, i) => s + i.quantity, 0) })
})
