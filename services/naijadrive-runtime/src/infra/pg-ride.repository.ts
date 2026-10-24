import type { Pool } from 'pg'
import type { RideGeographyInput, RideRepository, RideRequest, RideStatus, RideStatusEvent } from '../domain/types.js'

/** Production adapter. The NaijaDeal user id is intentionally an external FK boundary. */
export class PgRideRepository implements RideRepository {
  constructor(private readonly pool: Pool) {}

  async createRide(input: Omit<RideRequest, 'id' | 'status' | 'assignedDriverId' | 'cancellationReason' | 'createdAt'>): Promise<RideRequest> {
    const result = await this.pool.query<RideRequest>(
      `INSERT INTO naijadrive_rides
       (customer_user_id, pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
        pickup_zone_key, dropoff_zone_key, vehicle_category_id, estimated_distance_km,
        estimated_duration_minutes, estimated_fare_kobo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,
         (SELECT id FROM naijadrive_vehicle_categories WHERE category_key = $8),
         $9,$10,$11)
       RETURNING id, customer_user_id AS "customerUserId", pickup_latitude AS "pickupLatitude",
         pickup_longitude AS "pickupLongitude", dropoff_latitude AS "dropoffLatitude",
         dropoff_longitude AS "dropoffLongitude", pickup_zone_key AS "pickupZone",
         dropoff_zone_key AS "dropoffZone", estimated_distance_km AS "estimatedDistanceKm",
         estimated_duration_minutes AS "estimatedDurationMinutes", estimated_fare_kobo AS "estimatedFareKobo",
         status, assigned_driver_id AS "assignedDriverId", cancellation_reason AS "cancellationReason",
         created_at AS "createdAt"`,
      [input.customerUserId, input.pickup.latitude, input.pickup.longitude, input.dropoff.latitude, input.dropoff.longitude,
        input.pickupZone, input.dropoffZone, input.vehicleCategory, input.estimatedDistanceKm, input.estimatedDurationMinutes, input.estimatedFareKobo],
    )
    return normalizeRide(result.rows[0])
  }

  async validateRideGeography(input: RideGeographyInput): Promise<void> {
    const result = await this.pool.query<{ pickup_in_zone: boolean; dropoff_in_zone: boolean }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM naijadrive_service_zones
           WHERE zone_key = $1 AND is_active = TRUE AND boundary IS NOT NULL
             AND ST_Within(ST_SetSRID(ST_Point($2, $3), 4326), boundary)
         ) AS pickup_in_zone,
         EXISTS (
           SELECT 1 FROM naijadrive_service_zones
           WHERE zone_key = $4 AND is_active = TRUE AND boundary IS NOT NULL
             AND ST_Within(ST_SetSRID(ST_Point($5, $6), 4326), boundary)
         ) AS dropoff_in_zone`,
      [input.pickupZone, input.pickup.longitude, input.pickup.latitude, input.dropoffZone, input.dropoff.longitude, input.dropoff.latitude],
    )
    if (!result.rows[0]?.pickup_in_zone || !result.rows[0]?.dropoff_in_zone) throw new Error('Pickup and drop-off coordinates are outside the configured service boundary')
  }

  async getRide(rideId: number): Promise<RideRequest | null> {
    const result = await this.pool.query<RideRequest>('SELECT * FROM naijadrive_rides WHERE id = $1', [rideId])
    return result.rows[0] ? normalizeRide(result.rows[0]) : null
  }

  async transitionRide(rideId: number, expected: RideStatus, next: RideStatus, event: RideStatusEvent): Promise<RideRequest> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<RideRequest>(
        `UPDATE naijadrive_rides SET status = $1, cancellation_reason = CASE WHEN $1 = 'cancelled' THEN $2 ELSE cancellation_reason END, updated_at = now()
         WHERE id = $3 AND status = $4 RETURNING *`,
        [next, event.note, rideId, expected],
      )
      if (result.rowCount !== 1) throw new Error('Ride changed before this transition could be committed')
      await client.query(
        `INSERT INTO naijadrive_ride_status_events (ride_id, from_status, to_status, actor_user_id, actor_role, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [rideId, event.fromStatus, event.toStatus, event.actorUserId, event.actorRole, event.note],
      )
      await client.query('COMMIT')
      return normalizeRide(result.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async assignDriver(rideId: number, driverId: number, event: RideStatusEvent): Promise<RideRequest> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<RideRequest>(
        `UPDATE naijadrive_rides SET status = 'driver_assigned', assigned_driver_id = $1, updated_at = now()
         WHERE id = $2 AND status = 'searching' AND assigned_driver_id IS NULL RETURNING *`,
        [driverId, rideId],
      )
      if (result.rowCount !== 1) throw new Error('Ride is already assigned or unavailable')
      await client.query(
        `INSERT INTO naijadrive_ride_status_events (ride_id, from_status, to_status, actor_user_id, actor_role, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [rideId, event.fromStatus, event.toStatus, event.actorUserId, event.actorRole, event.note],
      )
      await client.query('COMMIT')
      return normalizeRide(result.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

function normalizeRide(row: any): RideRequest {
  return {
    id: Number(row.id),
    customerUserId: Number(row.customerUserId ?? row.customer_user_id),
    pickup: { latitude: Number(row.pickupLatitude ?? row.pickup_latitude), longitude: Number(row.pickupLongitude ?? row.pickup_longitude) },
    dropoff: { latitude: Number(row.dropoffLatitude ?? row.dropoff_latitude), longitude: Number(row.dropoffLongitude ?? row.dropoff_longitude) },
    pickupZone: row.pickupZone ?? row.pickup_zone_key,
    dropoffZone: row.dropoffZone ?? row.dropoff_zone_key,
    vehicleCategory: row.vehicleCategory ?? row.vehicle_category,
    estimatedDistanceKm: Number(row.estimatedDistanceKm ?? row.estimated_distance_km),
    estimatedDurationMinutes: Number(row.estimatedDurationMinutes ?? row.estimated_duration_minutes),
    estimatedFareKobo: Number(row.estimatedFareKobo ?? row.estimated_fare_kobo),
    status: row.status,
    assignedDriverId: row.assignedDriverId == null ? (row.assigned_driver_id == null ? null : Number(row.assigned_driver_id)) : Number(row.assignedDriverId),
    cancellationReason: row.cancellationReason ?? row.cancellation_reason ?? null,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at,
  }
}
