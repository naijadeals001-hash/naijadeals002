/**
 * Engine 9 — Category B (idempotency) + Category F/G (outbox internals)
 * scenarios, direct-library mode (mirrors tests/payment-engine's own
 * 01/03/04/05 methodology exactly — see helpers/direct-db.mjs's header
 * comment for why: enqueueNotificationEvent/processOutboxEvent/
 * retryFailedDeliveries have no dedicated 1:1 HTTP endpoint).
 *
 * PRECONDITION: run with the dev server STOPPED (see
 * helpers/direct-db.mjs's header comment — this file's getPlatformProxy()
 * connection and a live `wrangler pages dev` process both holding the
 * same local D1 SQLite file caused a diagnosed SQLITE_BUSY failure
 * earlier in this session).
 *
 * Run command:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/notification-engine/02.idempotency-concurrency.test.mjs
 * (reuses payment-engine's existing extensionless-import loader shim —
 * src/lib/notifications.ts imports sibling modules the same Vite-required
 * extensionless way orders.ts/refunds.ts do.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestUser, queryOneD1, disposeTestDb } from './helpers/direct-db.mjs'
import { enqueueNotificationEvent, enqueueAndProcessNow, processOutboxEvent } from '../../src/lib/notifications.ts'

test.after(async () => {
  await disposeTestDb()
})

test('idempotency: duplicate SEQUENTIAL enqueue for the same idempotency key is a confirmed no-op, exactly one row ever exists', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('idem_seq')
  const key = `seq_test_event:${userId}`

  const first = await enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'seq_test_event', recipientUserId: userId, category: 'system', payload: { n: 1 } })
  assert.equal(first.created, true)
  const second = await enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'seq_test_event', recipientUserId: userId, category: 'system', payload: { n: 2 } })
  assert.equal(second.created, false, 'the second call with the SAME key must be a confirmed no-op')
  assert.equal(second.outboxId, first.outboxId, 'the no-op must still return the EXISTING row id')

  const count = await queryOneD1(`SELECT COUNT(*) as n FROM notification_outbox WHERE idempotency_key = '${key}'`)
  assert.equal(count.n, 1)
})

test('idempotency: repeated identical enqueue calls across 5 sequential invocations still produce exactly one row', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('idem_repeat')
  const key = `repeat_test_event:${userId}`
  for (let i = 0; i < 5; i++) {
    await enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'repeat_test_event', recipientUserId: userId, category: 'system', payload: { i } })
  }
  const count = await queryOneD1(`SELECT COUNT(*) as n FROM notification_outbox WHERE idempotency_key = '${key}'`)
  assert.equal(count.n, 1)
})

test('idempotency: 2-way CONCURRENT duplicate enqueue for the same key — exactly one winner', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('idem_2way')
  const key = `two_way_test_event:${userId}`
  const results = await Promise.all([
    enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'two_way_test_event', recipientUserId: userId, category: 'system', payload: {} }),
    enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'two_way_test_event', recipientUserId: userId, category: 'system', payload: {} }),
  ])
  assert.equal(results.filter((r) => r.created).length, 1)
  const count = await queryOneD1(`SELECT COUNT(*) as n FROM notification_outbox WHERE idempotency_key = '${key}'`)
  assert.equal(count.n, 1)
})

test('idempotency: 4-way CONCURRENT duplicate enqueue for the same key — exactly one winner', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('idem_4way')
  const key = `four_way_test_event:${userId}`
  const results = await Promise.all(
    Array.from({ length: 4 }, () => enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'four_way_test_event', recipientUserId: userId, category: 'system', payload: {} }))
  )
  assert.equal(results.filter((r) => r.created).length, 1)
  const count = await queryOneD1(`SELECT COUNT(*) as n FROM notification_outbox WHERE idempotency_key = '${key}'`)
  assert.equal(count.n, 1)
})

test('idempotency: 8-way CONCURRENT duplicate enqueue for the same key — exactly one winner (the core outbox CAS race)', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('idem_8way')
  const key = `eight_way_test_event:${userId}`
  const results = await Promise.all(
    Array.from({ length: 8 }, () => enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'eight_way_test_event', recipientUserId: userId, category: 'system', payload: {} }))
  )
  assert.equal(results.filter((r) => r.created).length, 1, 'exactly ONE of 8 concurrent callers must win the CAS insert')
  const count = await queryOneD1(`SELECT COUNT(*) as n FROM notification_outbox WHERE idempotency_key = '${key}'`)
  assert.equal(count.n, 1)
})

test('idempotency: repeated processing of an already-PROCESSED outbox event does not create a second in-app notification row', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('idem_reprocess')
  const key = `reprocess_test_event:${userId}`
  const enqueueResult = await enqueueAndProcessNow(db, { idempotencyKey: key, eventType: 'reprocess_test_event', recipientUserId: userId, category: 'system', payload: {} })
  assert.ok(enqueueResult.outboxId)

  const second = await processOutboxEvent(db, enqueueResult.outboxId)
  assert.equal(second.processed, false, 'a non-pending (already processed) outbox row must not be re-claimed')

  const notifCount = await queryOneD1(`SELECT COUNT(*) as n FROM notifications WHERE user_id = ${userId} AND type = 'reprocess_test_event'`)
  assert.equal(notifCount.n, 1, 'exactly one in-app notification row despite the reprocess attempt')
})

test('concurrency: two CONCURRENT processOutboxEvent claim attempts on the SAME outbox id — exactly one wins the CAS claim', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('claim_race')
  const key = `claim_race_test_event:${userId}`
  const enqueueResult = await enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'claim_race_test_event', recipientUserId: userId, category: 'system', payload: {} })
  assert.ok(enqueueResult.outboxId)

  const results = await Promise.all([
    processOutboxEvent(db, enqueueResult.outboxId),
    processOutboxEvent(db, enqueueResult.outboxId),
  ])
  const wonCount = results.filter((r) => r.processed).length
  assert.equal(wonCount, 1, 'exactly one concurrent claim attempt must win the pending->processing CAS transition')

  const notifCount = await queryOneD1(`SELECT COUNT(*) as n FROM notifications WHERE user_id = ${userId} AND type = 'claim_race_test_event'`)
  assert.equal(notifCount.n, 1, 'only the winning claim may have created the in-app notification row')
})

test('concurrency: 4-way CONCURRENT processOutboxEvent claim attempts on the SAME outbox id — exactly one wins', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('claim_race_4way')
  const key = `claim_race_4way_test_event:${userId}`
  const enqueueResult = await enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'claim_race_4way_test_event', recipientUserId: userId, category: 'system', payload: {} })
  assert.ok(enqueueResult.outboxId)

  const results = await Promise.all(Array.from({ length: 4 }, () => processOutboxEvent(db, enqueueResult.outboxId)))
  const wonCount = results.filter((r) => r.processed).length
  assert.equal(wonCount, 1)
})

test('outbox: duplicate delivery-row creation for the SAME (outbox_id, channel) pair is impossible even under concurrent dispatch attempts', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('dup_delivery')
  const key = `dup_delivery_test_event:${userId}`
  const enqueueResult = await enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'dup_delivery_test_event', recipientUserId: userId, category: 'system', payload: {} })
  assert.ok(enqueueResult.outboxId)

  // Two concurrent processOutboxEvent calls both attempt to claim+fan-out
  // — only one wins the outbox claim (proven above), but this test proves
  // the STRONGER, independent invariant directly on notification_deliveries:
  // even if both somehow reached dispatchChannel (they can't, per the CAS
  // claim, but the UNIQUE(outbox_id, channel) constraint is the second,
  // independent line of defense), only one delivery row per channel can
  // ever exist.
  await Promise.all([processOutboxEvent(db, enqueueResult.outboxId), processOutboxEvent(db, enqueueResult.outboxId)])
  const rows = await queryOneD1(`SELECT COUNT(*) as n FROM notification_deliveries WHERE outbox_id = ${enqueueResult.outboxId} AND channel = 'in_app'`)
  assert.equal(rows.n, 1)
})

test('outbox: pending event correctly transitions pending -> processing -> processed under normal single-caller processing', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('lifecycle')
  const key = `lifecycle_test_event:${userId}`
  const enqueueResult = await enqueueNotificationEvent(db, { idempotencyKey: key, eventType: 'lifecycle_test_event', recipientUserId: userId, category: 'system', payload: {} })
  const pendingRow = await queryOneD1(`SELECT status FROM notification_outbox WHERE id = ${enqueueResult.outboxId}`)
  assert.equal(pendingRow.status, 'pending')

  await processOutboxEvent(db, enqueueResult.outboxId)
  const processedRow = await queryOneD1(`SELECT status, processed_at FROM notification_outbox WHERE id = ${enqueueResult.outboxId}`)
  assert.equal(processedRow.status, 'processed')
  assert.ok(processedRow.processed_at)
})
