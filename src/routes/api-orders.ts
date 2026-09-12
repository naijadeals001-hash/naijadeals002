import { Hono } from 'hono'
import type { AppEnv, OrderRow, CartItemRow } from '../types'
import { requireAuth } from '../lib/auth'
import { getOrCreateCartId, getCartItems, removeCartItemsByListingIds, getBuyNowItem } from '../lib/cart'
import { getAddress } from '../lib/addresses'
import { createPendingOrder, payOrderFromWallet, InsufficientFundsError, type DeliveryMethod } from '../lib/orders'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../lib/paystack'
import { confirmOrderPayment, cancelOrder, OrderCancellationError } from '../lib/orders'

export const ordersApi = new Hono<AppEnv & { Bindings: AppEnv['Bindings'] & { PAYSTACK_SECRET_KEY?: string } }>()

ordersApi.use('*', requireAuth)

ordersApi.get('/', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC')
    .bind(user.id)
    .all<OrderRow>()
  return c.json(results)
})

ordersApi.get('/:orderNumber', async (c) => {
  const user = c.get('user')!
  const orderNumber = c.req.param('orderNumber')
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE order_number = ? AND user_id = ?')
    .bind(orderNumber, user.id)
    .first<OrderRow>()
  if (!order) return c.json({ error: 'Order not found' }, 404)

  const items = await c.env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(order.id).all()
  return c.json({ order, items: items.results })
})

/**
 * Marketplace Engine 2.0 (spec sections 18, 35, 42): customer-initiated
 * order cancellation. Ownership is enforced inside cancelOrder() itself via
 * `WHERE id = ? AND user_id = ?` — a customer can never cancel another
 * user's order by guessing/enumerating order ids.
 */
ordersApi.post('/:orderNumber/cancel', async (c) => {
  const user = c.get('user')!
  const orderNumber = c.req.param('orderNumber')
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as any)

  const order = await c.env.DB.prepare('SELECT id FROM orders WHERE order_number = ? AND user_id = ?')
    .bind(orderNumber, user.id)
    .first<{ id: number }>()
  if (!order) return c.json({ error: 'Order not found' }, 404)

  try {
    await cancelOrder(c.env.DB, user.id, order.id, body?.reason ?? 'Cancelled by customer')
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof OrderCancellationError) return c.json({ error: err.message }, 400)
    throw err
  }
})

/**
 * Creates a pending order + shipping details. Payment happens next.
 *
 * Two mutually exclusive item sources:
 *  - `buy_now`: a single listing resolved fresh from product_listings, completely bypassing the
 *    persisted cart. This is how the "Buy Now" PDP button checks out — it never touches cart_items,
 *    so an abandoned Buy Now attempt can never leave a stray item sitting in the customer's real cart.
 *  - otherwise: the user's current persistent cart (the normal multi-item, possibly multi-seller flow).
 *
 * Shipping address may be supplied either as `address_id` (a saved address — re-validated to belong
 * to this user) or as raw shipping fields for a one-off address.
 */
ordersApi.post('/checkout', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{
    address_id?: number
    name?: string; phone?: string; address?: string; city?: string; state?: string
    delivery_method?: DeliveryMethod
    coupon_code?: string
    payment_method: 'wallet' | 'paystack'
    buy_now?: { listing_id: number; quantity: number; variant_id?: number | null }
  }>().catch(() => null)

  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  // ---------- Resolve shipping details ----------
  let shipping: { name: string; phone: string; address: string; city: string; state: string }
  if (body.address_id) {
    const saved = await getAddress(c.env.DB, user.id, body.address_id)
    if (!saved) return c.json({ error: 'Selected address not found' }, 404)
    shipping = { name: saved.recipient_name, phone: saved.phone, address: saved.line1, city: saved.city, state: saved.state }
  } else if (body.name && body.phone && body.address && body.city && body.state) {
    shipping = { name: body.name, phone: body.phone, address: body.address, city: body.city, state: body.state }
  } else {
    return c.json({ error: 'A delivery address is required — select a saved address or enter shipping details' }, 400)
  }

  const deliveryMethod: DeliveryMethod = body.delivery_method === 'express' ? 'express' : 'standard'

  // ---------- Resolve items ----------
  let items: CartItemRow[]
  let cartId: number | null = null

  if (body.buy_now) {
    const item = await getBuyNowItem(
      c.env.DB,
      Number(body.buy_now.listing_id),
      Math.max(1, Number(body.buy_now.quantity) || 1),
      body.buy_now.variant_id ?? null
    )
    if (!item) return c.json({ error: 'This listing is no longer available' }, 404)
    if (item.quantity > item.stock) {
      return c.json({ error: `Only ${item.stock} unit(s) of "${item.title}" left in stock` }, 400)
    }
    items = [item]
  } else {
    cartId = await getOrCreateCartId(c.env.DB, user.id, null)
    items = await getCartItems(c.env.DB, cartId)
    if (items.length === 0) return c.json({ error: 'Your cart is empty' }, 400)

    // Guard against stock changes between add-to-cart and checkout
    for (const item of items) {
      if (item.quantity > item.stock) {
        return c.json({ error: `Only ${item.stock} unit(s) of "${item.title}" left in stock` }, 400)
      }
    }
  }

  const { orderId, orderNumber, totalKobo } = await createPendingOrder(
    c.env.DB,
    user.id,
    items,
    shipping,
    deliveryMethod,
    body.coupon_code ?? null
  )

  if (body.payment_method === 'wallet') {
    try {
      await payOrderFromWallet(c.env.DB, orderId, user.id, totalKobo)
      // Only remove the listings that were actually just paid for — never a blanket cart wipe.
      // (No-op when this was a Buy Now checkout, since that path never touched cart_items.)
      if (cartId) await removeCartItemsByListingIds(c.env.DB, cartId, items.map((i) => i.listing_id))
      return c.json({ success: true, orderNumber, paid: true })
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        return c.json({ success: true, orderNumber, paid: false, error: 'insufficient_wallet_balance' }, 200)
      }
      throw err
    }
  }

  // Paystack flow: initialize transaction, return checkout URL. Cart is cleared only once
  // payment is verified (via webhook or verify-callback route), never here.
  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return c.json({ error: 'Card payments are not configured yet. Please pay from your wallet.' }, 503)
  }

  const reference = `ND-PAY-${orderId}-${Date.now()}`
  await c.env.DB.prepare(
    'INSERT INTO payment_transactions (order_id, user_id, provider, provider_reference, amount_kobo, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(orderId, user.id, 'paystack', reference, totalKobo, 'initiated').run()

  const origin = new URL(c.req.url).origin
  const init = await initializePaystackTransaction(secretKey, {
    email: user.email ?? `${user.phone}@naijadeals.com`,
    amountKobo: totalKobo,
    reference,
    callbackUrl: `${origin}/checkout/callback?order=${orderNumber}`
  })

  return c.json({ success: true, orderNumber, paid: false, authorization_url: init.authorization_url })
})

/** Called when the customer returns from Paystack's checkout page. Verifies server-side before trusting it. */
ordersApi.post('/verify-payment', async (c) => {
  const body = await c.req.json<{ reference: string }>().catch(() => null)
  if (!body?.reference) return c.json({ error: 'reference required' }, 400)

  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return c.json({ error: 'Payments not configured' }, 503)

  const tx = await c.env.DB.prepare('SELECT * FROM payment_transactions WHERE provider_reference = ?')
    .bind(body.reference)
    .first<any>()
  if (!tx) return c.json({ error: 'Transaction not found' }, 404)

  const verified = await verifyPaystackTransaction(secretKey, body.reference)
  if (verified.status !== 'success') {
    return c.json({ success: false, status: verified.status })
  }

  await c.env.DB.prepare("UPDATE payment_transactions SET status = 'success', raw_payload = ? WHERE id = ?")
    .bind(JSON.stringify(verified), tx.id)
    .run()

  await confirmOrderPayment(c.env.DB, tx.order_id, 'paystack', body.reference)

  // Remove only the specific listings that were part of THIS order from the buyer's persisted
  // cart — never a blanket clear, so a Buy Now-via-Paystack purchase can't wipe out unrelated
  // items still sitting in the customer's real cart.
  const user = c.get('user')!
  const { results: paidItems } = await c.env.DB
    .prepare('SELECT listing_id FROM order_items WHERE order_id = ?')
    .bind(tx.order_id)
    .all<{ listing_id: number }>()
  const cartId = await getOrCreateCartId(c.env.DB, user.id, null)
  await removeCartItemsByListingIds(c.env.DB, cartId, paidItems.map((i) => i.listing_id))

  return c.json({ success: true })
})
