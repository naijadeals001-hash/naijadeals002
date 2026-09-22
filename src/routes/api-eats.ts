/**
 * NaijaEats API — cart mutations + checkout, mounted at /api/eats.
 * Modeled on api-cart.ts (resolveCartId/summarize helper pattern) and
 * api-orders.ts's /checkout route (address resolution, wallet-vs-paystack
 * branching), adapted to eats_carts/eats_orders' single-restaurant shape.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getOrSetGuestToken } from '../lib/guest'
import { getAddress } from '../lib/addresses'
import { requireAuth } from '../lib/auth'
import { getMenuItem } from '../lib/eats'
import {
  getOrCreateEatsCartId,
  getEatsCartItems,
  eatsCartItemLineTotalKobo,
  addToEatsCart,
  updateEatsCartItemQuantity,
  removeFromEatsCart,
  DifferentRestaurantCartError,
  createPendingEatsOrder,
  payEatsOrderFromWallet,
  InsufficientFundsError,
  EatsOrderPaymentError,
  EatsCheckoutError,
  cancelEatsOrder,
  EatsOrderCancellationError,
  type EatsShippingDetails,
} from '../lib/eats-cart'
import type { EatsSelectedOption } from '../types'

export const eatsApi = new Hono<AppEnv>()

async function resolveEatsCartId(c: any): Promise<number> {
  const user = c.get('user')
  const guestToken = user ? null : getOrSetGuestToken(c)
  return getOrCreateEatsCartId(c.env.DB, user?.id ?? null, guestToken)
}

function summarize(items: Awaited<ReturnType<typeof getEatsCartItems>>) {
  const subtotal = items.reduce((sum, i) => sum + eatsCartItemLineTotalKobo(i), 0)
  const count = items.reduce((s, i) => s + i.quantity, 0)
  const restaurant = items[0] ? { id: items[0].restaurant_id, name: items[0].restaurant_name, slug: items[0].restaurant_slug, delivery_fee_kobo: items[0].restaurant_delivery_fee_kobo, min_order_kobo: items[0].restaurant_min_order_kobo } : null
  const meetsMinimum = !restaurant || subtotal >= restaurant.min_order_kobo
  return {
    subtotal_kobo: subtotal,
    count,
    restaurant,
    meets_minimum: meetsMinimum,
    total_kobo: subtotal + (restaurant?.delivery_fee_kobo ?? 0),
  }
}

eatsApi.get('/cart', async (c) => {
  const cartId = await resolveEatsCartId(c)
  const items = await getEatsCartItems(c.env.DB, cartId)
  return c.json({ items, ...summarize(items) })
})

/**
 * Adds a menu item to the cart with its chosen options. Re-validates the
 * item belongs to the claimed restaurant server-side (getMenuItem's own
 * `WHERE ... AND restaurant_id = ?` guard) — never trusts a client-supplied
 * restaurant_id/menu_item_id pairing blindly. On DifferentRestaurantCartError,
 * responds 409 so the frontend can prompt "clear cart and start a new order?"
 * rather than silently mixing two kitchens into one order.
 */
eatsApi.post('/cart/items', async (c) => {
  const body = await c.req
    .json<{ restaurant_id: number; menu_item_id: number; quantity?: number; selected_options?: EatsSelectedOption[]; special_instructions?: string }>()
    .catch(() => null)
  if (!body?.restaurant_id || !body?.menu_item_id) return c.json({ error: 'restaurant_id and menu_item_id are required' }, 400)

  const item = await getMenuItem(c.env.DB, body.restaurant_id, body.menu_item_id)
  if (!item) return c.json({ error: 'This menu item is not available' }, 404)

  const cartId = await resolveEatsCartId(c)
  try {
    await addToEatsCart(
      c.env.DB,
      cartId,
      body.menu_item_id,
      body.restaurant_id,
      Math.max(1, body.quantity ?? 1),
      body.selected_options ?? [],
      body.special_instructions?.trim() || null
    )
  } catch (err) {
    if (err instanceof DifferentRestaurantCartError) return c.json({ error: err.message, code: 'different_restaurant' }, 409)
    throw err
  }

  const items = await getEatsCartItems(c.env.DB, cartId)
  return c.json({ success: true, items, ...summarize(items) })
})

/** Clears the cart entirely — the confirmation action for the "different restaurant" 409 above. */
eatsApi.delete('/cart', async (c) => {
  const cartId = await resolveEatsCartId(c)
  const { clearEatsCart } = await import('../lib/eats-cart')
  await clearEatsCart(c.env.DB, cartId)
  return c.json({ success: true })
})

eatsApi.put('/cart/items/:cartItemId', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const body = await c.req.json<{ quantity: number }>().catch(() => null)
  if (body?.quantity === undefined) return c.json({ error: 'quantity required' }, 400)

  const cartId = await resolveEatsCartId(c)
  await updateEatsCartItemQuantity(c.env.DB, cartId, cartItemId, body.quantity)
  const items = await getEatsCartItems(c.env.DB, cartId)
  return c.json({ items, ...summarize(items) })
})

eatsApi.delete('/cart/items/:cartItemId', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const cartId = await resolveEatsCartId(c)
  await removeFromEatsCart(c.env.DB, cartId, cartItemId)
  const items = await getEatsCartItems(c.env.DB, cartId)
  return c.json({ items, ...summarize(items) })
})

// ---------- Everything below requires a signed-in customer ----------
eatsApi.use('/checkout', requireAuth)
eatsApi.use('/orders/*', requireAuth)

/**
 * Creates the pending eats_order from the customer's current cart, then
 * immediately attempts payment (wallet or Paystack-initiate) — mirrors
 * api-orders.ts's /checkout route exactly, adapted to the single-restaurant
 * shape (no buy_now path, no coupon, no per-vendor delivery split).
 */
eatsApi.post('/checkout', async (c) => {
  const user = c.get('user')!
  const body = await c.req
    .json<{
      address_id?: number
      name?: string; phone?: string; address?: string; city?: string; state?: string
      special_instructions?: string
      payment_method: 'wallet' | 'paystack'
    }>()
    .catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  let shipping: EatsShippingDetails
  if (body.address_id) {
    const saved = await getAddress(c.env.DB, user.id, body.address_id)
    if (!saved) return c.json({ error: 'Selected address not found' }, 404)
    shipping = { name: saved.recipient_name, phone: saved.phone, address: saved.line1, city: saved.city, state: saved.state }
  } else if (body.name && body.phone && body.address && body.city && body.state) {
    shipping = { name: body.name, phone: body.phone, address: body.address, city: body.city, state: body.state }
  } else {
    return c.json({ error: 'A delivery address is required — select a saved address or enter delivery details' }, 400)
  }

  const cartId = await getOrCreateEatsCartId(c.env.DB, user.id, null)
  const items = await getEatsCartItems(c.env.DB, cartId)
  if (items.length === 0) return c.json({ error: 'Your NaijaEats cart is empty' }, 400)

  let orderId: number, orderNumber: string, totalKobo: number
  try {
    const result = await createPendingEatsOrder(c.env.DB, user.id, items, shipping, body.special_instructions?.trim() || null)
    orderId = result.orderId
    orderNumber = result.orderNumber
    totalKobo = result.totalKobo
  } catch (err) {
    if (err instanceof EatsCheckoutError) return c.json({ error: err.message }, 400)
    throw err
  }

  if (body.payment_method === 'wallet') {
    try {
      await payEatsOrderFromWallet(c.env.DB, orderId, user.id, totalKobo)
      const { clearEatsCart } = await import('../lib/eats-cart')
      await clearEatsCart(c.env.DB, cartId)
      return c.json({ success: true, orderNumber, paid: true })
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        return c.json({ success: true, orderNumber, paid: false, error: 'insufficient_wallet_balance' }, 200)
      }
      if (err instanceof EatsOrderPaymentError) {
        return c.json({ success: true, orderNumber, paid: false, error: 'order_already_paid' }, 200)
      }
      throw err
    }
  }

  // Paystack flow: initialize transaction, return checkout URL. Cart is cleared only once
  // payment is verified — reuses the SAME PAYSTACK_SECRET_KEY binding and initializePaystackTransaction
  // helper as the product checkout flow; this is not a second payment integration.
  const secretKey = (c.env as any).PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return c.json({ error: 'Card payments are not configured yet. Please pay from your wallet.' }, 503)
  }
  const { initializePaystackTransaction } = await import('../lib/paystack')
  const reference = `EATS-PAY-${orderId}-${Date.now()}`
  await c.env.DB.prepare(
    'INSERT INTO payment_transactions (order_id, user_id, provider, provider_reference, amount_kobo, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(orderId, user.id, 'paystack', reference, totalKobo, 'initiated').run()

  const origin = new URL(c.req.url).origin
  const init = await initializePaystackTransaction(secretKey, {
    email: user.email ?? `${user.phone}@naijadeals.com`,
    amountKobo: totalKobo,
    reference,
    callbackUrl: `${origin}/eats/orders/${orderNumber}`,
  })

  return c.json({ success: true, orderNumber, paid: false, authorization_url: init.authorization_url })
})

eatsApi.post('/orders/:orderNumber/cancel', async (c) => {
  const user = c.get('user')!
  const orderNumber = c.req.param('orderNumber')
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as any)

  const order = await c.env.DB.prepare('SELECT id FROM eats_orders WHERE order_number = ? AND customer_user_id = ?').bind(orderNumber, user.id).first<{ id: number }>()
  if (!order) return c.json({ error: 'Order not found' }, 404)

  try {
    await cancelEatsOrder(c.env.DB, user.id, order.id, body?.reason ?? 'Cancelled by customer')
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof EatsOrderCancellationError) return c.json({ error: err.message }, 400)
    throw err
  }
})
