import type { CartItemRow } from '../types'
import { debitWallet, InsufficientFundsError } from './wallet'

export interface ShippingDetails {
  name: string
  phone: string
  address: string
  city: string
  state: string
}

function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `ND-${ts}-${rand}`
}

const FLAT_DELIVERY_FEE_KOBO = 150000 // ₦1,500 flat fee for MVP; per-vendor/distance rules come later

/**
 * Creates an order + order_items from the given cart items, at status 'pending_payment'.
 * Does NOT touch payment or stock — that happens in confirmOrderPayment() once payment
 * is verified, so an abandoned unpaid order never locks up inventory.
 */
export async function createPendingOrder(
  db: D1Database,
  userId: number,
  items: CartItemRow[],
  shipping: ShippingDetails
): Promise<{ orderId: number; orderNumber: string; totalKobo: number }> {
  if (items.length === 0) throw new Error('Cart is empty')

  const subtotal = items.reduce((sum, item) => sum + item.price_kobo * item.quantity, 0)
  const total = subtotal + FLAT_DELIVERY_FEE_KOBO
  const orderNumber = generateOrderNumber()

  const orderInsert = await db
    .prepare(
      `INSERT INTO orders (order_number, user_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, total_kobo,
                            shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state)
       VALUES (?, ?, 'pending_payment', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      orderNumber,
      userId,
      subtotal,
      FLAT_DELIVERY_FEE_KOBO,
      total,
      shipping.name,
      shipping.phone,
      shipping.address,
      shipping.city,
      shipping.state
    )
    .run()

  const orderId = orderInsert.meta.last_row_id as number

  // Need vendor_id per product for order_items snapshot
  const productIds = items.map((i) => i.product_id)
  const placeholders = productIds.map(() => '?').join(',')
  const { results: vendorRows } = await db
    .prepare(`SELECT id, vendor_id FROM products WHERE id IN (${placeholders})`)
    .bind(...productIds)
    .all<{ id: number; vendor_id: number }>()
  const vendorByProduct = new Map(vendorRows.map((r) => [r.id, r.vendor_id]))

  const itemInserts = items.map((item) =>
    db
      .prepare(
        `INSERT INTO order_items (order_id, product_id, vendor_id, title_snapshot, image_snapshot, unit_price_kobo, quantity, line_total_kobo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        orderId,
        item.product_id,
        vendorByProduct.get(item.product_id) ?? 0,
        item.title,
        item.image_url,
        item.price_kobo,
        item.quantity,
        item.price_kobo * item.quantity
      )
  )
  await db.batch(itemInserts)

  return { orderId, orderNumber, totalKobo: total }
}

/**
 * Marks an order paid, decrements stock, and puts payment into escrow_held state.
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
    .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
    .bind(orderId)
    .all<{ product_id: number; quantity: number }>()

  const stockUpdates = items.results.map((item) =>
    db
      .prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?')
      .bind(item.quantity, item.product_id)
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
