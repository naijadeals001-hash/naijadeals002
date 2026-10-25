import test from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, cleanupRunNonce, queryOneD1, execD1, RUN_NONCE } from './marketplace-engine/helpers/client.mjs'

let customer, driver

test.before(async () => {
  customer = await registerUser('ride-customer')
  driver = await registerUser('ride-driver')
  await execD1(`INSERT INTO driver_profiles (user_id,license_number,country_iso,status,is_online) VALUES (${driver.userId}, 'LIC-${RUN_NONCE}', 'NG', 'active', 1)`)
})
test.after(async () => { await execD1(`DELETE FROM drive_ride_events; DELETE FROM drive_ride_offers; DELETE FROM drive_ride_requests; DELETE FROM driver_profiles WHERE license_number = 'LIC-${RUN_NONCE}';`); await cleanupRunNonce(RUN_NONCE) })

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

test('invalid zones and unauthenticated ride creation fail closed', async () => {
  const bad = await customer.client.post('/api/drive/rides', { pickupZone: 'unknown', dropoffZone: 'gwarinpa', idempotencyKey: `bad-${RUN_NONCE}` })
  assert.equal(bad.status, 400)
  const guest = await fetch('http://localhost:3000/api/drive/rides', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pickupZone: 'abuja-central', dropoffZone: 'gwarinpa' }) })
  assert.equal(guest.status, 401)
})
