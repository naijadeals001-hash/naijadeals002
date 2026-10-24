export type RideStatus =
  | 'requested'
  | 'searching'
  | 'driver_assigned'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_driver'

export type VehicleCategory = 'motorcycle' | 'tricycle' | 'car' | 'van'

export interface GeoPoint {
  latitude: number
  longitude: number
}

export interface AbujaServiceZone {
  key: string
  name: string
  countryIso: 'NG'
  city: 'Abuja'
  center: GeoPoint
  radiusKm: number
  active: boolean
}

export interface FareRule {
  vehicleCategory: VehicleCategory
  baseFareKobo: number
  perKmKobo: number
  perMinuteKobo: number
  minimumFareKobo: number
  bookingFeeKobo: number
  cancellationFeeKobo: number
}

export interface DriverEligibility {
  driverId: number
  vehicleId: number
  vehicleCategory: VehicleCategory
  verified: boolean
  operational: boolean
  serviceZones: string[]
}

export interface RideRequest {
  id: number
  customerUserId: number
  pickup: GeoPoint
  dropoff: GeoPoint
  pickupZone: string
  dropoffZone: string
  vehicleCategory: VehicleCategory
  estimatedDistanceKm: number
  estimatedDurationMinutes: number
  estimatedFareKobo: number
  status: RideStatus
  assignedDriverId: number | null
  cancellationReason: string | null
  createdAt: string
  updatedAt: string
}

export interface RideStatusEvent {
  rideId: number
  fromStatus: RideStatus | null
  toStatus: RideStatus
  actorUserId: number | null
  actorRole: 'customer' | 'driver' | 'admin' | 'system'
  note: string | null
}

export interface RideRepository {
  createRide(input: Omit<RideRequest, 'id' | 'status' | 'assignedDriverId' | 'cancellationReason' | 'createdAt' | 'updatedAt'>): Promise<RideRequest>
  getRide(rideId: number): Promise<RideRequest | null>
  transitionRide(rideId: number, expected: RideStatus, next: RideStatus, event: RideStatusEvent): Promise<RideRequest>
  assignDriver(rideId: number, driverId: number, event: RideStatusEvent): Promise<RideRequest>
}

export interface AuditPort {
  record(event: RideStatusEvent): Promise<void>
}
