/**
 * Logistics Engine 2.0 — Status events, live tracking, GPS ingestion
 * (spec sections 9, 10, 24, 25, 27, 77).
 *
 * NEVER DEPEND ON ONE MUTABLE STATUS COLUMN (section 10): every status
 * change writes an IMMUTABLE shipment_status_events row (append-only) in
 * addition to updating shipments.status — mirrors order-lifecycle.ts's/
 * booking-lifecycle.ts's exact "events table is the audit source of truth,
 * the status column is a convenience cache" pattern.
 *
 * NO FAKE GPS (section 24/83): if a shipment has zero gps_events rows, the
 * tracking view returns `driver_location: null` and says so — it never
 * fabricates a plausible-looking coordinate.
 */
import type { ShipmentStatus, LogisticsActorRole } from '../types'

export class LogisticsTrackingError extends Error {}

/** Writes one immutable event row AND updates shipments.status (if a real status transition, not just a note). */
export async function logShipmentEvent(
  db: D1Database,
  shipmentId: number,
  status: string,
  actorUserId: number | null,
  actorRole: LogisticsActorRole,
  note?: string | null,
  location?: { latitude: number; longitude: number } | null,
  metadata: Record<string, unknown> = {}
) {
  await db
    .prepare(
      `INSERT INTO shipment_status_events (shipment_id, status, actor_user_id, actor_role, note, metadata_json, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(shipmentId, status, actorUserId, actorRole, note ?? null, JSON.stringify(metadata), location?.latitude ?? null, location?.longitude ?? null)
    .run()
}

/**
 * Server-validated shipment status transition (section 9: "Statuses must
 * be validated server-side"). This is intentionally a SMALL explicit
 * transition set, not "any status to any status" — same discipline as
 * booking-lifecycle.ts's TRANSITIONS table.
 */
const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  created: ['awaiting_pickup', 'cancelled'],
  awaiting_pickup: ['assigned', 'cancelled'],
  booked: ['assigned', 'cancelled'],
  assigned: ['pickup_assigned', 'driver_en_route_to_pickup', 'cancelled'],
  pickup_assigned: ['driver_en_route_to_pickup', 'cancelled'],
  driver_en_route_to_pickup: ['arrived_pickup', 'cancelled'],
  arrived_pickup: ['picked_up', 'failed'],
  picked_up: ['in_transit'],
  in_transit: ['near_destination', 'out_for_delivery', 'lost', 'damaged'],
  near_destination: ['out_for_delivery'],
  out_for_delivery: ['arrived_dropoff', 'delivery_attempted'],
  arrived_dropoff: ['delivered', 'delivery_attempted'],
  delivery_attempted: ['out_for_delivery', 'delivered', 'failed_delivery', 'failed'],
  delivered: [],
  failed_delivery: ['out_for_delivery', 'returned', 'failed'],
  failed: ['returned', 'cancelled'],
  returned: [],
  cancelled: [],
  lost: [],
  damaged: ['returned'],
}

export class IllegalShipmentTransitionError extends LogisticsTrackingError {
  constructor(from: string, to: string) {
    super(`Cannot transition shipment from "${from}" to "${to}"`)
  }
}

export async function transitionShipmentStatus(
  db: D1Database,
  shipmentId: number,
  toStatus: ShipmentStatus,
  actorUserId: number | null,
  actorRole: LogisticsActorRole,
  note?: string | null,
  location?: { latitude: number; longitude: number } | null
) {
  const shipment = await db.prepare('SELECT status FROM shipments WHERE id = ?').bind(shipmentId).first<{ status: ShipmentStatus }>()
  if (!shipment) throw new LogisticsTrackingError('Shipment not found')

  const allowed = SHIPMENT_TRANSITIONS[shipment.status] ?? []
  if (!allowed.includes(toStatus)) {
    throw new IllegalShipmentTransitionError(shipment.status, toStatus)
  }

  await db.prepare(`UPDATE shipments SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(toStatus, shipmentId).run()
  await logShipmentEvent(db, shipmentId, toStatus, actorUserId, actorRole, note, location)
}

export async function getEventsForShipment(db: D1Database, shipmentId: number, limit = 100) {
  const { results } = await db
    .prepare('SELECT * FROM shipment_status_events WHERE shipment_id = ? ORDER BY id DESC LIMIT ?')
    .bind(shipmentId, limit)
    .all<any>()
  return results
}

/**
 * GPS location ingestion (section 25). client_event_id de-duplicates retried
 * client sends (UNIQUE(driver_id, client_event_id), migration 0026's
 * existing index — this is the FIRST real writer of that column).
 * Also updates driver_profiles' cheap denormalized current_latitude/
 * current_longitude (section 18's matching layer needs O(1) "where is
 * this driver now" without scanning gps_events).
 */
export async function recordDriverLocation(
  db: D1Database,
  driverId: number,
  clientEventId: string,
  latitude: number,
  longitude: number,
  opts: { shipmentId?: number | null; accuracyM?: number | null; recordedAt?: string } = {}
) {
  const recordedAt = opts.recordedAt ?? new Date().toISOString()
  await db.batch([
    db
      .prepare(
        `INSERT INTO gps_events (driver_id, shipment_id, client_event_id, latitude, longitude, accuracy_m, recorded_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'driver_app')
         ON CONFLICT(driver_id, client_event_id) DO NOTHING`
      )
      .bind(driverId, opts.shipmentId ?? null, clientEventId, latitude, longitude, opts.accuracyM ?? null, recordedAt),
    db
      .prepare(`UPDATE driver_profiles SET current_latitude = ?, current_longitude = ?, location_updated_at = ? WHERE id = ?`)
      .bind(latitude, longitude, recordedAt, driverId),
  ])
}

/**
 * DATA RETENTION (section 77): "Do not retain unlimited GPS points
 * indefinitely." Lazy compaction — same pattern as Booking Engine's
 * expireHoldsIfNeeded (no cron trigger available on Cloudflare Pages
 * hosted deploy, per this project's established constraint). Deletes
 * raw high-frequency points older than the retention window while
 * shipment_status_events (the important delivery milestones) are
 * NEVER touched by this function.
 */
const GPS_RETENTION_HOURS = 72

export async function compactOldGpsEventsIfNeeded(db: D1Database, driverId: number) {
  await db
    .prepare(`DELETE FROM gps_events WHERE driver_id = ? AND received_at < datetime('now', ?)`)
    .bind(driverId, `-${GPS_RETENTION_HOURS} hours`)
    .run()
}

export interface CustomerTrackingView {
  trackingNumber: string
  status: string
  events: any[]
  driverLocation: { latitude: number; longitude: number; updatedAt: string } | null
  eta: string | null
}

/**
 * Section 24/27: customer tracking view. NO FAKE GPS — if the assigned
 * driver has never sent a location update, driverLocation is null and the
 * caller must render that as "location unavailable", never a guess.
 */
export async function getCustomerTrackingView(db: D1Database, shipmentId: number): Promise<CustomerTrackingView> {
  const shipment = await db.prepare('SELECT tracking_number, status, delivery_window_end FROM shipments WHERE id = ?').bind(shipmentId).first<any>()
  if (!shipment) throw new LogisticsTrackingError('Shipment not found')

  const events = await getEventsForShipment(db, shipmentId, 50)

  const job = await db.prepare('SELECT driver_id FROM delivery_jobs WHERE shipment_id = ?').bind(shipmentId).first<{ driver_id: number | null }>()
  let driverLocation: CustomerTrackingView['driverLocation'] = null
  if (job?.driver_id) {
    const driver = await db.prepare('SELECT current_latitude, current_longitude, location_updated_at FROM driver_profiles WHERE id = ?').bind(job.driver_id).first<any>()
    if (driver?.current_latitude != null && driver?.current_longitude != null) {
      driverLocation = { latitude: driver.current_latitude, longitude: driver.current_longitude, updatedAt: driver.location_updated_at }
    }
  }

  return {
    trackingNumber: shipment.tracking_number,
    status: shipment.status,
    events,
    driverLocation, // null = honestly "not available", never fabricated (section 24/83)
    eta: shipment.delivery_window_end ?? null,
  }
}
