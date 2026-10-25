import type { D1Database } from '@cloudflare/workers-types'

export const RIDE_STATUSES = ['requested','searching','offered','accepted','driver_arriving','driver_arrived','in_progress','completed','cancelled','no_driver_available'] as const
export type RideStatus = typeof RIDE_STATUSES[number]
const transitions: Record<string, string[]> = { requested: ['searching','cancelled'], searching: ['offered','no_driver_available','cancelled'], offered: ['accepted','searching','cancelled'], accepted: ['driver_arriving','cancelled'], driver_arriving: ['driver_arrived','cancelled'], driver_arrived: ['in_progress','cancelled'], in_progress: ['completed'], completed: [], cancelled: [], no_driver_available: [] }

export async function recordRideEvent(db: D1Database, rideId: number, from: string | null, to: string, actorUserId: number | null, actorRole: string, note = '') {
  await db.prepare('INSERT INTO drive_ride_events (ride_request_id,from_status,to_status,actor_user_id,actor_role,note) VALUES (?,?,?,?,?,?)').bind(rideId, from, to, actorUserId, actorRole, note).run()
}
export async function transitionRide(db: D1Database, rideId: number, fromStatuses: string[], to: RideStatus, actorUserId: number, actorRole: string, note = '') {
  const current = await db.prepare('SELECT status FROM drive_ride_requests WHERE id = ?').bind(rideId).first<{status: RideStatus}>()
  if (!current) throw new Error('Ride request not found')
  if (!fromStatuses.includes(current.status) || !transitions[current.status]?.includes(to)) throw new Error(`Invalid ride transition ${current.status} -> ${to}`)
  const updated = await db.prepare(`UPDATE drive_ride_requests SET status = ?, updated_at = datetime('now'), accepted_at = CASE WHEN ? = 'accepted' THEN datetime('now') ELSE accepted_at END, completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE completed_at END, cancelled_at = CASE WHEN ? = 'cancelled' THEN datetime('now') ELSE cancelled_at END WHERE id = ? AND status = ?`).bind(to, to, to, to, rideId, current.status).run()
  if (!updated.meta.rows_written) throw new Error('Ride changed concurrently; retry')
  await recordRideEvent(db, rideId, current.status, to, actorUserId, actorRole, note)
  return to
}
export async function getRideForCustomer(db: D1Database, rideId: number, userId: number) { return db.prepare('SELECT r.*, dp.user_id AS driver_user_id, dp.id AS driver_profile_id FROM drive_ride_requests r LEFT JOIN driver_profiles dp ON dp.id = r.accepted_driver_profile_id WHERE r.id = ? AND r.customer_user_id = ?').bind(rideId, userId).first() }
