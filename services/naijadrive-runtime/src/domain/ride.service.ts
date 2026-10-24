import { estimateFareKobo } from './fare.service.js'
import type { AuditPort, DriverEligibility, GeoPoint, RideRepository, RideRequest, RideStatus, VehicleCategory } from './types.js'
import { getAbujaFareRule, findAbujaZone } from '../config/abuja.js'

const TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  requested: ['searching', 'cancelled'],
  searching: ['driver_assigned', 'cancelled', 'no_driver'],
  driver_assigned: ['driver_arrived', 'cancelled'],
  driver_arrived: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_driver: [],
}

export interface CreateRideInput {
  customerUserId: number
  pickup: GeoPoint
  dropoff: GeoPoint
  pickupZone: string
  dropoffZone: string
  vehicleCategory: VehicleCategory
  distanceKm: number
  durationMinutes: number
}

export class RideService {
  constructor(private readonly rides: RideRepository, private readonly audit: AuditPort) {}

  async createRide(input: CreateRideInput): Promise<RideRequest> {
    if (!findAbujaZone(input.pickupZone) || !findAbujaZone(input.dropoffZone)) throw new Error('Pickup and drop-off must be inside active Abuja pilot zones')
    const fareRule = getAbujaFareRule(input.vehicleCategory)
    const ride = await this.rides.createRide({
      customerUserId: input.customerUserId,
      pickup: input.pickup,
      dropoff: input.dropoff,
      pickupZone: input.pickupZone,
      dropoffZone: input.dropoffZone,
      vehicleCategory: input.vehicleCategory,
      estimatedDistanceKm: input.distanceKm,
      estimatedDurationMinutes: input.durationMinutes,
      estimatedFareKobo: estimateFareKobo({ distanceKm: input.distanceKm, durationMinutes: input.durationMinutes, rule: fareRule }),
    })
    await this.audit.record({ rideId: ride.id, fromStatus: null, toStatus: ride.status, actorUserId: input.customerUserId, actorRole: 'customer', note: 'Ride requested' })
    return ride
  }

  async getRide(rideId: number): Promise<RideRequest | null> {
    return this.rides.getRide(rideId)
  }

  async getRideForCustomer(rideId: number, customerUserId: number): Promise<RideRequest | null> {
    const ride = await this.rides.getRide(rideId)
    if (!ride || ride.customerUserId !== customerUserId) return null
    return ride
  }

  async transition(rideId: number, actorUserId: number, actorRole: 'customer' | 'driver' | 'admin' | 'system', next: RideStatus, note?: string): Promise<RideRequest> {
    const current = await this.rides.getRide(rideId)
    if (!current) throw new Error('Ride not found')
    if (!TRANSITIONS[current.status].includes(next)) throw new Error(`Invalid ride transition: ${current.status} -> ${next}`)
    if (actorRole === 'customer' && current.customerUserId !== actorUserId) throw new Error('Ride is not owned by this customer')
    if (actorRole === 'customer' && !['cancelled'].includes(next)) throw new Error('Customer may only cancel a ride')
    const event = { rideId, fromStatus: current.status, toStatus: next, actorUserId, actorRole, note: note ?? null }
    const updated = await this.rides.transitionRide(rideId, current.status, next, event)
    await this.audit.record(event)
    return updated
  }

  async assignDriver(rideId: number, actorUserId: number, driver: DriverEligibility): Promise<RideRequest> {
    const ride = await this.rides.getRide(rideId)
    if (!ride) throw new Error('Ride not found')
    if (ride.status !== 'searching') throw new Error('Ride is no longer searching for a driver')
    if (!driver.verified || !driver.operational) throw new Error('Driver is not eligible')
    if (driver.vehicleCategory !== ride.vehicleCategory) throw new Error('Driver vehicle category is not eligible for this ride')
    if (!driver.serviceZones.includes(ride.pickupZone)) throw new Error('Driver is not eligible for the pickup zone')
    const event = { rideId, fromStatus: 'searching' as const, toStatus: 'driver_assigned' as const, actorUserId, actorRole: 'system' as const, note: 'Driver assigned atomically' }
    const updated = await this.rides.assignDriver(rideId, driver.driverId, event)
    await this.audit.record(event)
    return updated
  }
}
