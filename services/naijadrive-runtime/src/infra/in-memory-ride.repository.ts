import type { AuditPort, DriverPresencePort, RideGeographyInput, RideRepository, RideRequest, RideStatusEvent } from '../domain/types.js'
import { ABUJA_ZONES } from '../config/abuja.js'

export class InMemoryRideRepository implements RideRepository {
  private nextId = 1
  private rides = new Map<number, RideRequest>()
  readonly events: RideStatusEvent[] = []

  async createRide(input: Omit<RideRequest, 'id' | 'status' | 'assignedDriverId' | 'cancellationReason' | 'createdAt'>): Promise<RideRequest> {
    const ride: RideRequest = {
      ...input,
      id: this.nextId++,
      status: 'requested',
      assignedDriverId: null,
      cancellationReason: null,
      createdAt: new Date().toISOString(),
    }
    this.rides.set(ride.id, ride)
    return { ...ride }
  }

  async validateRideGeography(input: RideGeographyInput): Promise<void> {
    for (const point of [input.pickup, input.dropoff]) {
      if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90) throw new Error('Invalid geographic coordinates')
      if (!Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) throw new Error('Invalid geographic coordinates')
    }
    for (const [point, zoneKey] of [[input.pickup, input.pickupZone], [input.dropoff, input.dropoffZone]] as const) {
      const zone = ABUJA_ZONES.find((candidate) => candidate.key === zoneKey && candidate.active)
      if (!zone || haversineKm(point.latitude, point.longitude, zone.center.latitude, zone.center.longitude) > zone.radiusKm) {
        throw new Error('Pickup and drop-off coordinates are outside the configured service boundary')
      }
    }
  }

  async getRide(rideId: number): Promise<RideRequest | null> {
    const ride = this.rides.get(rideId)
    return ride ? { ...ride } : null
  }

  async transitionRide(rideId: number, expected: RideRequest['status'], next: RideRequest['status'], event: RideStatusEvent): Promise<RideRequest> {
    const ride = this.rides.get(rideId)
    if (!ride || ride.status !== expected) throw new Error('Ride changed before this transition could be committed')
    ride.status = next
    ride.updatedAt = new Date().toISOString()
    if (next === 'cancelled') ride.cancellationReason = event.note
    this.events.push(event)
    return { ...ride }
  }

  async assignDriver(rideId: number, driverId: number, event: RideStatusEvent): Promise<RideRequest> {
    const ride = this.rides.get(rideId)
    if (!ride || ride.status !== 'searching' || ride.assignedDriverId !== null) throw new Error('Ride is already assigned or unavailable')
    ride.assignedDriverId = driverId
    ride.status = 'driver_assigned'
    ride.updatedAt = new Date().toISOString()
    this.events.push(event)
    return { ...ride }
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export class InMemoryPresencePort implements DriverPresencePort {
  private readonly presence = new Map<number, { driverId: number; vehicleId: number; vehicleCategory: string; zoneKey: string; expiresAt: string; availabilityStatus?: string }>()
  readonly claims = new Set<string>()

  set(driverId: number, value: { vehicleId: number; vehicleCategory: string; zoneKey: string; expiresAt: string; availabilityStatus?: string }): void {
    this.presence.set(driverId, { driverId, ...value })
  }

  async get(driverId: number) {
    const value = this.presence.get(driverId)
    if (!value || Date.parse(value.expiresAt) <= Date.now()) return null
    return value
  }

  async claimAssignment(driverId: number, rideId: number): Promise<boolean> {
    const key = `${driverId}:${rideId}`
    if ([...this.claims].some((claim) => claim.startsWith(`${driverId}:`))) return false
    this.claims.add(key)
    return true
  }

  async releaseAssignment(driverId: number, rideId: number): Promise<boolean> {
    return this.claims.delete(`${driverId}:${rideId}`)
  }
}

export class InMemoryAuditPort implements AuditPort {
  readonly events: RideStatusEvent[] = []
  async record(event: RideStatusEvent): Promise<void> {
    this.events.push(event)
  }
}
