import { createStandaloneShipment } from './logistics-shipments'
import { requestDispatch } from './logistics-dispatch'

export class EatsFulfillmentError extends Error {}

export interface EatsDispatchInput {
  vehicleTypeId: number
  quotedPriceKobo: number
  speedTier?: string
  pickup?: { line1?: string; city?: string; state?: string; phone?: string }
  deliveryInstructions?: string | null
}

/**
 * Creates the real Logistics Engine shipment/job pair for a paid, ready Eats
 * order. The order and restaurant ownership checks happen before this helper
 * is called; this function deliberately requires an explicit vehicle and
 * price instead of inventing a courier or rate.
 */
export async function dispatchEatsOrder(db: D1Database, orderId: number, input: EatsDispatchInput) {
  const order = await db.prepare(
    `SELECT eo.*, r.name AS restaurant_name, r.address_line1 AS restaurant_address,
            r.city AS restaurant_city, r.country_iso AS restaurant_country
     FROM eats_orders eo JOIN restaurants r ON r.id = eo.restaurant_id
     WHERE eo.id = ?`
  ).bind(orderId).first<any>()
  if (!order) throw new EatsFulfillmentError('Eats order not found')
  if (!['ready', 'handoff'].includes(order.status)) throw new EatsFulfillmentError('Restaurant must mark the order ready before dispatch')
  if (!['escrow_held', 'released'].includes(order.payment_status)) throw new EatsFulfillmentError('A paid or escrow-held order is required before dispatch')

  const existing = await db.prepare('SELECT shipment_id FROM eats_order_fulfillments WHERE order_id = ?').bind(orderId).first<{ shipment_id: number }>()
  if (existing) throw new EatsFulfillmentError('A delivery fulfillment already exists for this order')

  const pickup = input.pickup ?? {}
  const shipment = await createStandaloneShipment(db, order.customer_user_id, {
    originCountryIso: order.restaurant_country,
    destinationCountryIso: order.restaurant_country,
    originZoneKey: order.restaurant_city?.toLowerCase().replaceAll(' ', '_') ?? null,
    destinationZoneKey: order.shipping_city?.toLowerCase().replaceAll(' ', '_') ?? null,
    vehicleTypeId: input.vehicleTypeId,
    speedTier: input.speedTier ?? 'same_day',
    fulfillmentCategory: 'food',
    declaredWeightKg: 1,
    packageCount: 1,
    parcelDescription: `NaijaEats order ${order.order_number}`,
    specialHandlingNotes: order.special_instructions,
    quotedPriceKobo: input.quotedPriceKobo,
    sourceType: 'naijaeats',
    pickup: {
      recipientName: order.restaurant_name,
      phone: pickup.phone ?? order.shipping_phone,
      line1: pickup.line1 ?? order.restaurant_address ?? order.restaurant_city,
      city: pickup.city ?? order.restaurant_city,
      state: pickup.state ?? order.shipping_state,
      countryIso: order.restaurant_country,
    },
    dropoff: {
      recipientName: order.shipping_name,
      phone: order.shipping_phone,
      line1: order.shipping_address,
      city: order.shipping_city,
      state: order.shipping_state,
      countryIso: order.shipping_country ?? order.restaurant_country,
      deliveryInstructions: input.deliveryInstructions,
    },
  })

  try {
    await db.prepare(
      `INSERT INTO eats_order_fulfillments (order_id, shipment_id, dispatch_status) VALUES (?, ?, 'dispatch_requested')`
    ).bind(orderId, shipment.shipmentId).run()
    const jobs = await requestDispatch(db, shipment.shipmentId)
    return { ...shipment, ...jobs, dispatch_status: 'dispatch_requested' }
  } catch (error) {
    // Do not hide a failed bridge or leave an apparently successful delivery
    // claim. The shipment remains queryable for admin reconciliation.
    throw new EatsFulfillmentError(error instanceof Error ? error.message : 'Unable to request Eats dispatch')
  }
}

export async function getEatsFulfillmentForCustomer(db: D1Database, orderNumber: string, userId: number) {
  return db.prepare(
    `SELECT eof.*, eo.order_number, s.tracking_number, s.status AS shipment_status,
            pj.id AS pickup_job_id, pj.status AS pickup_job_status,
            dj.id AS delivery_job_id, dj.status AS delivery_job_status
     FROM eats_order_fulfillments eof
     JOIN eats_orders eo ON eo.id = eof.order_id AND eo.order_number = ? AND eo.customer_user_id = ?
     JOIN shipments s ON s.id = eof.shipment_id
     LEFT JOIN pickup_jobs pj ON pj.shipment_id = s.id
     LEFT JOIN delivery_jobs dj ON dj.shipment_id = s.id`
  ).bind(orderNumber, userId).first<any>()
}
