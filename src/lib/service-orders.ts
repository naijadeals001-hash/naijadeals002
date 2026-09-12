/**
 * Service Engine 2.0 — Service order lifecycle, events, and booking
 * integration (spec sections 12, 13, 24, 41, 42).
 *
 * Lifecycle: accepted -> scheduled -> provider_arriving -> in_progress ->
 * completed -> customer_confirmed -> paid. Side branches: cancelled |
 * declined | expired | disputed | refunded | no_show.
 *
 * Every transition is written through transitionOrderStatus, which ALWAYS
 * appends a service_order_events row (previous/new status, actor,
 * timestamp) — spec section 41's explicit "do not rely solely on one
 * mutable status column" requirement. The status column itself is kept in
 * sync for cheap filtering/joins, but the events table is the audit
 * source of truth.
 */
import type { ServiceOrderRow, ServiceQuoteRow, ServiceOrderStatus } from '../types'

export class NotOwnedError extends Error {
  constructor(entity: string, id: number) {
    super(`${entity} ${id} not found or not owned by this user`)
  }
}

export class OrderStateError extends Error {}

function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `SO-${ts}-${rand}`
}

/** Server-computed total — NEVER trust a client-supplied total (spec section 42). platform_fee is a flat 10% for this build; a real Payment Engine would source this from vertical-specific config. */
function computeTotalKobo(priceKobo: number, travelFeeKobo: number, additionalChargesKobo: number): { platformFeeKobo: number; totalKobo: number } {
  const platformFeeKobo = Math.round(priceKobo * 0.1)
  const totalKobo = priceKobo + travelFeeKobo + additionalChargesKobo + platformFeeKobo
  return { platformFeeKobo, totalKobo }
}

async function logOrderEvent(db: D1Database, orderId: number, previousStatus: string | null, newStatus: string, actorUserId: number | null, metadata: Record<string, unknown> = {}) {
  await db
    .prepare(`INSERT INTO service_order_events (service_order_id, previous_status, new_status, actor_user_id, metadata_json) VALUES (?, ?, ?, ?, ?)`)
    .bind(orderId, previousStatus, newStatus, actorUserId, JSON.stringify(metadata))
    .run()
}

/**
 * Creates a service_order from an ACCEPTED quote. The UNIQUE index on
 * service_orders.service_quote_id (migration 0039) makes a duplicate order
 * for the same quote a hard DB-level impossibility, not just an
 * application-level check (spec section 42: "prevent duplicate service
 * orders"). Must be called with a quote already verified status='accepted'
 * (see acceptQuote in service-requests.ts) — this function re-verifies
 * defensively rather than trusting the caller blindly.
 */
export async function createServiceOrderFromQuote(db: D1Database, quote: ServiceQuoteRow, customerUserId: number): Promise<number> {
  if (quote.status !== 'accepted') throw new OrderStateError(`Quote must be accepted before an order can be created (currently ${quote.status})`)

  const existing = await db.prepare('SELECT id FROM service_orders WHERE service_quote_id = ?').bind(quote.id).first<{ id: number }>()
  if (existing) throw new OrderStateError('A service order already exists for this quote')

  const { platformFeeKobo, totalKobo } = computeTotalKobo(quote.price_kobo, quote.travel_fee_kobo, 0)
  const orderNumber = generateOrderNumber()

  const result = await db
    .prepare(
      `INSERT INTO service_orders
        (order_number, service_request_id, service_quote_id, customer_user_id, provider_profile_id, price_kobo, travel_fee_kobo,
         additional_charges_kobo, platform_fee_kobo, total_kobo, currency, payment_status, status, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'unpaid', 'accepted', ?)`
    )
    .bind(
      orderNumber,
      quote.service_request_id,
      quote.id,
      customerUserId,
      quote.provider_profile_id,
      quote.price_kobo,
      quote.travel_fee_kobo,
      platformFeeKobo,
      totalKobo,
      quote.currency,
      quote.proposed_date && quote.proposed_time ? `${quote.proposed_date}T${quote.proposed_time}` : null
    )
    .run()

  const orderId = Number(result.meta.last_row_id)
  await logOrderEvent(db, orderId, null, 'accepted', customerUserId, { source: 'quote_accepted', quote_id: quote.id })
  return orderId
}

export async function getOwnedOrderForCustomer(db: D1Database, customerUserId: number, orderId: number): Promise<ServiceOrderRow | null> {
  return db.prepare('SELECT * FROM service_orders WHERE id = ? AND customer_user_id = ?').bind(orderId, customerUserId).first<ServiceOrderRow>()
}

export async function getOwnedOrderForProvider(db: D1Database, providerProfileId: number, orderId: number): Promise<ServiceOrderRow | null> {
  return db.prepare('SELECT * FROM service_orders WHERE id = ? AND provider_profile_id = ?').bind(orderId, providerProfileId).first<ServiceOrderRow>()
}

export async function getOrdersForCustomer(db: D1Database, customerUserId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT so.*, pp.display_name AS provider_display_name, sr.title AS request_title
       FROM service_orders so
       JOIN provider_profiles pp ON pp.id = so.provider_profile_id
       JOIN service_requests sr ON sr.id = so.service_request_id
       WHERE so.customer_user_id = ?
       ORDER BY so.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(customerUserId, limit, offset)
    .all()
  return results
}

export async function getOrdersForProvider(db: D1Database, providerProfileId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT so.*, sr.title AS request_title, u.name AS customer_name
       FROM service_orders so
       JOIN service_requests sr ON sr.id = so.service_request_id
       JOIN users u ON u.id = so.customer_user_id
       WHERE so.provider_profile_id = ?
       ORDER BY so.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(providerProfileId, limit, offset)
    .all()
  return results
}

export async function getEventsForOrder(db: D1Database, orderId: number) {
  const { results } = await db.prepare('SELECT * FROM service_order_events WHERE service_order_id = ? ORDER BY id ASC').bind(orderId).all()
  return results
}

// Legal transitions, keyed by CURRENT status -> set of statuses a given actor role may move to.
const PROVIDER_TRANSITIONS: Record<string, ServiceOrderStatus[]> = {
  accepted: ['scheduled', 'declined'],
  scheduled: ['provider_arriving', 'cancelled', 'no_show'],
  provider_arriving: ['in_progress', 'cancelled'],
  in_progress: ['completed']
}
const CUSTOMER_TRANSITIONS: Record<string, ServiceOrderStatus[]> = {
  accepted: ['cancelled'],
  scheduled: ['cancelled'],
  completed: ['customer_confirmed', 'disputed']
}

/**
 * Provider-driven status transition (spec section 13/24: appointment
 * lifecycle). Ownership enforced by providerProfileId scoping. Rejects any
 * transition not in the explicit whitelist above — a provider can never
 * jump straight to 'completed' or 'customer_confirmed' (spec section 42:
 * "unauthorized service completion" / "customer cannot force service
 * completion" is the INVERSE guard enforced by CUSTOMER_TRANSITIONS not
 * containing 'completed').
 */
export async function providerTransitionOrder(db: D1Database, providerProfileId: number, orderId: number, newStatus: ServiceOrderStatus, actorUserId: number, metadata: Record<string, unknown> = {}): Promise<ServiceOrderRow> {
  const order = await getOwnedOrderForProvider(db, providerProfileId, orderId)
  if (!order) throw new NotOwnedError('ServiceOrder', orderId)

  const allowed = PROVIDER_TRANSITIONS[order.status] ?? []
  if (!allowed.includes(newStatus)) {
    throw new OrderStateError(`Cannot transition a '${order.status}' order to '${newStatus}'`)
  }

  const extra: string[] = []
  const binds: unknown[] = [newStatus]
  if (newStatus === 'completed') {
    extra.push('completed_at = datetime(\'now\')')
  }
  if (newStatus === 'cancelled') {
    extra.push('cancelled_at = datetime(\'now\')')
    if (typeof metadata.reason === 'string') {
      extra.push('cancellation_reason = ?')
      binds.push(metadata.reason)
    }
  }

  await db
    .prepare(`UPDATE service_orders SET status = ?${extra.length ? ', ' + extra.join(', ') : ''}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...binds, orderId)
    .run()

  await logOrderEvent(db, orderId, order.status, newStatus, actorUserId, metadata)
  return { ...order, status: newStatus }
}

/**
 * Customer-driven status transition. A customer may cancel while not yet
 * in progress, or (after the provider marks 'completed') either confirm
 * completion or raise a dispute — but a customer can NEVER force a
 * transition to 'completed' themselves (spec section 42/47's explicit
 * security test), since 'completed' never appears as a value in
 * CUSTOMER_TRANSITIONS's target lists.
 */
export async function customerTransitionOrder(db: D1Database, customerUserId: number, orderId: number, newStatus: ServiceOrderStatus, metadata: Record<string, unknown> = {}): Promise<ServiceOrderRow> {
  const order = await getOwnedOrderForCustomer(db, customerUserId, orderId)
  if (!order) throw new NotOwnedError('ServiceOrder', orderId)

  const allowed = CUSTOMER_TRANSITIONS[order.status] ?? []
  if (!allowed.includes(newStatus)) {
    throw new OrderStateError(`Cannot transition a '${order.status}' order to '${newStatus}'`)
  }

  const extra: string[] = []
  const binds: unknown[] = [newStatus]
  if (newStatus === 'cancelled') {
    extra.push('cancelled_at = datetime(\'now\')')
    if (typeof metadata.reason === 'string') {
      extra.push('cancellation_reason = ?')
      binds.push(metadata.reason)
    }
  }
  if (newStatus === 'customer_confirmed') {
    // Customer-confirmed completion is the trigger point where a real
    // Payment Engine would release escrow to the provider (spec section 25)
    // — out of scope here beyond recording the payment_status transition.
    extra.push(`payment_status = 'released'`)
  }

  await db
    .prepare(`UPDATE service_orders SET status = ?${extra.length ? ', ' + extra.join(', ') : ''}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...binds, orderId)
    .run()

  await logOrderEvent(db, orderId, order.status, newStatus, customerUserId, metadata)
  return { ...order, status: newStatus }
}

/**
 * Additional-charge request (spec section 26): a provider may propose extra
 * charges for variable-scope work, but the order's total is NOT increased
 * until the customer explicitly confirms via confirmAdditionalCharge —
 * "never silently increase customer's charge" is enforced by additional
 * charges living in a separate pending field until confirmed. For this
 * build's scope, additional charges are recorded directly on
 * confirmation (no separate pending-charge table) since only the
 * customer-side confirm endpoint is exposed at all.
 */
export async function confirmAdditionalCharge(db: D1Database, customerUserId: number, orderId: number, additionalChargesKobo: number): Promise<ServiceOrderRow> {
  if (additionalChargesKobo < 0) throw new Error('additionalChargesKobo cannot be negative')
  const order = await getOwnedOrderForCustomer(db, customerUserId, orderId)
  if (!order) throw new NotOwnedError('ServiceOrder', orderId)
  if (order.status === 'cancelled' || order.status === 'refunded') throw new OrderStateError(`Cannot modify charges on a ${order.status} order`)

  const { platformFeeKobo, totalKobo } = computeTotalKobo(order.price_kobo, order.travel_fee_kobo, additionalChargesKobo)
  await db
    .prepare(`UPDATE service_orders SET additional_charges_kobo = ?, platform_fee_kobo = ?, total_kobo = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(additionalChargesKobo, platformFeeKobo, totalKobo, orderId)
    .run()
  await logOrderEvent(db, orderId, order.status, order.status, customerUserId, { action: 'additional_charge_confirmed', additional_charges_kobo: additionalChargesKobo })
  return { ...order, additional_charges_kobo: additionalChargesKobo, platform_fee_kobo: platformFeeKobo, total_kobo: totalKobo }
}
