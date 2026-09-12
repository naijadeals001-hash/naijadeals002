/**
 * Logistics Engine 2.0 — NaijaShop integration bridge (spec section 40).
 *
 * "Replace the conceptual model 'delivery = checkout fee' with 'delivery =
 * operational fulfillment workflow.' ... Preserve current checkout
 * compatibility."
 *
 * This module does NOT touch src/lib/orders.ts's calculateDeliveryFeeKobo
 * or checkout flow — checkout still charges the existing flat per-vendor
 * fee exactly as before (section 84: never break existing checkout).
 * Instead, AFTER a NaijaShop order is paid, this creates the REAL
 * operational shipment(s) that track the physical fulfillment — one per
 * distinct vendor in the order (section 3's multi-vendor example),
 * additive and non-blocking (mirrors confirmOrderPayment's existing
 * affiliate-commission try/catch pattern exactly: a failure here must
 * never fail an otherwise-successful payment).
 */
import { createFulfillmentShipment, LogisticsShipmentError } from './logistics-shipments'
import { requestDispatch } from './logistics-dispatch'

const DEFAULT_VEHICLE_TYPE_KEY = 'van'

/**
 * Creates one fulfillment shipment PER DISTINCT VENDOR in a paid order,
 * each carrying only that vendor's order_items (never duplicating product
 * records into the shipment — section 66 — only order_item_id references
 * + quantity are snapshotted).
 */
export async function createShipmentsForPaidOrder(db: D1Database, orderId: number): Promise<{ created: number; skipped: number }> {
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<any>()
  if (!order) throw new LogisticsShipmentError('Order not found')

  const items = await db
    .prepare('SELECT * FROM order_items WHERE order_id = ?')
    .bind(orderId)
    .all<{ id: number; vendor_id: number }>()

  const vendorIds = Array.from(new Set(items.results.map((i) => i.vendor_id)))
  const defaultVehicleType = await db.prepare('SELECT id FROM vehicle_types WHERE key = ?').bind(DEFAULT_VEHICLE_TYPE_KEY).first<{ id: number }>()
  if (!defaultVehicleType) return { created: 0, skipped: vendorIds.length } // vehicle_types not seeded — honest no-op, never fabricate an id

  const perVendorFeeKobo = order.delivery_method === 'express' ? 300000 : 150000 // mirrors orders.ts's existing DELIVERY_FEE_PER_SELLER_KOBO exactly — see that file's comment for why

  let created = 0
  let skipped = 0

  for (const vendorId of vendorIds) {
    const vendor = await db.prepare('SELECT business_phone, pickup_address_line1, city, state, country_iso FROM vendors WHERE id = ?').bind(vendorId).first<any>()
    if (!vendor?.pickup_address_line1) {
      // Section 32 "delivery eligibility": if the vendor never set a pickup
      // address, we cannot honestly create a shipment with a fabricated
      // origin. Skip and let the order proceed exactly as it did before
      // this engine existed (checkout is never blocked by this).
      skipped++
      continue
    }

    const vendorItems = items.results.filter((i) => i.vendor_id === vendorId)
    try {
      const { shipmentId } = await createFulfillmentShipment(db, order.user_id, {
        vendorId,
        orderId,
        orderItemIds: vendorItems.map((i) => i.id),
        originCountryIso: vendor.country_iso ?? 'NG',
        destinationCountryIso: 'NG',
        pickup: {
          recipientName: 'Store Pickup',
          phone: vendor.business_phone ?? '',
          line1: vendor.pickup_address_line1,
          city: vendor.city ?? '',
          state: vendor.state ?? '',
          countryIso: vendor.country_iso ?? 'NG',
        },
        destination: {
          recipientName: order.shipping_name,
          phone: order.shipping_phone,
          line1: order.shipping_address,
          city: order.shipping_city,
          state: order.shipping_state,
          countryIso: 'NG',
        },
        vehicleTypeId: defaultVehicleType.id,
        speedTier: order.delivery_method === 'express' ? 'express' : 'standard',
        quotedPriceKobo: perVendorFeeKobo,
        sourceType: 'naijashop',
        fulfillmentCategory: 'product',
      })
      await requestDispatch(db, shipmentId)
      created++
    } catch (err) {
      // Never let one vendor's shipment-creation failure block the others
      // or the already-successful payment — logged, not thrown.
      console.error('Failed to create fulfillment shipment for order', orderId, 'vendor', vendorId, err)
      skipped++
    }
  }

  return { created, skipped }
}
