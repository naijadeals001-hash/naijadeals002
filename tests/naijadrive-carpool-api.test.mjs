import assert from 'node:assert/strict'
import test from 'node:test'
import { execD1, queryOneD1, registerUser, RUN_NONCE } from './marketplace-engine/helpers/client.mjs'

let previousDriveEnabled, previousDriveStatus, previousNgStatus

test.before(async () => {
  previousDriveEnabled = await queryOneD1("SELECT enabled FROM cc_capabilities WHERE key='ecosystem.naijadrive'")
  previousDriveStatus = await queryOneD1("SELECT status FROM cc_capabilities WHERE key='ecosystem.naijadrive'")
  previousNgStatus = await queryOneD1("SELECT status FROM cc_countries WHERE iso_code='NG'")
  await execD1("UPDATE cc_capabilities SET enabled=1, status='ACTIVE' WHERE key='ecosystem.naijadrive'; UPDATE cc_countries SET status='LIVE' WHERE iso_code='NG';")
})

test.after(async () => {
  await execD1(`DELETE FROM carpool_requests WHERE trip_id IN (SELECT id FROM carpool_trips WHERE notes LIKE 'carpool-api-${RUN_NONCE}%'); DELETE FROM carpool_trips WHERE notes LIKE 'carpool-api-${RUN_NONCE}%'; DELETE FROM users WHERE email LIKE 'mkttest_carpool-api-%_${RUN_NONCE}_%@test.ng'; UPDATE cc_capabilities SET enabled=${previousDriveEnabled?.enabled ?? 0}, status='${previousDriveStatus?.status ?? 'ACTIVE'}' WHERE key='ecosystem.naijadrive'; UPDATE cc_countries SET status='${previousNgStatus?.status ?? 'LIVE'}' WHERE iso_code='NG';`)
})

test('carpool transaction boundary blocks new trips when NaijaDrive is disabled', async () => {
  const driver = await registerUser('carpool-rollout-blocked')
  await execD1("UPDATE cc_capabilities SET enabled=0 WHERE key='ecosystem.naijadrive'")
  const before = await queryOneD1(`SELECT COUNT(*) AS count FROM carpool_trips WHERE notes LIKE 'carpool-rollout-${RUN_NONCE}%'`)
  const response = await driver.client.post('/api/carpool/trips', { origin: 'Wuse', destination: 'Gwarinpa', departure_at: '2099-01-01 09:00:00', seats_total: 1, contribution_kobo: 1000, notes: `carpool-rollout-${RUN_NONCE}-blocked` })
  assert.equal(response.status, 409, JSON.stringify(response.body))
  assert.equal(response.body.code, 'VERTICAL_DISABLED')
  const after = await queryOneD1(`SELECT COUNT(*) AS count FROM carpool_trips WHERE notes LIKE 'carpool-rollout-${RUN_NONCE}%'`)
  assert.equal(Number(after.count), Number(before.count))
  await execD1("UPDATE cc_capabilities SET enabled=1, status='ACTIVE' WHERE key='ecosystem.naijadrive'")
})

test('carpool passenger requests and driver decisions use owned persisted APIs', async () => {
  const driver = await registerUser('carpool-api-driver')
  const passenger = await registerUser('carpool-api-passenger')
  const trip = await driver.client.post('/api/carpool/trips', {
    origin: 'Wuse',
    destination: 'Gwarinpa',
    departure_at: '2099-01-01 09:00:00',
    seats_total: 1,
    contribution_kobo: 150000,
    notes: `carpool-api-${RUN_NONCE}-trip`,
  })
  assert.equal(trip.status, 201, JSON.stringify(trip.body))

  const search = await passenger.client.get('/api/carpool/trips?origin=Wuse&destination=Gwarinpa')
  assert.equal(search.status, 200, JSON.stringify(search.body))
  assert.ok(search.body.trips.some((candidate) => candidate.id === trip.body.id))

  const request = await passenger.client.post(`/api/carpool/trips/${trip.body.id}/requests`, { seats: 1 })
  assert.equal(request.status, 201, JSON.stringify(request.body))
  assert.equal((await passenger.client.post(`/api/carpool/requests/${request.body.id}/decision`, { status: 'accepted' })).status, 404)

  const inbox = await driver.client.get('/api/carpool/driver/requests')
  assert.equal(inbox.status, 200, JSON.stringify(inbox.body))
  assert.equal(inbox.body.requests.find((item) => item.id === request.body.id).status, 'requested')

  const decision = await driver.client.post(`/api/carpool/requests/${request.body.id}/decision`, { status: 'accepted' })
  assert.equal(decision.status, 200, JSON.stringify(decision.body))
  assert.equal(decision.body.status, 'accepted')
  assert.equal((await queryOneD1(`SELECT status,seats_available FROM carpool_trips WHERE id=${trip.body.id}`)).seats_available, 0)
  assert.equal((await queryOneD1(`SELECT status FROM carpool_requests WHERE id=${request.body.id}`)).status, 'accepted')

  const cancelled = await passenger.client.post(`/api/carpool/requests/${request.body.id}/cancel`, {})
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
  assert.equal(cancelled.body.status, 'cancelled')
  assert.deepEqual(await queryOneD1(`SELECT status,seats_available FROM carpool_trips WHERE id=${trip.body.id}`), { status: 'published', seats_available: 1 })
  assert.equal((await queryOneD1(`SELECT status FROM carpool_requests WHERE id=${request.body.id}`)).status, 'cancelled')
  assert.equal((await driver.client.post(`/api/carpool/requests/${request.body.id}/cancel`, {})).status, 404)
})
