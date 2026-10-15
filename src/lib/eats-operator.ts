/**
 * NaijaEats restaurant-operator workflow.
 *
 * Every operator lookup starts with the authenticated user id and resolves
 * provider_profiles -> restaurants server-side. Client restaurant/order ids
 * are only used as narrowed selectors after that ownership boundary.
 */

export type EatsOperatorStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'handoff' | 'completed' | 'declined'

export interface EatsOperatorProfile {
  id: number
  user_id: number
  display_name: string
  verification_status: string
  operational_status: string
}

export class EatsOperatorAccessError extends Error {}
export class EatsOperatorNotFoundError extends Error {}
export class EatsOperatorStateError extends Error {}

const OPERATOR_TRANSITIONS: Record<string, EatsOperatorStatus[]> = {
  new: ['accepted', 'declined'],
  accepted: ['preparing'],
  preparing: ['ready'],
  ready: ['handoff'],
  handoff: ['completed'],
}

export async function resolveEatsOperatorProfile(db: D1Database, userId: number): Promise<EatsOperatorProfile | null> {
  return db.prepare(
    `SELECT id, user_id, display_name, verification_status, operational_status
     FROM provider_profiles
     WHERE user_id = ? AND provider_type = 'restaurant_operator'
       AND operational_status = 'active'
       AND verification_status = 'verified'`
  ).bind(userId).first<EatsOperatorProfile>()
}

export async function getOwnedEatsRestaurants(db: D1Database, providerProfileId: number) {
  const { results } = await db.prepare(
    `SELECT id, slug, name, city, is_active, verification_status
     FROM restaurants
     WHERE owner_provider_profile_id = ?
     ORDER BY name ASC, id ASC`
  ).bind(providerProfileId).all()
  return results
}

export async function requireOwnedEatsRestaurant(db: D1Database, providerProfileId: number, restaurantId: number) {
  return db.prepare(
    `SELECT id, slug, name, city, is_active, verification_status
     FROM restaurants
     WHERE id = ? AND owner_provider_profile_id = ?`
  ).bind(restaurantId, providerProfileId).first()
}

function clampPageValue(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(0, Math.trunc(value as number)))
}

export async function getEatsOrdersForOperator(
  db: D1Database,
  providerProfileId: number,
  options: { restaurantId?: number; status?: string; limit?: number; offset?: number } = {}
) {
  const limit = clampPageValue(options.limit, 50, 100)
  const offset = clampPageValue(options.offset, 0, 1000000)
  const conditions = ['r.owner_provider_profile_id = ?']
  const binds: unknown[] = [providerProfileId]

  if (options.restaurantId !== undefined) {
    conditions.push('eo.restaurant_id = ?')
    binds.push(options.restaurantId)
  }
  if (options.status && Object.prototype.hasOwnProperty.call(OPERATOR_TRANSITIONS, options.status)) {
    conditions.push('eo.status = ?')
    binds.push(options.status)
  } else if (options.status && ['completed', 'declined', 'cancelled'].includes(options.status)) {
    conditions.push('eo.status = ?')
    binds.push(options.status)
  }

  const { results } = await db.prepare(
    `SELECT eo.*, r.name AS restaurant_name, r.slug AS restaurant_slug,
            u.name AS customer_name, u.phone AS customer_phone,
            (SELECT COUNT(*) FROM eats_order_items eoi WHERE eoi.order_id = eo.id) AS item_count
     FROM eats_orders eo
     JOIN restaurants r ON r.id = eo.restaurant_id
     JOIN users u ON u.id = eo.customer_user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY eo.created_at DESC, eo.id DESC
     LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all()
  return results
}

export async function getOwnedEatsOrderForOperator(db: D1Database, providerProfileId: number, orderId: number) {
  return db.prepare(
    `SELECT eo.*, r.name AS restaurant_name, r.slug AS restaurant_slug,
            u.name AS customer_name, u.phone AS customer_phone
     FROM eats_orders eo
     JOIN restaurants r ON r.id = eo.restaurant_id
     JOIN users u ON u.id = eo.customer_user_id
     WHERE eo.id = ? AND r.owner_provider_profile_id = ?`
  ).bind(orderId, providerProfileId).first()
}

export async function getEatsOrderItemsForOperator(db: D1Database, providerProfileId: number, orderId: number) {
  const order = await getOwnedEatsOrderForOperator(db, providerProfileId, orderId)
  if (!order) return null
  const { results } = await db.prepare('SELECT * FROM eats_order_items WHERE order_id = ? ORDER BY id ASC').bind(orderId).all()
  return results
}

export async function getEatsOperatorOrderEvents(db: D1Database, providerProfileId: number, orderId: number) {
  const order = await getOwnedEatsOrderForOperator(db, providerProfileId, orderId)
  if (!order) return null
  const { results } = await db.prepare(
    `SELECT eose.*, u.name AS actor_name
     FROM eats_order_status_events eose
     LEFT JOIN users u ON u.id = eose.actor_user_id
     WHERE eose.order_id = ? ORDER BY eose.created_at ASC, eose.id ASC`
  ).bind(orderId).all()
  return results
}

export async function transitionEatsOrderForOperator(
  db: D1Database,
  providerProfileId: number,
  orderId: number,
  newStatus: EatsOperatorStatus,
  actorUserId: number,
  note?: string | null
) {
  const order = await getOwnedEatsOrderForOperator(db, providerProfileId, orderId)
  if (!order) throw new EatsOperatorNotFoundError(`NaijaEats order ${orderId} not found or not owned by this operator`)

  const allowed = OPERATOR_TRANSITIONS[String(order.status)] ?? []
  if (!allowed.includes(newStatus)) {
    throw new EatsOperatorStateError(`Cannot transition a '${order.status}' order to '${newStatus}'`)
  }

  // The old-status predicate makes a duplicate/concurrent request a no-op
  // failure rather than a second state event. No payment columns are touched.
  const update = await db.prepare(
    `UPDATE eats_orders SET status = ?, updated_at = datetime('now')
     WHERE id = ? AND status = ?`
  ).bind(newStatus, orderId, order.status).run()
  const rowsWritten = (update.meta as { changes?: number }).changes ?? update.meta.rows_written ?? 0
  if (Number(rowsWritten) !== 1) {
    throw new EatsOperatorStateError('Order changed before this request completed; reload and try again')
  }

  await db.prepare(
    `INSERT INTO eats_order_status_events (order_id, status, actor_user_id, note)
     VALUES (?, ?, ?, ?)`
  ).bind(orderId, newStatus, actorUserId, note?.trim() || null).run()

  return { ...order, status: newStatus }
}

export function isEatsOperatorStatus(value: string): value is EatsOperatorStatus {
  return ['accepted', 'preparing', 'ready', 'handoff', 'completed', 'declined'].includes(value)
}

export function getEatsOperatorTransitions() {
  return OPERATOR_TRANSITIONS
}
