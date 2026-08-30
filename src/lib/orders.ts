import type { CartItemRow } from '../types'
import { debitWallet, InsufficientFundsError } from './wallet'
import { validateCoupon, incrementCouponUsage } from './coupons'

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
}

/** Pays for an order directly from the user's NaijaDeals wallet. Throws InsufficientFundsError if short. */
export async function payOrderFromWallet(db: D1Database, orderId: number, userId: number, totalKobo: number) {
  await debitWallet(db, userId, totalKobo, 'order_payment', String(orderId), `Payment for order`)
  await confirmOrderPayment(db, orderId, 'wallet', `wallet-${orderId}-${Date.now()}`)
}

export { InsufficientFundsError }
