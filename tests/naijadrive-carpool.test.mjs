import assert from 'node:assert/strict'
import test from 'node:test'
import { disposeTestDb, getTestDb, RUN_NONCE, createTestUser } from './payment-engine/helpers/db.mjs'

test.after(async () => {
  const db = await getTestDb()
  await db.batch([
    db.prepare('DELETE FROM carpool_requests WHERE trip_id IN (SELECT id FROM carpool_trips WHERE notes LIKE ?)').bind(`carpool-${RUN_NONCE}%`),
    db.prepare('DELETE FROM carpool_trips WHERE notes LIKE ?').bind(`carpool-${RUN_NONCE}%`),
    db.prepare('DELETE FROM users WHERE email LIKE ?').bind(`paytest_carpool_${RUN_NONCE}%`),
  ])
  await disposeTestDb()
})

test('carpool seat inventory is separate from private rides and cannot overbook', { concurrency: false }, async () => {
  const db = await getTestDb()
  const driver = await createTestUser(`carpool_${RUN_NONCE}_driver`)
  const passengerA = await createTestUser(`carpool_${RUN_NONCE}_a`)
  const passengerB = await createTestUser(`carpool_${RUN_NONCE}_b`)
  const trip = Number((await db.prepare(`INSERT INTO carpool_trips (driver_user_id, origin, destination, departure_at, seats_total, seats_available, contribution_kobo, notes) VALUES (?, 'Wuse', 'Gwarinpa', datetime('now', '+1 day'), 1, 1, 150000, ?)`).bind(driver, `carpool-${RUN_NONCE}-trip`).run()).meta.last_row_id)

  const [updatedA, requestA] = await db.batch([
    db.prepare(`UPDATE carpool_trips SET seats_available = seats_available - 1, status = 'full' WHERE id = ? AND status = 'published' AND seats_available >= 1`).bind(trip),
    db.prepare('INSERT INTO carpool_requests (trip_id, passenger_user_id, seats_requested) VALUES (?, ?, 1)').bind(trip, passengerA),
  ])
  assert.ok(updatedA.meta.rows_written >= 1)
  assert.ok(requestA.meta.last_row_id)

  const secondClaim = await db.prepare(`UPDATE carpool_trips SET seats_available = seats_available - 1 WHERE id = ? AND status = 'published' AND seats_available >= 1`).bind(trip).run()
  assert.equal(secondClaim.meta.rows_written, 0)
  const full = await db.prepare('SELECT status, seats_available FROM carpool_trips WHERE id = ?').bind(trip).first()
  assert.deepEqual(full, { status: 'full', seats_available: 0 })

  await db.prepare('UPDATE carpool_requests SET status = \'rejected\' WHERE id = ?').bind(requestA.meta.last_row_id).run()
  await db.prepare(`UPDATE carpool_trips SET seats_available = seats_available + 1, status = 'published' WHERE id = ? AND status = 'full'`).bind(trip).run()
  const reopened = await db.prepare('SELECT status, seats_available FROM carpool_trips WHERE id = ?').bind(trip).first()
  assert.deepEqual(reopened, { status: 'published', seats_available: 1 })
  assert.ok(passengerB)
})
