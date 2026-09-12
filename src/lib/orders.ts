import type { CartItemRow } from '../types'
import { debitWallet, InsufficientFundsError } from './wallet'
import { validateCoupon, incrementCouponUsage } from './coupons'
import { confirmCommissionsForOrderIfAttributed } from './affiliate'
import { createShipmentsForPaidOrder } from './logistics-naijashop-bridge'

export interface ShippingDetails {
  name: string
  phone: string
  address: string
  city: string
  state: string
}

export type DeliveryMethod = 'standard' | 'express'

function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `ND-${ts}-${rand}`
}

// Delivery is charged PER SELLER SHIPMENT (each vendor fulfils and ships their own items
// independently, exactly like Jumia/Amazon marketplace orders) — not one flat fee regardless
// of how many sellers are in the cart. Express roughly doubles the per-shipment fee.
export const DELIVERY_FEE_PER_SELLER_KOBO: Record<DeliveryMethod, number> = {
  standard: 150000, // ₦1,500 per seller shipment, 3-7 business days
  express: 300000   // ₦3,000 per seller shipment, 1-2 business days
}

export function countDistinctVendors(items: CartItemRow[]): number {
  return new Set(items.map((i) => i.vendor_id)).size
}

export function calculateDeliveryFeeKobo(items: CartItemRow[], method: DeliveryMethod): number {
  return countDistinctVendors(items) * DELIVERY_FEE_PER_SELLER_KOBO[method]
}

/**
 * Creates an order + order_items from the given cart items, at status 'pending_payment'.
 * Each order_item snapshots the listing's vendor_id and variant at time of purchase, so seller
 * comparison / price changes after checkout never affect an already-placed order.
 * Does NOT touch payment or stock — that happens in confirmOrderPayment() once payment
 * is verified, so an abandoned unpaid order never locks up inventory.
 */
export async function createPendingOrder(
  db: D1Database,
  userId: number,
  items: CartItemRow[],
  shipping: ShippingDetails,
  deliveryMethod: DeliveryMethod = 'standard',
  couponCode: string | null = null
): Promise<{ orderId: number; orderNumber: string; totalKobo: number; discountKobo: number; deliveryFeeKobo: number }> {
  if (items.length === 0) throw new Error('Cart is empty')

  const subtotal = items.reduce((sum, item) => sum + item.price_kobo * item.quantity, 0)
  const deliveryFee = calculateDeliveryFeeKobo(items, deliveryMethod)

  let discountKobo = 0
  let appliedCouponId: number | null = null
  let appliedCouponCode: string | null = null
  if (couponCode) {
    const validation = await validateCoupon(db, couponCode, subtotal)
    if (validation.valid && validation.coupon) {
      discountKobo = validation.discountKobo ?? 0
      appliedCouponId = validation.coupon.id
      appliedCouponCode = validation.coupon.code
    }
    // If the coupon is no longer valid at the moment of order creation (e.g. someone else just
    // used up the last redemption), we simply proceed without a discount rather than blocking checkout.
  }

  const total = Math.max(0, subtotal + deliveryFee - discountKobo)
  const orderNumber = generateOrderNumber()

  const orderInsert = await db
    .prepare(
      `INSERT INTO orders (order_number, user_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, total_kobo,
                            shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state,
                            delivery_method, coupon_code, discount_kobo)
       VALUES (?, ?, 'pending_payment', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      orderNumber,
      userId,
      subtotal,
      deliveryFee,
      total,
      shipping.name,
      shipping.phone,
      shipping.address,
      shipping.city,
      shipping.state,
      deliveryMethod,
      appliedCouponCode,
      discountKobo
    )
    .run()

  const orderId = orderInsert.meta.last_row_id as number

  const itemInserts = items.map((item) =>
    db
      .prepare(
        `INSERT INTO order_items (order_id, listing_id, product_id, vendor_id, variant_snapshot, title_snapshot, image_snapshot, unit_price_kobo, quantity, line_total_kobo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        orderId,
        item.listing_id,
        item.product_id,
        item.vendor_id,
        item.variant_value ?? null,
        item.title,
        item.image_url,
        item.price_kobo,
        item.quantity,
        item.price_kobo * item.quantity
      )
  )
  await db.batch(itemInserts)

  if (appliedCouponId) {
    await incrementCouponUsage(db, appliedCouponId)
  }

  return { orderId, orderNumber, totalKobo: total, discountKobo, deliveryFeeKobo: deliveryFee }
}

export class OrderPaymentError extends Error {}

/**
 * ATOMIC CLAIM (compare-and-swap) for order payment — the exact enum-CAS
 * pattern proven in payForBooking()/transitionBooking() (Booking
 * Invariant 9) and reused in Unit 3 for payment_transactions.status,
 * applied here to orders.payment_status. `WHERE id = ? AND payment_status
 * = 'unpaid'` re-checks the guard AT WRITE TIME, not at an earlier read
 * time, so only ONE concurrent/duplicate caller for the same orderId can
 * ever win — every other caller gets rows_written = 0 and must treat this
 * as "already processed", never re-running the financial side effect.
 * Returns true iff THIS call won the claim.
 */
async function claimOrderForPayment(
  db: D1Database,
  orderId: number,
  provider: 'paystack' | 'wallet',
  providerReference: string
): Promise<boolean> {
  const claim = await db
    .prepare(
      `UPDATE orders SET status = 'processing', payment_status = 'escrow_held',
                          payment_provider = ?, payment_reference = ?, updated_at = datetime('now')
       WHERE id = ? AND payment_status = 'unpaid'`
    )
    .bind(provider, providerReference, orderId)
    .run()
  return (claim.meta.rows_written ?? 0) > 0
}

/**
 * Runs the payment side effects that must happen exactly once, AFTER the
 * CAS claim above has already been won by the caller — decrements listing
 * stock (so browsing/pending carts never reserve inventory, only a
 * confirmed payment does), then the best-effort affiliate/logistics
 * bookkeeping. Never called by a losing/duplicate claim attempt, so these
 * side effects are structurally guaranteed to run at most once per order,
 * regardless of how many concurrent or retried confirmation attempts occur.
 */
async function runOrderPaymentSideEffects(db: D1Database, orderId: number): Promise<void> {
  const order = await db.prepare('SELECT user_id FROM orders WHERE id = ?').bind(orderId).first<{ user_id: number }>()

  const items = await db
    .prepare('SELECT listing_id, quantity FROM order_items WHERE order_id = ?')
    .bind(orderId)
    .all<{ listing_id: number; quantity: number }>()

  const stockUpdates = items.results.map((item) =>
    db
      .prepare('UPDATE product_listings SET stock = MAX(0, stock - ?) WHERE id = ?')
      .bind(item.quantity, item.listing_id)
  )
  if (stockUpdates.length > 0) await db.batch(stockUpdates)

  // Affiliate commission attribution — see src/lib/affiliate.ts's
  // confirmCommissionsForOrderIfAttributed doc comment for why this is a
  // safe no-op for the vast majority of orders (no attribution = zero writes).
  // Deliberately AFTER the stock batch above so a payment is never
  // blocked/delayed by affiliate bookkeeping, and wrapped so an
  // affiliate-side error can never fail an otherwise-successful payment
  // confirmation.
  try {
    await confirmCommissionsForOrderIfAttributed(db, orderId, order!.user_id)
  } catch (err) {
    console.error('Affiliate commission attribution failed for order', orderId, err)
  }

  // Logistics Engine 2.0 (spec section 40): "delivery = operational
  // fulfillment workflow", not just a checkout fee line item. Creates the
  // REAL per-vendor shipment(s) for physical tracking. Deliberately AFTER
  // the stock batch above and wrapped exactly like the affiliate call
  // above it — a logistics failure must never fail an otherwise-successful
  // payment, and existing checkout behavior (the flat delivery fee already
  // charged) is completely unaffected either way.
  try {
    await createShipmentsForPaidOrder(db, orderId)
  } catch (err) {
    console.error('Fulfillment shipment creation failed for order', orderId, err)
  }

  // Engine 9 event writer — see notifications.ts's module doc comment for
  // the financial-safety rationale (fires strictly AFTER the payment CAS
  // claim already won and this function's own side effects already ran;
  // never able to roll back the payment itself). idempotencyKey is keyed
  // on orderId alone (not a provider reference) because "payment
  // confirmed" is a one-time-per-order business event regardless of which
  // payment path (Paystack webhook vs wallet) or how many concurrent
  // callers raced to get here — only the CAS winner ever reaches this
  // function body per order.
  try {
    const { enqueueAndProcessNow } = await import('./notifications')
    await enqueueAndProcessNow(db, {
      idempotencyKey: `payment_confirmed:${orderId}`,
      eventType: 'payment_confirmed',
      recipientUserId: order!.user_id,
      category: 'payment',
      payload: { order_id: orderId },
      referenceType: 'order',
      referenceId: String(orderId),
    })
  } catch (err) {
    console.error('Notification enqueue failed for order payment', orderId, err)
  }
}

/**
 * Marks an order paid, decrements listing stock, and puts payment into
 * escrow_held state. Called after Paystack webhook verification OR
 * Paystack client-side verify-payment (payOrderFromWallet has its OWN
 * claim — see below — and calls runOrderPaymentSideEffects directly rather
 * than going through this function).
 *
 * CONCURRENCY HARDENING (Engine 7 Phase 2, Unit 4 — G-3, see
 * docs/ENGINE-7-PAYMENT-FINANCE-AUDIT.md §5 and
 * docs/ENGINE-7-PHASE-2-FORENSIC-REVIEW.md §E for the original findings):
 * the prior implementation read `order.payment_status`, branched on it
 * (`if (order.payment_status !== 'unpaid') return`), then performed an
 * UNCONDITIONAL UPDATE — the same TOCTOU class fixed for
 * payment_transactions.status in Unit 3. This function is called from
 * BOTH api-webhooks.ts's Paystack webhook AND api-orders.ts's
 * /verify-payment — both of which already have their OWN CAS claim on
 * payment_transactions.status (Unit 3), which makes a genuinely concurrent
 * double-call into THIS function for the same orderId very unlikely in
 * practice (both callers' own claim already ensures only one of them
 * proceeds this far per underlying charge) — but relying on an UPSTREAM
 * caller's CAS to protect a DOWNSTREAM function's own state mutation is
 * exactly the kind of implicit, easily-broken-by-a-future-caller assumption
 * this hardening pass exists to eliminate. This function now claims
 * orders.payment_status ATOMICALLY itself via claimOrderForPayment(),
 * making it safe to call from any current or future caller without
 * depending on that caller's own idempotency guard.
 */
export async function confirmOrderPayment(
  db: D1Database,
  orderId: number,
  provider: 'paystack' | 'wallet',
  providerReference: string
) {
  const order = await db.prepare('SELECT id FROM orders WHERE id = ?').bind(orderId).first<{ id: number }>()
  if (!order) throw new Error('Order not found')

  const won = await claimOrderForPayment(db, orderId, provider, providerReference)
  if (!won) return // idempotent — already processed (or lost a concurrent race) — never re-run stock/affiliate/logistics side effects

  await runOrderPaymentSideEffects(db, orderId)
}

/**
 * Pays for an order directly from the user's NaijaDeals wallet.
 * Throws InsufficientFundsError if short, OrderPaymentError if the order
 * is not found/not owned/already paid.
 *
 * CONCURRENCY HARDENING (Engine 7 Phase 2, Unit 4 — G-3, ordering fix):
 * the prior implementation called debitWallet() FIRST, then
 * confirmOrderPayment() second — the REVERSE of Booking's proven
 * claim-before-debit ordering (payForBooking() in booking-payments.ts).
 * This was flagged explicitly in Unit 1's forensic review as a real risk
 * rather than blindly copied/inverted: if this function were EVER called
 * twice concurrently for the SAME orderId (not reachable today — the only
 * call site in api-orders.ts's /checkout route calls it exactly once,
 * immediately after createPendingOrder() creates a brand-new order in the
 * SAME request, so there is currently no legitimate path that re-invokes
 * it for an existing orderId — but a future retry/idempotency-key feature,
 * a bug, or a new caller could change that), debitWallet() has NO
 * awareness of "orders" at all — it would happily succeed on BOTH
 * concurrent calls (as long as the balance covered both), and only
 * AFTERWARDS would confirmOrderPayment()'s (now-atomic, but still only
 * ONE-winner) claim reject the second call. Result: the customer would be
 * charged TWICE for an order that only ever gets marked paid ONCE — money
 * taken with no matching order state, and no automatic path to return it.
 *
 * THE FIX inverts the ordering to genuinely mirror payForBooking()'s
 * pattern (adapted, not copy-pasted: orders don't have a separate
 * "escrow-held-but-not-yet-finalized" state distinct from their final
 * paid state the way this function needs it, so the SAME
 * claimOrderForPayment() used by confirmOrderPayment() is reused here
 * directly rather than re-deriving a parallel claim shape): claim the
 * order FIRST via the identical CAS UPDATE, and only debit the wallet if
 * that claim actually won. If the wallet debit then fails (insufficient
 * funds), the claim is explicitly rolled back to 'unpaid'/'pending_payment'
 * so the order is never stuck in a claimed-but-unpaid limbo and the
 * customer can legitimately retry after topping up — exactly
 * payForBooking()'s own rollback guarantee, applied to orders' actual
 * status/payment_status pair instead of booking's single payment_status
 * field.
 */
export async function payOrderFromWallet(db: D1Database, orderId: number, userId: number, totalKobo: number) {
  const order = await db.prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?').bind(orderId, userId).first<{ id: number }>()
  if (!order) throw new OrderPaymentError('Order not found or not owned by this customer')

  const paymentReference = `WALLET-${orderId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  // ATOMIC CLAIM FIRST (claim-before-debit, mirroring payForBooking()) —
  // only ONE concurrent/duplicate caller for this orderId can ever win.
  const won = await claimOrderForPayment(db, orderId, 'wallet', paymentReference)
  if (!won) throw new OrderPaymentError('This order has already been paid')

  try {
    await debitWallet(db, userId, totalKobo, 'order_payment', String(orderId), `Payment for order`)
  } catch (err) {
    // Roll back the claim so the order isn't left stuck in
    // 'escrow_held'/'processing' with no actual money ever having moved —
    // mirrors payForBooking()'s exact rollback guarantee. Guarded by both
    // orderId AND this attempt's own unique payment_reference so a rollback
    // can never clobber a DIFFERENT successful claim (impossible here since
    // paymentReference is unique per call, but guarded anyway per the
    // established convention).
    await db
      .prepare(
        `UPDATE orders SET status = 'pending_payment', payment_status = 'unpaid', payment_provider = NULL, payment_reference = NULL
         WHERE id = ? AND payment_status = 'escrow_held' AND payment_reference = ?`
      )
      .bind(orderId, paymentReference)
      .run()
    throw err
  }

  await runOrderPaymentSideEffects(db, orderId)
}

export class OrderCancellationError extends Error {}

/**
 * Marketplace Engine 2.0 (spec sections 18, 42): customer-initiated order
 * cancellation. Ownership-scoped by `userId` (the WHERE clause below —
 * never trust an order_id alone without also matching user_id, which is
 * what prevents a customer from cancelling someone else's order). Only
 * permitted while the order hasn't progressed past 'processing' (i.e. not
 * yet shipped) — once a seller has shipped, cancellation must go through a
 * return/dispute flow instead (a documented remaining gap, not built here).
 *
 * If the order was already paid, restores the reserved stock via the
 * append-only inventory_adjustments ledger (reason='order_cancelled') so
 * a cancelled order doesn't permanently lock up a seller's inventory.
 */
export async function cancelOrder(db: D1Database, userId: number, orderId: number, reason: string): Promise<void> {
  const order = await db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(orderId, userId).first<any>()
  if (!order) throw new OrderCancellationError('Order not found')
  if (!['pending_payment', 'processing'].includes(order.status)) {
    throw new OrderCancellationError(`Order in status "${order.status}" can no longer be cancelled`)
  }

  const wasPaid = order.payment_status !== 'unpaid'

  const items = await db
    .prepare('SELECT listing_id, quantity FROM order_items WHERE order_id = ?')
    .bind(orderId)
    .all<{ listing_id: number; quantity: number }>()

  const statements = [
    db
      .prepare(
        `UPDATE orders SET status = 'cancelled', cancelled_at = datetime('now'), cancellation_reason = ?, cancelled_by_user_id = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(reason, userId, orderId),
    db.prepare(`UPDATE order_items SET item_status = 'cancelled' WHERE order_id = ?`).bind(orderId),
  ]

  if (wasPaid) {
    for (const item of items.results) {
      statements.push(
        db.prepare('UPDATE product_listings SET stock = stock + ? WHERE id = ?').bind(item.quantity, item.listing_id),
        db
          .prepare(
            `INSERT INTO inventory_adjustments (listing_id, delta, reason, order_id, actor_user_id, stock_after)
             SELECT ?, ?, 'order_cancelled', ?, ?, stock FROM product_listings WHERE id = ?`
          )
          .bind(item.listing_id, item.quantity, orderId, userId, item.listing_id)
      )
    }
  }

  await db.batch(statements)
}

export { InsufficientFundsError }
