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
export const DRIVER_OFFER_EXPIRY_MINUTES = 10

export async function recoverExpiredRideOffers(db: D1Database, rideId?: number) {
  const rides = await db.prepare(`SELECT DISTINCT r.id,r.status FROM drive_ride_requests r JOIN drive_ride_offers o ON o.ride_request_id=r.id WHERE o.status='offered' AND o.expires_at <= datetime('now') ${rideId ? 'AND r.id = ?' : ''}`).bind(...(rideId ? [rideId] : [])).all<any>()
  for (const ride of rides.results) {
    const expired = await db.prepare("UPDATE drive_ride_offers SET status='expired',responded_at=datetime('now') WHERE ride_request_id=? AND status='offered' AND expires_at <= datetime('now')").bind(ride.id).run()
    if (!expired.meta.rows_written) continue
    const candidate = await db.prepare(`SELECT d.id FROM driver_profiles d WHERE d.status='active' AND d.is_online=1 AND d.operational_status='available' AND NOT EXISTS (SELECT 1 FROM drive_ride_offers o WHERE o.ride_request_id=? AND o.driver_profile_id=d.id AND o.status IN ('rejected','expired')) ORDER BY d.id LIMIT 1`).bind(ride.id).first<{id:number}>()
    if (candidate) {
      await db.prepare("INSERT OR IGNORE INTO drive_ride_offers (ride_request_id,driver_profile_id,status,expires_at) VALUES (?,?,'offered',datetime('now', '+10 minutes'))").bind(ride.id,candidate.id).run()
      await db.prepare("UPDATE drive_ride_requests SET status='offered',reassignment_count=reassignment_count+1,updated_at=datetime('now') WHERE id=? AND status IN ('searching','offered')").bind(ride.id).run()
      await recordRideEvent(db, ride.id, ride.status, 'offered', null, 'system', 'Expired offer reassigned to next eligible driver')
    } else {
      await db.prepare("UPDATE drive_ride_requests SET status='no_driver_available',updated_at=datetime('now') WHERE id=? AND status IN ('searching','offered')").bind(ride.id).run()
      await recordRideEvent(db, ride.id, ride.status, 'no_driver_available', null, 'system', 'All eligible driver offers expired or were rejected')
    }
  }
}

export async function reassignRideAfterOffer(db: D1Database, rideId: number, fromStatus: string) {
  const candidate = await db.prepare(`SELECT d.id FROM driver_profiles d JOIN drive_ride_requests r ON r.id=? WHERE d.status='active' AND d.is_online=1 AND d.operational_status='available' AND NOT EXISTS (SELECT 1 FROM drive_ride_offers o WHERE o.ride_request_id=? AND o.driver_profile_id=d.id AND o.status IN ('rejected','expired')) ORDER BY d.id LIMIT 1`).bind(rideId, rideId).first<{id:number}>()
  if (candidate) {
    await db.prepare("INSERT OR IGNORE INTO drive_ride_offers (ride_request_id,driver_profile_id,status,expires_at) VALUES (?,?,'offered',datetime('now', '+10 minutes'))").bind(rideId,candidate.id).run()
    await db.prepare("UPDATE drive_ride_requests SET status='offered',reassignment_count=reassignment_count+1,updated_at=datetime('now') WHERE id=? AND status IN ('searching','offered')").bind(rideId).run()
    await recordRideEvent(db, rideId, fromStatus, 'offered', null, 'system', 'Offer reassigned after driver rejection')
    return 'offered'
  }
  await db.prepare("UPDATE drive_ride_requests SET status='no_driver_available',updated_at=datetime('now') WHERE id=? AND status IN ('searching','offered')").bind(rideId).run()
  await recordRideEvent(db, rideId, fromStatus, 'no_driver_available', null, 'system', 'No eligible drivers remain after rejection')
  return 'no_driver_available'
}

export async function getRideForCustomer(db: D1Database, rideId: number, userId: number) { return db.prepare('SELECT r.*, dp.user_id AS driver_user_id, dp.id AS driver_profile_id FROM drive_ride_requests r LEFT JOIN driver_profiles dp ON dp.id = r.accepted_driver_profile_id WHERE r.id = ? AND r.customer_user_id = ?').bind(rideId, userId).first() }
