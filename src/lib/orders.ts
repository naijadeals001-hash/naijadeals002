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

/**
 * Marks an order paid, decrements listing stock, and puts payment into escrow_held state.
 * Called after Paystack webhook verification OR successful wallet debit.
 * Stock decrement happens here (not at order creation) so browsing/pending carts
 * never reserve inventory — only a confirmed payment does.
 */
export async function confirmOrderPayment(
  db: D1Database,
  orderId: number,
  provider: 'paystack' | 'wallet',
  providerReference: string
) {
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<any>()
  if (!order) throw new Error('Order not found')
  if (order.payment_status !== 'unpaid') return // idempotent — already processed

  const items = await db
    .prepare('SELECT listing_id, quantity FROM order_items WHERE order_id = ?')
    .bind(orderId)
    .all<{ listing_id: number; quantity: number }>()

  const stockUpdates = items.results.map((item) =>
    db
      .prepare('UPDATE product_listings SET stock = MAX(0, stock - ?) WHERE id = ?')
      .bind(item.quantity, item.listing_id)
  )

  await db.batch([
    db
      .prepare(
        `UPDATE orders SET status = 'processing', payment_status = 'escrow_held',
                            payment_provider = ?, payment_reference = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(provider, providerReference, orderId),
    ...stockUpdates
  ])

  // Affiliate commission attribution — see src/lib/affiliate.ts's
  // confirmCommissionsForOrderIfAttributed doc comment for why this is a
  // safe no-op for the vast majority of orders (no attribution = zero writes).
  // Deliberately AFTER the batch above so a payment is never blocked/delayed
  // by affiliate bookkeeping, and wrapped so an affiliate-side error can
  // never fail an otherwise-successful payment confirmation.
  try {
    await confirmCommissionsForOrderIfAttributed(db, orderId, order.user_id)
  } catch (err) {
    console.error('Affiliate commission attribution failed for order', orderId, err)
  }

  // Logistics Engine 2.0 (spec section 40): "delivery = operational
  // fulfillment workflow", not just a checkout fee line item. Creates the
  // REAL per-vendor shipment(s) for physical tracking. Deliberately AFTER
  // the batch above and wrapped exactly like the affiliate call above it —
  // a logistics failure must never fail an otherwise-successful payment,
  // and existing checkout behavior (the flat delivery fee already charged)
  // is completely unaffected either way.
  try {
    await createShipmentsForPaidOrder(db, orderId)
  } catch (err) {
    console.error('Fulfillment shipment creation failed for order', orderId, err)
  }
}

/** Pays for an order directly from the user's NaijaDeals wallet. Throws InsufficientFundsError if short. */
export async function payOrderFromWallet(db: D1Database, orderId: number, userId: number, totalKobo: number) {
  await debitWallet(db, userId, totalKobo, 'order_payment', String(orderId), `Payment for order`)
  await confirmOrderPayment(db, orderId, 'wallet', `wallet-${orderId}-${Date.now()}`)
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
