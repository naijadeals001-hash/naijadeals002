/**
 * Logistics Engine 2.0 — Dispatch, Driver Matching, Assignment/Acceptance/
 * Reassignment (spec sections 17-19).
 *
 * REPLACEABLE MATCHING LAYER (section 18): "Do not hard-code one matching
 * algorithm." `rankCandidateDrivers` is a single, swappable function — a
 * future smarter matcher (real distance via Maps/GPS, ML ranking, etc)
 * replaces ONLY this function, never the dispatch flow around it.
 *
 * ATOMIC ASSIGNMENT (mirrors booking-holds.ts's atomic capacity-check
 * pattern): assigning a driver to a job is a single conditional UPDATE
 * (`WHERE status = 'unassigned'`) — two dispatchers racing to assign the
 * same job can never both succeed, because D1/SQLite serializes writer
 * statements and only the first UPDATE's WHERE clause still matches.
 */
import { logShipmentEvent, transitionShipmentStatus } from './logistics-tracking'

export class LogisticsDispatchError extends Error {}
export class JobAlreadyAssignedError extends LogisticsDispatchError {
  constructor() {
    super('This job has already been assigned to another driver')
  }
}
export class NotOwnedJobError extends LogisticsDispatchError {
  constructor() {
    super('Job not found or not accessible to this actor')
  }
}

export type JobType = 'pickup' | 'delivery'

function jobTable(jobType: JobType): string {
  return jobType === 'pickup' ? 'pickup_jobs' : 'delivery_jobs'
}

/**
 * Creates the operational job(s) for a shipment (section 6/17's dispatch
 * flow entry point: "shipment created -> dispatch request"). A shipment
 * gets a pickup_job (if not already at the depot) and always a
 * delivery_job — mirrors the existing UNIQUE(shipment_id) index on both
 * tables (migration 0020): one pickup job, one delivery job, per shipment.
 */
export async function requestDispatch(db: D1Database, shipmentId: number): Promise<{ pickupJobId: number; deliveryJobId: number }> {
  const existingPickup = await db.prepare('SELECT id FROM pickup_jobs WHERE shipment_id = ?').bind(shipmentId).first<{ id: number }>()
  const existingDelivery = await db.prepare('SELECT id FROM delivery_jobs WHERE shipment_id = ?').bind(shipmentId).first<{ id: number }>()
  if (existingPickup || existingDelivery) throw new LogisticsDispatchError('Dispatch already requested for this shipment')

  const pickupResult = await db.prepare(`INSERT INTO pickup_jobs (shipment_id, status) VALUES (?, 'unassigned')`).bind(shipmentId).run()
  const deliveryResult = await db.prepare(`INSERT INTO delivery_jobs (shipment_id, status) VALUES (?, 'unassigned')`).bind(shipmentId).run()

  await transitionShipmentStatus(db, shipmentId, 'awaiting_pickup', null, 'system', 'Dispatch requested')
  await logShipmentEvent(db, shipmentId, 'dispatch_requested', null, 'system')

  return { pickupJobId: Number(pickupResult.meta.last_row_id), deliveryJobId: Number(deliveryResult.meta.last_row_id) }
}

export interface CandidateDriver {
  id: number
  distanceScore: number // lower is better; 0 when unknown (section 18: distance is ONE ranking factor, not a hard requirement)
  ratingAvg: number
  currentWorkload: number
}

/**
 * REPLACEABLE ranking function (section 18). Current implementation: rank
 * available drivers by (1) fewest active jobs, (2) highest rating — a
 * simple, honest heuristic. Real geographic distance requires geocoded
 * coordinates for BOTH the driver and the pickup point; where a driver has
 * no current_latitude/longitude yet (never sent a GPS ping), distanceScore
 * is 0 (unknown), never fabricated.
 */
export async function rankCandidateDrivers(db: D1Database, opts: { countryIso: string; vehicleTypeId?: number | null; limit?: number }): Promise<CandidateDriver[]> {
  const { results } = await db
    .prepare(
      `SELECT dp.id, dp.rating_avg,
              (SELECT COUNT(*) FROM delivery_jobs WHERE driver_id = dp.id AND status IN ('assigned','accepted','en_route')) as active_jobs
       FROM driver_profiles dp
       WHERE dp.country_iso = ? AND dp.status = 'active' AND dp.operational_status = 'available'
       ORDER BY active_jobs ASC, dp.rating_avg DESC
       LIMIT ?`
    )
    .bind(opts.countryIso, opts.limit ?? 20)
    .all<{ id: number; rating_avg: number; active_jobs: number }>()

  return results.map((r) => ({ id: r.id, distanceScore: 0, ratingAvg: r.rating_avg, currentWorkload: r.active_jobs }))
}

/**
 * ATOMIC assignment (section 17/19's "assignment" step). The single
 * conditional UPDATE is what makes double-assignment structurally
 * impossible, not merely checked-for. Sets driver operational_status to
 * 'assigned' as a side effect (section 13).
 */
export async function assignDriverToJob(db: D1Database, jobType: JobType, jobId: number, driverId: number, assignedByActorRole: 'system' | 'admin' | 'merchant' | 'fleet'): Promise<void> {
  const table = jobTable(jobType)
  const result = await db
    .prepare(`UPDATE ${table} SET driver_id = ?, status = 'assigned', assigned_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'unassigned'`)
    .bind(driverId, jobId)
    .run()

  if (!result.meta.rows_written) throw new JobAlreadyAssignedError()

  await db.prepare(`UPDATE driver_profiles SET operational_status = 'assigned' WHERE id = ?`).bind(driverId).run()

  const job = await db.prepare(`SELECT shipment_id FROM ${table} WHERE id = ?`).bind(jobId).first<{ shipment_id: number }>()
  if (job) {
    await logShipmentEvent(db, job.shipment_id, `${jobType}_driver_assigned`, null, assignedByActorRole, `Driver #${driverId} assigned`)
    if (jobType === 'delivery') {
      const shipment = await db.prepare('SELECT status FROM shipments WHERE id = ?').bind(job.shipment_id).first<{ status: string }>()
      if (shipment?.status === 'awaiting_pickup') {
        await transitionShipmentStatus(db, job.shipment_id, 'assigned', null, 'system', 'Driver assigned')
      }
    }
  }
}

/**
 * Driver acceptance (section 17). Ownership-scoped by driverId — a driver
 * can only accept a job assigned to THEM.
 */
export async function acceptJob(db: D1Database, jobType: JobType, jobId: number, driverId: number): Promise<void> {
  const table = jobTable(jobType)
  const result = await db
    .prepare(`UPDATE ${table} SET status = 'accepted', accepted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND driver_id = ? AND status = 'assigned'`)
    .bind(jobId, driverId)
    .run()
  if (!result.meta.rows_written) throw new NotOwnedJobError()

  const job = await db.prepare(`SELECT shipment_id FROM ${table} WHERE id = ?`).bind(jobId).first<{ shipment_id: number }>()
  if (job) await logShipmentEvent(db, job.shipment_id, `${jobType}_driver_accepted`, null, 'driver')
}

/**
 * Reassignment (section 17/60's audit mandate: "driver reassigned" must be
 * auditable). Releases the current driver back to 'available' and
 * re-opens the job for a fresh assignDriverToJob call.
 */
export async function reassignJob(db: D1Database, jobType: JobType, jobId: number, actorUserId: number | null, reason: string): Promise<void> {
  const table = jobTable(jobType)
  const job = await db.prepare(`SELECT shipment_id, driver_id FROM ${table} WHERE id = ?`).bind(jobId).first<{ shipment_id: number; driver_id: number | null }>()
  if (!job) throw new LogisticsDispatchError('Job not found')

  await db
    .prepare(`UPDATE ${table} SET driver_id = NULL, status = 'unassigned', assigned_at = NULL, accepted_at = NULL, updated_at = datetime('now') WHERE id = ?`)
    .bind(jobId)
    .run()

  if (job.driver_id) {
    await db.prepare(`UPDATE driver_profiles SET operational_status = 'available' WHERE id = ?`).bind(job.driver_id).run()
  }

  await logShipmentEvent(db, job.shipment_id, `${jobType}_driver_reassigned`, actorUserId, 'admin', reason)
}

export async function getJob(db: D1Database, jobType: JobType, jobId: number) {
  return db.prepare(`SELECT * FROM ${jobTable(jobType)} WHERE id = ?`).bind(jobId).first<any>()
}

export async function getJobForDriver(db: D1Database, jobType: JobType, jobId: number, driverId: number) {
  const row = await db.prepare(`SELECT * FROM ${jobTable(jobType)} WHERE id = ? AND driver_id = ?`).bind(jobId, driverId).first<any>()
  return row ?? null
}
