import type { D1Database } from '@cloudflare/workers-types'

export type CollaborationRole = 'customer' | 'provider'

export class CollaborationAccessError extends Error {}
export class CollaborationStateError extends Error {}

async function getParticipant(db: D1Database, orderId: number, userId: number) {
  return db.prepare(`
    SELECT so.id, so.status, so.customer_user_id, so.provider_profile_id,
           pp.user_id AS provider_user_id
    FROM service_orders so
    JOIN provider_profiles pp ON pp.id = so.provider_profile_id
    WHERE so.id = ? AND (so.customer_user_id = ? OR pp.user_id = ?)
  `).bind(orderId, userId, userId).first<any>()
}

export async function requireParticipant(db: D1Database, orderId: number, userId: number) {
  const order = await getParticipant(db, orderId, userId)
  if (!order) throw new CollaborationAccessError('Service order not found or not accessible')
  return { order, role: Number(order.customer_user_id) === userId ? 'customer' as const : 'provider' as const }
}

export async function listCollaboration(db: D1Database, orderId: number, userId: number) {
  await requireParticipant(db, orderId, userId)
  const [milestones, messages] = await Promise.all([
    db.prepare(`SELECT id,service_order_id,title,description,due_at,status,created_by_user_id,created_at,updated_at FROM service_order_milestones WHERE service_order_id=? ORDER BY id ASC`).bind(orderId).all(),
    db.prepare(`SELECT id,service_order_id,sender_user_id,body,created_at FROM service_order_messages WHERE service_order_id=? ORDER BY id ASC`).bind(orderId).all(),
  ])
  return { milestones: milestones.results, messages: messages.results }
}

export async function createMessage(db: D1Database, orderId: number, userId: number, body: string, idempotencyKey?: string | null) {
  const participant = await requireParticipant(db, orderId, userId)
  const text = body.trim()
  if (!text || text.length > 2000) throw new CollaborationStateError('Message body must contain 1-2000 characters')
  const key = idempotencyKey?.trim() || null
  if (key && key.length > 200) throw new CollaborationStateError('Idempotency-Key must be at most 200 characters')
  if (key) {
    const existing = await db.prepare('SELECT id,service_order_id,sender_user_id,body,created_at FROM service_order_messages WHERE service_order_id=? AND sender_user_id=? AND idempotency_key=?').bind(orderId, userId, key).first()
    if (existing) return existing
  }
  const result = await db.prepare('INSERT INTO service_order_messages(service_order_id,sender_user_id,body,idempotency_key) VALUES(?,?,?,?)').bind(orderId, userId, text, key).run()
  await db.batch([db.prepare(`INSERT INTO service_order_events(service_order_id,previous_status,new_status,actor_user_id,metadata_json) VALUES(?,?,?,?,?)`).bind(orderId, participant.order.status, participant.order.status, userId, JSON.stringify({ action: 'message_created', message_id: result.meta.last_row_id }))])
  return db.prepare('SELECT id,service_order_id,sender_user_id,body,created_at FROM service_order_messages WHERE id=?').bind(result.meta.last_row_id).first()
}

export async function createMilestone(db: D1Database, orderId: number, userId: number, input: { title?: string; description?: string; due_at?: string | null; idempotency_key?: string | null }) {
  const participant = await requireParticipant(db, orderId, userId)
  if (participant.role !== 'provider') throw new CollaborationAccessError('Only the assigned provider can create milestones')
  const title = input.title?.trim() ?? ''
  if (!title || title.length > 160) throw new CollaborationStateError('Milestone title must contain 1-160 characters')
  const description = input.description?.trim() ?? ''
  if (description.length > 2000) throw new CollaborationStateError('Milestone description must be at most 2000 characters')
  const key = input.idempotency_key?.trim() || null
  if (key && key.length > 200) throw new CollaborationStateError('Idempotency-Key must be at most 200 characters')
  if (key) {
    const existing = await db.prepare('SELECT * FROM service_order_milestones WHERE service_order_id=? AND idempotency_key=?').bind(orderId, key).first()
    if (existing) return existing
  }
  const result = await db.prepare('INSERT INTO service_order_milestones(service_order_id,title,description,due_at,created_by_user_id,idempotency_key) VALUES(?,?,?,?,?,?)').bind(orderId, title, description, input.due_at ?? null, userId, key).run()
  await db.batch([db.prepare(`INSERT INTO service_order_events(service_order_id,previous_status,new_status,actor_user_id,metadata_json) VALUES(?,?,?,?,?)`).bind(orderId, participant.order.status, participant.order.status, userId, JSON.stringify({ action: 'milestone_created', milestone_id: result.meta.last_row_id }))])
  return db.prepare('SELECT * FROM service_order_milestones WHERE id=?').bind(result.meta.last_row_id).first()
}

const PROVIDER_MILESTONE_TRANSITIONS: Record<string, string[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['submitted', 'cancelled'],
  rejected: ['in_progress', 'cancelled'],
}
const CUSTOMER_MILESTONE_TRANSITIONS: Record<string, string[]> = {
  submitted: ['approved', 'rejected'],
}

export async function transitionMilestone(db: D1Database, orderId: number, milestoneId: number, userId: number, nextStatus: string) {
  const participant = await requireParticipant(db, orderId, userId)
  const milestone = await db.prepare('SELECT * FROM service_order_milestones WHERE id=? AND service_order_id=?').bind(milestoneId, orderId).first<any>()
  if (!milestone) throw new CollaborationAccessError('Milestone not found or not accessible')
  const transitions = participant.role === 'provider' ? PROVIDER_MILESTONE_TRANSITIONS : CUSTOMER_MILESTONE_TRANSITIONS
  if (!transitions[milestone.status]?.includes(nextStatus)) throw new CollaborationStateError(`Cannot transition milestone from ${milestone.status} to ${nextStatus}`)
  const changed = await db.prepare(`UPDATE service_order_milestones SET status=?, updated_at=datetime('now') WHERE id=? AND service_order_id=? AND status=?`).bind(nextStatus, milestoneId, orderId, milestone.status).run()
  if (!changed.meta.rows_written) throw new CollaborationStateError('Milestone changed concurrently; retry')
  await db.batch([db.prepare(`INSERT INTO service_order_events(service_order_id,previous_status,new_status,actor_user_id,metadata_json) VALUES(?,?,?,?,?)`).bind(orderId, participant.order.status, participant.order.status, userId, JSON.stringify({ action: 'milestone_transition', milestone_id: milestoneId, from: milestone.status, to: nextStatus }))])
  return db.prepare('SELECT * FROM service_order_milestones WHERE id=?').bind(milestoneId).first()
}
