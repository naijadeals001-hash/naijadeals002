import test from 'node:test'
import assert from 'node:assert/strict'
import { RideService } from '../src/domain/ride.service.js'
import { InMemoryAuditPort, InMemoryRideRepository } from '../src/infra/in-memory-ride.repository.js'

function setup() {
  const repository = new InMemoryRideRepository()
  const audit = new InMemoryAuditPort()
  return { service: new RideService(repository, audit), repository, audit }
}

const rideInput = {
  customerUserId: 10,
  pickup: { latitude: 9.0579, longitude: 7.4951 },
  dropoff: { latitude: 9.1057, longitude: 7.4042 },
  pickupZone: 'abuja-central',
  dropoffZone: 'gwarinpa',
  vehicleCategory: 'car' as const,
  distanceKm: 12,
  durationMinutes: 28,
}

test('creates an Abuja private ride with integer-kobo fare and audit event', async () => {
  const { service, audit } = setup()
  const ride = await service.createRide(rideInput)
  assert.equal(ride.status, 'requested')
  assert.equal(ride.estimatedFareKobo, 290000)
  assert.equal(audit.events.length, 1)
  assert.equal(audit.events[0].toStatus, 'requested')
})

test('rejects pickup or drop-off outside active Abuja zones', async () => {
  const { service } = setup()
  await assert.rejects(() => service.createRide({ ...rideInput, pickupZone: 'airport-axis' }), /active Abuja pilot zones/)
})

test('rejects vehicle categories not yet regulatory-approved for Abuja', async () => {
  const { service } = setup()
  await assert.rejects(() => service.createRide({ ...rideInput, vehicleCategory: 'motorcycle' }), /not enabled for the Abuja pilot/)
})

test('enforces lifecycle and customer authorization', async () => {
  const { service } = setup()
  const ride = await service.createRide(rideInput)
  await assert.rejects(() => service.transition(ride.id, 99, 'customer', 'cancelled', 'unauthorized'), /not owned/)
  await assert.rejects(() => service.transition(ride.id, 10, 'customer', 'completed'), /Invalid ride transition/)
  const cancelled = await service.transition(ride.id, 10, 'customer', 'cancelled', 'Customer changed plans')
  assert.equal(cancelled.status, 'cancelled')
})

test('requires verified operational driver with matching zone and vehicle', async () => {
  const { service } = setup()
  const ride = await service.createRide(rideInput)
  await service.transition(ride.id, 10, 'system', 'searching')
  await assert.rejects(() => service.assignDriver(ride.id, 99, { driverId: 20, vehicleId: 1, vehicleCategory: 'motorcycle', verified: true, operational: true, serviceZones: ['abuja-central'] }), /vehicle category/)
  await assert.rejects(() => service.assignDriver(ride.id, 99, { driverId: 20, vehicleId: 1, vehicleCategory: 'car', verified: true, operational: true, serviceZones: ['gwarinpa'] }), /pickup zone/)
  const assigned = await service.assignDriver(ride.id, 99, { driverId: 20, vehicleId: 1, vehicleCategory: 'car', verified: true, operational: true, serviceZones: ['abuja-central'] })
  assert.equal(assigned.assignedDriverId, 20)
  assert.equal(assigned.status, 'driver_assigned')
})

test('prevents duplicate driver assignments and records assignment audit event', async () => {
  const { service, audit } = setup()
  const ride = await service.createRide(rideInput)
  await service.transition(ride.id, 10, 'system', 'searching')
  const attempts = await Promise.allSettled([
    service.assignDriver(ride.id, 99, { driverId: 20, vehicleId: 1, vehicleCategory: 'car', verified: true, operational: true, serviceZones: ['abuja-central'] }),
    service.assignDriver(ride.id, 99, { driverId: 21, vehicleId: 2, vehicleCategory: 'car', verified: true, operational: true, serviceZones: ['abuja-central'] }),
  ])
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1)
  assert.equal(audit.events.length, 3)
})
