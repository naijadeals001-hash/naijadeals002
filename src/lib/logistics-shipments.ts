/**
 * Logistics Engine 2.0 — Fulfillment abstraction & Shipment lifecycle
 * (spec sections 3-5, 40).
 *
 * ORDER vs SHIPMENT (section 3): one commerce order != one delivery. A
 * multi-vendor NaijaShop order produces ONE SHIPMENT PER VENDOR (mirrors
 * the existing shipments.order_id + vendor_id unique-per-shipment_type
 * index from migration 0019 exactly — this module is the first real
 * writer of that already-correct schema). NaijaSend can create a shipment
 * with no order at all (shipment_type='standalone').
 *
 * OWNERSHIP (mirrors booking-holds.ts/bookings.ts's resolution discipline):
 * shipments are always looked up scoped by customer_user_id (customer) or
 * vendor_id/organization membership (merchant) — never by a bare shipment
 * id trusted from the client.
 */
import type { ShipmentRow, ShipmentStatus, LogisticsSourceVertical, FulfillmentCategory } from '../types'
import { logShipmentEvent } from './logistics-tracking'

export class LogisticsShipmentError extends Error {}
export class NotOwnedShipmentError extends LogisticsShipmentError {
  constructor() {
    super('Shipment not found or not accessible to this actor')
  }
}

function generateTrackingNumber(): string {
  // Section 26: unique, non-guessable where appropriate, customer-safe,
  // searchable. Never expose the raw internal integer id as the public
  // identifier (section 26 explicit prohibition) — this uses a
  // timestamp+random token instead, resolved server-side to the real id.
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Array.from({ length: 6 }, () => Math.floor(Math.random() * 36).toString(36)).join('').toUpperCase()
  return `NDX-${ts}-${rand}`
}

export interface CreateStandaloneShipmentInput {
  originCountryIso: string
  destinationCountryIso: string
  originZoneKey?: string | null
  destinationZoneKey?: string | null
  vehicleTypeId: number
  speedTier: string
  fulfillmentCategory?: FulfillmentCategory
  declaredWeightKg: number
  packageCount?: number
  declaredValueKobo?: number | null
  isFragile?: boolean
  isTemperatureSensitive?: boolean
  parcelDescription?: string | null
  specialHandlingNotes?: string | null
  quotedPriceKobo: number
  currency?: string
  rateCardId?: number | null
  logisticsQuoteId?: number | null
  pickup: { recipientName: string; phone: string; line1: string; city: string; state: string; countryIso: string; deliveryInstructions?: string | null }
  dropoff: { recipientName: string; phone: string; line1: string; city: string; state: string; countryIso: string; deliveryInstructions?: string | null }
}

/**
 * NaijaSend standalone shipment creation (section 46) — no order_id, the
 * customer directly enters pickup/dropoff. This is the canonical "primary
 * consumer" path the spec calls out; every vertical integration
 * (NaijaShop/Eats/Fresh/etc, below) is a variant that supplies order_id/
 * vendor_id/source_type instead of leaving them null.
 */
export async function createStandaloneShipment(
  db: D1Database,
  customerUserId: number,
  input: CreateStandaloneShipmentInput
): Promise<{ shipmentId: number; trackingNumber: string }> {
  const trackingNumber = generateTrackingNumber()

  const result = await db
    .prepare(
      `INSERT INTO shipments
        (tracking_number, shipment_type, fulfillment_category, customer_user_id, order_id, vendor_id, rate_card_id, logistics_quote_id,
         vehicle_type_id, speed_tier, origin_country_iso, destination_country_iso, origin_zone_key, destination_zone_key,
         declared_weight_kg, package_count, declared_value_kobo, is_fragile, is_temperature_sensitive,
         special_handling_notes, parcel_description, quoted_price_kobo, currency, status, source_type)
       VALUES (?, 'standalone', ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', 'naijasend')`
    )
    .bind(
      trackingNumber,
      input.fulfillmentCategory ?? 'parcel',
      customerUserId,
      input.rateCardId ?? null,
      input.logisticsQuoteId ?? null,
      input.vehicleTypeId,
      input.speedTier,
      input.originCountryIso,
      input.destinationCountryIso,
      input.originZoneKey ?? null,
      input.destinationZoneKey ?? null,
      input.declaredWeightKg,
      input.packageCount ?? 1,
      input.declaredValueKobo ?? null,
      input.isFragile ? 1 : 0,
      input.isTemperatureSensitive ? 1 : 0,
      input.specialHandlingNotes ?? null,
      input.parcelDescription ?? null,
      input.quotedPriceKobo,
      input.currency ?? 'NGN'
    )
    .run()

  const shipmentId = Number(result.meta.last_row_id)

  await db.batch([
    db
      .prepare(`INSERT INTO shipment_addresses (shipment_id, address_role, recipient_name, phone, line1, city, state, country_iso, delivery_instructions) VALUES (?, 'pickup', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(shipmentId, input.pickup.recipientName, input.pickup.phone, input.pickup.line1, input.pickup.city, input.pickup.state, input.pickup.countryIso, input.pickup.deliveryInstructions ?? null),
    db
      .prepare(`INSERT INTO shipment_addresses (shipment_id, address_role, recipient_name, phone, line1, city, state, country_iso, delivery_instructions) VALUES (?, 'dropoff', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(shipmentId, input.dropoff.recipientName, input.dropoff.phone, input.dropoff.line1, input.dropoff.city, input.dropoff.state, input.dropoff.countryIso, input.dropoff.deliveryInstructions ?? null),
  ])

  if (input.logisticsQuoteId) {
    await db.prepare(`UPDATE logistics_quotes SET status = 'converted', converted_shipment_id = ? WHERE id = ?`).bind(shipmentId, input.logisticsQuoteId).run()
  }

  await logShipmentEvent(db, shipmentId, 'created', null, 'system', 'Shipment created')

  return { shipmentId, trackingNumber }
}

export interface VendorFulfillmentInput {
  vendorId: number
  orderId: number
  orderItemIds: number[]
  originCountryIso: string
  destinationCountryIso: string
  destination: { recipientName: string; phone: string; line1: string; city: string; state: string; countryIso: string; deliveryInstructions?: string | null }
  pickup: { recipientName: string; phone: string; line1: string; city: string; state: string; countryIso: string }
  vehicleTypeId: number
  speedTier: string
  quotedPriceKobo: number
  sourceType: LogisticsSourceVertical
  fulfillmentCategory?: FulfillmentCategory
}

/**
 * NaijaShop/Fresh/Eats/Farm/Auto/Health integration (sections 40-45): order
 * -> fulfillment -> shipment(s). ONE call per vendor/fulfillment-unit — a
 * multi-vendor order calls this once per distinct vendor, producing N
 * shipments (section 3's exact example). The UNIQUE(order_id, vendor_id)
 * WHERE shipment_type='marketplace_order' index (migration 0019) makes a
 * duplicate shipment for the same vendor+order structurally impossible —
 * enforced by the DB, not just application-level care.
 */
export async function createFulfillmentShipment(
  db: D1Database,
  customerUserId: number,
  input: VendorFulfillmentInput
): Promise<{ shipmentId: number; trackingNumber: string }> {
  const existing = await db
    .prepare(`SELECT id FROM shipments WHERE order_id = ? AND vendor_id = ? AND shipment_type = 'marketplace_order'`)
    .bind(input.orderId, input.vendorId)
    .first<{ id: number }>()
  if (existing) throw new LogisticsShipmentError('A shipment for this vendor/order already exists')

  const trackingNumber = generateTrackingNumber()

  const result = await db
    .prepare(
      `INSERT INTO shipments
        (tracking_number, shipment_type, fulfillment_category, customer_user_id, order_id, vendor_id,
         vehicle_type_id, speed_tier, origin_country_iso, destination_country_iso,
         declared_weight_kg, package_count, quoted_price_kobo, currency, status, source_type)
       VALUES (?, 'marketplace_order', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'NGN', 'created', ?)`
    )
    .bind(
      trackingNumber,
      input.fulfillmentCategory ?? 'product',
      customerUserId,
      input.orderId,
      input.vendorId,
      input.vehicleTypeId,
      input.speedTier,
      input.originCountryIso,
      input.destinationCountryIso,
      input.orderItemIds.length,
      input.quotedPriceKobo,
      input.sourceType
    )
    .run()

  const shipmentId = Number(result.meta.last_row_id)

  const statements = [
    db
      .prepare(`INSERT INTO shipment_addresses (shipment_id, address_role, recipient_name, phone, line1, city, state, country_iso, delivery_instructions) VALUES (?, 'pickup', ?, ?, ?, ?, ?, ?, NULL)`)
      .bind(shipmentId, input.pickup.recipientName, input.pickup.phone, input.pickup.line1, input.pickup.city, input.pickup.state, input.pickup.countryIso),
    db
      .prepare(`INSERT INTO shipment_addresses (shipment_id, address_role, recipient_name, phone, line1, city, state, country_iso, delivery_instructions) VALUES (?, 'dropoff', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(shipmentId, input.destination.recipientName, input.destination.phone, input.destination.line1, input.destination.city, input.destination.state, input.destination.countryIso, input.destination.deliveryInstructions ?? null),
    ...input.orderItemIds.map((itemId) =>
      db.prepare(`INSERT INTO shipment_items (shipment_id, order_item_id, quantity) VALUES (?, ?, 1)`).bind(shipmentId, itemId)
    ),
  ]
  await db.batch(statements)

  await logShipmentEvent(db, shipmentId, 'created', null, 'system', `Fulfillment shipment created for ${input.sourceType} order #${input.orderId}`)

  return { shipmentId, trackingNumber }
}

/** Customer-scoped lookup — NEVER trust a bare shipment id without this WHERE clause. */
export async function getShipmentForCustomer(db: D1Database, customerUserId: number, shipmentId: number): Promise<ShipmentRow | null> {
  const row = await db.prepare('SELECT * FROM shipments WHERE id = ? AND customer_user_id = ?').bind(shipmentId, customerUserId).first<ShipmentRow>()
  return row ?? null
}

/** Public, tracking-number-scoped lookup — the "customer-safe" identifier from section 26. No auth required, but reveals only tracking-relevant fields (see api-logistics.ts's response shaping). */
export async function getShipmentByTrackingNumber(db: D1Database, trackingNumber: string): Promise<ShipmentRow | null> {
  const row = await db.prepare('SELECT * FROM shipments WHERE tracking_number = ?').bind(trackingNumber).first<ShipmentRow>()
  return row ?? null
}

/** Vendor-scoped lookup for merchant dashboards (section 49). */
export async function getShipmentForVendor(db: D1Database, vendorId: number, shipmentId: number): Promise<ShipmentRow | null> {
  const row = await db.prepare('SELECT * FROM shipments WHERE id = ? AND vendor_id = ?').bind(shipmentId, vendorId).first<ShipmentRow>()
  return row ?? null
}

export async function getShipmentsForCustomer(db: D1Database, customerUserId: number, limit = 50): Promise<ShipmentRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM shipments WHERE customer_user_id = ? ORDER BY id DESC LIMIT ?')
    .bind(customerUserId, limit)
    .all<ShipmentRow>()
  return results
}

export async function getShipmentsForVendor(db: D1Database, vendorId: number, limit = 100): Promise<ShipmentRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM shipments WHERE vendor_id = ? ORDER BY id DESC LIMIT ?')
    .bind(vendorId, limit)
    .all<ShipmentRow>()
  return results
}

export async function getAddressesForShipment(db: D1Database, shipmentId: number) {
  const { results } = await db.prepare('SELECT * FROM shipment_addresses WHERE shipment_id = ?').bind(shipmentId).all<any>()
  return results
}

export async function getItemsForShipment(db: D1Database, shipmentId: number) {
  const { results } = await db.prepare('SELECT * FROM shipment_items WHERE shipment_id = ?').bind(shipmentId).all<any>()
  return results
}

/**
 * Creates a RETURN shipment linked back to the original delivery (section
 * 38). Logistics handles only the PHYSICAL movement — the commercial
 * return decision (refund eligibility etc) stays in Marketplace's own
 * order-lifecycle/refunds modules, never re-implemented here.
 */
export async function createReturnShipment(db: D1Database, customerUserId: number, originalShipmentId: number): Promise<{ shipmentId: number; trackingNumber: string }> {
  const original = await getShipmentForCustomer(db, customerUserId, originalShipmentId)
  if (!original) throw new NotOwnedShipmentError()
  if (original.status !== 'delivered') throw new LogisticsShipmentError('Only a delivered shipment can be returned')

  const addresses = await getAddressesForShipment(db, originalShipmentId)
  const pickup = addresses.find((a: any) => a.address_role === 'dropoff') // return picks up from where it was delivered
  const dropoff = addresses.find((a: any) => a.address_role === 'pickup') // and returns to where it was originally sent from

  const trackingNumber = generateTrackingNumber()
  const result = await db
    .prepare(
      `INSERT INTO shipments
        (tracking_number, shipment_type, fulfillment_category, customer_user_id, order_id, vendor_id, related_shipment_id,
         vehicle_type_id, speed_tier, origin_country_iso, destination_country_iso,
         declared_weight_kg, package_count, quoted_price_kobo, currency, status, source_type)
       VALUES (?, 'return', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'NGN', 'created', ?)`
    )
    .bind(
      trackingNumber,
      original.fulfillment_category,
      customerUserId,
      original.order_id,
      original.vendor_id,
      originalShipmentId,
      original.vehicle_type_id,
      'standard',
      original.destination_country_iso,
      original.origin_country_iso,
      original.declared_weight_kg,
      original.package_count,
      original.source_type
    )
    .run()

  const shipmentId = Number(result.meta.last_row_id)
  if (pickup) {
    await db
      .prepare(`INSERT INTO shipment_addresses (shipment_id, address_role, recipient_name, phone, line1, city, state, country_iso) VALUES (?, 'pickup', ?, ?, ?, ?, ?, ?)`)
      .bind(shipmentId, pickup.recipient_name, pickup.phone, pickup.line1, pickup.city, pickup.state, pickup.country_iso)
      .run()
  }
  if (dropoff) {
    await db
      .prepare(`INSERT INTO shipment_addresses (shipment_id, address_role, recipient_name, phone, line1, city, state, country_iso) VALUES (?, 'dropoff', ?, ?, ?, ?, ?, ?)`)
      .bind(shipmentId, dropoff.recipient_name, dropoff.phone, dropoff.line1, dropoff.city, dropoff.state, dropoff.country_iso)
      .run()
  }

  await logShipmentEvent(db, shipmentId, 'created', customerUserId, 'customer', `Return requested for shipment #${originalShipmentId}`)
  return { shipmentId, trackingNumber }
}
