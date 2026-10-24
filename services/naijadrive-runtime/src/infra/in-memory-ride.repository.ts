import type { AuditPort, RideRepository, RideRequest, RideStatusEvent } from '../domain/types.js'

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

export class InMemoryAuditPort implements AuditPort {
  readonly events: RideStatusEvent[] = []
  async record(event: RideStatusEvent): Promise<void> {
    this.events.push(event)
  }
}
