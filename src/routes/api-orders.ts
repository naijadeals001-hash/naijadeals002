import { Hono } from 'hono'
import type { AppEnv, OrderRow } from '../types'
import { requireAuth } from '../lib/auth'
import { getOrCreateCartId, getCartItems, clearCart } from '../lib/cart'
import { createPendingOrder, payOrderFromWallet, InsufficientFundsError } from '../lib/orders'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../lib/paystack'
import { confirmOrderPayment } from '../lib/orders'

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

/** Creates a pending order from the user's current cart + shipping details. Payment happens next. */
ordersApi.post('/checkout', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{
    name: string; phone: string; address: string; city: string; state: string
    payment_method: 'wallet' | 'paystack'
  }>().catch(() => null)

  if (!body?.name || !body?.phone || !body?.address || !body?.city || !body?.state) {
    return c.json({ error: 'Complete shipping details are required' }, 400)
  }

  const cartId = await getOrCreateCartId(c.env.DB, user.id, null)
  const items = await getCartItems(c.env.DB, cartId)
  if (items.length === 0) return c.json({ error: 'Your cart is empty' }, 400)

  // Guard against stock changes between add-to-cart and checkout
  for (const item of items) {
    if (item.quantity > item.stock) {
      return c.json({ error: `Only ${item.stock} unit(s) of "${item.title}" left in stock` }, 400)
    }
  }

  const { orderId, orderNumber, totalKobo } = await createPendingOrder(c.env.DB, user.id, items, {
    name: body.name,
    phone: body.phone,
    address: body.address,
    city: body.city,
    state: body.state
  })

  if (body.payment_method === 'wallet') {
    try {
      await payOrderFromWallet(c.env.DB, orderId, user.id, totalKobo)
      await clearCart(c.env.DB, cartId)
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

  const user = c.get('user')!
  const cartId = await getOrCreateCartId(c.env.DB, user.id, null)
  await clearCart(c.env.DB, cartId)

  return c.json({ success: true })
})
