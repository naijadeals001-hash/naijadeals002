import test from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, cleanupRunNonce, queryOneD1, execD1, RUN_NONCE } from './marketplace-engine/helpers/client.mjs'

let customer, driver, driverTwo

test.before(async () => {
  customer = await registerUser('ride-customer')
  driver = await registerUser('ride-driver')
  driverTwo = await registerUser('ride-driver-two')
  await execD1(`INSERT INTO driver_profiles (user_id,license_number,country_iso,status,is_online,operational_status) VALUES (${driver.userId}, 'LIC-${RUN_NONCE}-1', 'NG', 'active', 1, 'available'), (${driverTwo.userId}, 'LIC-${RUN_NONCE}-2', 'NG', 'active', 1, 'available')`)
})
test.after(async () => { await execD1(`DELETE FROM drive_ride_events; DELETE FROM drive_ride_offers; DELETE FROM drive_ride_requests; DELETE FROM driver_profiles WHERE license_number LIKE 'LIC-${RUN_NONCE}%';`); await cleanupRunNonce(RUN_NONCE) })

test('private ride persists, retries idempotently, driver accepts, and lifecycle transitions are authorized', async () => {
  const payload = { pickupZone: 'abuja-central', dropoffZone: 'gwarinpa', vehicleCategory: 'car', idempotencyKey: `ride-${RUN_NONCE}` }
  const first = await customer.client.post('/api/drive/rides', payload)
  assert.equal(first.status, 201, JSON.stringify(first.body))
  const rideId = first.body.ride.id
  const retry = await customer.client.post('/api/drive/rides', payload)
  assert.equal(retry.status, 200)
  assert.equal(retry.body.ride.id, rideId)
  const offer = await driver.client.post(`/api/drive/rides/${rideId}/offers`, {})
  assert.equal(offer.status, 201, JSON.stringify(offer.body))
  const accepted = await driver.client.post(`/api/drive/driver/offers/${offer.body.id}/accept`, {})
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.equal((await customer.client.post(`/api/drive/driver/rides/${rideId}/transition`, { status: 'completed' })).status, 403)
  for (const status of ['driver_arriving','driver_arrived','in_progress','completed']) {
    const response = await driver.client.post(`/api/drive/driver/rides/${rideId}/transition`, { status })
    assert.equal(response.status, 200, `${status}: ${JSON.stringify(response.body)}`)
  }
  const stored = await queryOneD1(`SELECT status,fare_kobo,fare_mode FROM drive_ride_requests WHERE id=${rideId}`)
  assert.equal(stored.status, 'completed')
  assert.equal(stored.fare_mode, 'simulated')
})

test('concurrent acceptance permits exactly one driver assignment', async () => {
  const created = await customer.client.post('/api/drive/rides', { pickupZone: 'abuja-central', dropoffZone: 'gwarinpa', vehicleCategory: 'car', idempotencyKey: `race-${RUN_NONCE}` })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const rideId = created.body.ride.id
  const firstOffer = await driver.client.post(`/api/drive/rides/${rideId}/offers`, {})
  const secondOffer = await driverTwo.client.post(`/api/drive/rides/${rideId}/offers`, {})
  assert.equal(firstOffer.status, 201)
  assert.equal(secondOffer.status, 201)
  const results = await Promise.all([
    driver.client.post(`/api/drive/driver/offers/${firstOffer.body.id}/accept`, {}),
    driverTwo.client.post(`/api/drive/driver/offers/${secondOffer.body.id}/accept`, {}),
  ])
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
  const stored = await queryOneD1(`SELECT status,accepted_driver_profile_id FROM drive_ride_requests WHERE id=${rideId}`)
  assert.equal(stored.status, 'accepted')
  assert.ok(stored.accepted_driver_profile_id)
  const assigned = await queryOneD1(`SELECT COUNT(*) AS count FROM drive_ride_offers WHERE ride_request_id=${rideId} AND status='accepted'`)
  assert.equal(assigned.count, 1)
})

test('offer inbox, expiry, rejection and no-driver recovery are persisted', async () => {
  const created = await customer.client.post('/api/drive/rides', { pickupZone: 'abuja-central', dropoffZone: 'lokogoma', vehicleCategory: 'car', idempotencyKey: `recovery-${RUN_NONCE}` })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const rideId = created.body.ride.id
  const offered = await driver.client.post(`/api/drive/rides/${rideId}/offers`, {})
  const inbox = await driver.client.get('/api/drive/driver/offers')
  assert.equal(inbox.status, 200)
  assert.ok(inbox.body.offers.some((o) => o.id === offered.body.id))
  await execD1(`UPDATE drive_ride_offers SET expires_at = datetime('now','-1 minute') WHERE id = ${offered.body.id}`)
  const recovered = await driverTwo.client.get('/api/drive/driver/offers')
  assert.equal(recovered.status, 200)
  const expiredAccept = await driver.client.post(`/api/drive/driver/offers/${offered.body.id}/accept`, {})
  assert.equal(expiredAccept.status, 409)
  const next = recovered.body.offers.find((o) => o.ride_id === rideId && o.status === 'offered')
  assert.ok(next, JSON.stringify(recovered.body))
  const rejected = await driverTwo.client.post(`/api/drive/driver/offers/${next.id}/reject`, { reason: 'Unavailable' })
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body))
  const rejectedAccept = await driverTwo.client.post(`/api/drive/driver/offers/${next.id}/accept`, {})
  assert.equal(rejectedAccept.status, 409)
  const ride = await queryOneD1(`SELECT status FROM drive_ride_requests WHERE id = ${rideId}`)
  assert.equal(ride.status, 'no_driver_available')
  const events = await queryOneD1(`SELECT COUNT(*) AS count FROM drive_ride_events WHERE ride_request_id = ${rideId} AND note LIKE '%rejected%'`)
  assert.equal(events.count, 1)
})

test('invalid zones and unauthenticated ride creation fail closed', async () => {
  const bad = await customer.client.post('/api/drive/rides', { pickupZone: 'unknown', dropoffZone: 'gwarinpa', idempotencyKey: `bad-${RUN_NONCE}` })
  assert.equal(bad.status, 400)
  const guest = await fetch('http://localhost:3000/api/drive/rides', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pickupZone: 'abuja-central', dropoffZone: 'gwarinpa' }) })
  assert.equal(guest.status, 401)
})
