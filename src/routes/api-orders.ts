import { Hono } from 'hono'
import type { AppEnv, OrderRow, CartItemRow } from '../types'
import { requireAuth } from '../lib/auth'
import { getOrCreateCartId, getCartItems, removeCartItemsByListingIds, getBuyNowItem } from '../lib/cart'
import { getAddress } from '../lib/addresses'
import { createPendingOrder, payOrderFromWallet, InsufficientFundsError, type DeliveryMethod } from '../lib/orders'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../lib/paystack'
import { confirmOrderPayment, cancelOrder, OrderCancellationError } from '../lib/orders'
import { transitionOrderItemStatus, OrderLifecycleError, IllegalTransitionError, NotOwnedOrderItemError, type OrderItemStatus } from '../lib/order-lifecycle'
import { createDispute, getDisputesForOrder, getRefundsForOrder } from '../lib/refunds'
import { getPendingAdditionalCharges, confirmAdditionalChargePayment, SettlementError } from '../lib/order-settlement'

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
 * Marketplace Engine 2.1 (spec sections 3/4): customer-side item
 * transitions (confirm delivery -> 'completed', or raise a dispute).
 * Ownership resolved via the order's OWN user_id (getItemForCustomer
 * inside transitionOrderItemStatus) — never a client-claimed order/item
 * relationship.
 */
ordersApi.patch('/items/:orderItemId/status', async (c) => {
  const user = c.get('user')!
  const orderItemId = Number(c.req.param('orderItemId'))
  const body = await c.req.json<{ status: OrderItemStatus; reason?: string }>().catch(() => null)
  const validTargets: OrderItemStatus[] = ['completed', 'delivered', 'disputed', 'cancelled']
  if (!body?.status || !validTargets.includes(body.status)) {
    return c.json({ error: `status must be one of: ${validTargets.join(', ')}` }, 400)
  }
  try {
    const updated = await transitionOrderItemStatus(c.env.DB, orderItemId, body.status, { userId: user.id, role: 'customer' }, { reason: body.reason })
    return c.json({ success: true, item: updated })
  } catch (err) {
    if (err instanceof NotOwnedOrderItemError) return c.json({ error: err.message }, 404)
    if (err instanceof IllegalTransitionError) return c.json({ error: err.message }, 400)
    if (err instanceof OrderLifecycleError) return c.json({ error: err.message }, 400)
    throw err
  }
})

/** Customer-initiated dispute (spec section 6) — commerce context only, ownership enforced inside createDispute via `WHERE id = ? AND user_id = ?`. */
ordersApi.post('/:orderNumber/disputes', async (c) => {
  const user = c.get('user')!
  const orderNumber = c.req.param('orderNumber')
  const body = await c.req.json<{ order_item_id?: number; against_vendor_id?: number; reason: string; description?: string }>().catch(() => null)
  if (!body?.reason) return c.json({ error: 'reason is required' }, 400)

  const order = await c.env.DB.prepare('SELECT id FROM orders WHERE order_number = ? AND user_id = ?').bind(orderNumber, user.id).first<{ id: number }>()
  if (!order) return c.json({ error: 'Order not found' }, 404)

  const disputeId = await createDispute(c.env.DB, {
    orderId: order.id,
    orderItemId: body.order_item_id ?? null,
    raisedByUserId: user.id,
    againstVendorId: body.against_vendor_id ?? null,
    reason: body.reason,
    description: body.description,
  })
  return c.json({ id: disputeId }, 201)
})

ordersApi.get('/:orderNumber/disputes', async (c) => {
  const user = c.get('user')!
  const orderNumber = c.req.param('orderNumber')
  const order = await c.env.DB.prepare('SELECT id FROM orders WHERE order_number = ? AND user_id = ?').bind(orderNumber, user.id).first<{ id: number }>()
  if (!order) return c.json({ error: 'Order not found' }, 404)
  const results = await getDisputesForOrder(c.env.DB, order.id)
  return c.json({ results })
})

ordersApi.get('/:orderNumber/refunds', async (c) => {
  const user = c.get('user')!
  const orderNumber = c.req.param('orderNumber')
  const order = await c.env.DB.prepare('SELECT id FROM orders WHERE order_number = ? AND user_id = ?').bind(orderNumber, user.id).first<{ id: number }>()
  if (!order) return c.json({ error: 'Order not found' }, 404)
  const results = await getRefundsForOrder(c.env.DB, order.id)
  return c.json({ results })
})

/** Variable-weight additional charges awaiting THIS customer's explicit confirmation (spec section 12 — never auto-debited). */
ordersApi.get('/:orderNumber/additional-charges', async (c) => {
  const user = c.get('user')!
  const orderNumber = c.req.param('orderNumber')
  const order = await c.env.DB.prepare('SELECT id FROM orders WHERE order_number = ? AND user_id = ?').bind(orderNumber, user.id).first<{ id: number }>()
  if (!order) return c.json({ error: 'Order not found' }, 404)
  const results = await getPendingAdditionalCharges(c.env.DB, user.id, order.id)
  return c.json({ results })
})

ordersApi.post('/additional-charges/:chargeId/pay', async (c) => {
  const user = c.get('user')!
  const chargeId = Number(c.req.param('chargeId'))
  try {
    const result = await confirmAdditionalChargePayment(c.env.DB, user.id, chargeId)
    return c.json({ success: true, ...result })
  } catch (err) {
    if (err instanceof SettlementError) return c.json({ error: err.message }, 400)
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

/**
 * Called when the customer returns from Paystack's checkout page. Verifies
 * server-side before trusting it. Like /api/wallet/topup/verify, this route
 * legitimately races the AUTHORITATIVE webhook path (api-webhooks.ts) — the
 * customer's browser and Paystack's webhook delivery can both hit their
 * respective confirmation route for the same reference concurrently.
 *
 * CONCURRENCY HARDENING (Engine 7 Phase 2, Unit 3 — same G-2 class as
 * api-webhooks.ts and api-wallet.ts's /topup/verify): the prior
 * implementation performed an unconditional UPDATE after only reading (not
 * atomically claiming) the transaction row, so this route racing the
 * webhook could call confirmOrderPayment() twice for the same order/charge.
 * confirmOrderPayment() itself already has its own idempotency guard
 * (`if (order.payment_status !== 'unpaid') return`) — deferred as a
 * read-then-branch TOCTOU to Unit 4 (G-3) rather than fixed here, per this
 * unit's explicit "order payment CAS is Unit 4's job" scope boundary — but
 * this route's OWN claim on payment_transactions.status is fixed now,
 * using the identical CAS pattern as the other two Paystack confirmation
 * call sites, so at minimum this route can no longer be the SOURCE of a
 * duplicate confirmOrderPayment() call racing the webhook.
 */
ordersApi.post('/verify-payment', async (c) => {
  const body = await c.req.json<{ reference: string }>().catch(() => null)
  if (!body?.reference) return c.json({ error: 'reference required' }, 400)

  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return c.json({ error: 'Payments not configured' }, 503)

  const tx = await c.env.DB.prepare('SELECT * FROM payment_transactions WHERE provider_reference = ?')
    .bind(body.reference)
    .first<any>()
  if (!tx) return c.json({ error: 'Transaction not found' }, 404)
  if (tx.status === 'success') return c.json({ success: true, already_processed: true })

  const verified = await verifyPaystackTransaction(secretKey, body.reference)
  if (verified.status !== 'success') {
    return c.json({ success: false, status: verified.status })
  }

  // CAS claim (G-2 fix) — only the ONE caller that finds status still
  // 'initiated' proceeds to confirmOrderPayment(). A concurrent webhook
  // delivery for the same reference loses the claim here.
  const claim = await c.env.DB.prepare("UPDATE payment_transactions SET status = 'success', raw_payload = ? WHERE id = ? AND status = 'initiated'")
    .bind(JSON.stringify(verified), tx.id)
    .run()
  if ((claim.meta.rows_written ?? 0) === 0) {
    // Lost the race — the webhook (or a duplicate call to this route)
    // already claimed and confirmed this reference. Never call
    // confirmOrderPayment() a second time for the same charge.
    return c.json({ success: true, already_processed: true })
  }

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
