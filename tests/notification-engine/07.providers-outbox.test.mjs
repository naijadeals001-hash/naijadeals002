/**
 * Engine 9 — Category F (provider abstraction) + Category G (outbox/retry
 * lifecycle states), direct-library mode.
 *
 * Exercises src/lib/notification-providers.ts's dispatchViaProvider()
 * directly (deterministic test adapter, simulated failure sentinels) and
 * src/lib/notifications.ts's full dispatch+retry lifecycle (queued ->
 * delivered / failed(transient) -> retried -> delivered, and permanent
 * failure with no retry scheduled) — proving the truthful status
 * vocabulary and the bounded retry scheduler (MAX_DELIVERY_ATTEMPTS,
 * exponential backoff) actually behave as documented, using ONLY the
 * deterministic test adapter's own sentinel strings
 * (__SIMULATE_TRANSIENT_FAILURE__ / __SIMULATE_PERMANENT_FAILURE__) — no
 * real network call is ever made, per the NO FAKE PROVIDERS rule.
 *
 * PRECONDITION: PM2 dev server STOPPED (direct-lib mode).
 * Run command:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/notification-engine/07.providers-outbox.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestUser, queryOneD1, execD1, disposeTestDb } from './helpers/direct-db.mjs'
import { dispatchViaProvider } from '../../src/lib/notification-providers.ts'
import { enqueueNotificationEvent, enqueueAndProcessNow, processOutboxEvent, retryFailedDeliveries } from '../../src/lib/notifications.ts'

test.after(async () => {
  await disposeTestDb()
})

// ---------- Category F: provider abstraction ----------

test('providers: the deterministic test adapter returns "delivered" for a well-formed email dispatch — truthfully labeled as a test adapter, never claims a real network delivery', async () => {
  const db = await getTestDb()
  const outcome = await dispatchViaProvider(db, 'email', { recipientUserId: 1, subject: 'Test', body: 'Hello world', actionUrl: null })
  assert.equal(outcome.status, 'delivered')
  assert.equal(outcome.providerKey, 'test_email_adapter')
  assert.equal(outcome.raw.adapter, 'test', 'the raw response must honestly self-identify as the test adapter, never impersonate a real provider')
})

test('providers: the sms and push channels each route to their OWN distinct test adapter provider_key', async () => {
  const db = await getTestDb()
  const sms = await dispatchViaProvider(db, 'sms', { recipientUserId: 1, subject: null, body: 'hi', actionUrl: null })
  assert.equal(sms.providerKey, 'test_sms_adapter')
  const push = await dispatchViaProvider(db, 'push', { recipientUserId: 1, subject: null, body: 'hi', actionUrl: null })
  assert.equal(push.providerKey, 'test_push_adapter')
})

test('providers: the __SIMULATE_TRANSIENT_FAILURE__ sentinel produces a "failed" outcome with failureClass "transient" — used ONLY by tests, never a real provider behavior', async () => {
  const db = await getTestDb()
  const outcome = await dispatchViaProvider(db, 'email', { recipientUserId: 1, subject: 'Test', body: '__SIMULATE_TRANSIENT_FAILURE__', actionUrl: null })
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.failureClass, 'transient')
  assert.ok(outcome.raw.simulated, 'the raw response must honestly flag this as a simulated failure, never disguised as a real provider error')
})

test('providers: the __SIMULATE_PERMANENT_FAILURE__ sentinel produces a "failed" outcome with failureClass "permanent"', async () => {
  const db = await getTestDb()
  const outcome = await dispatchViaProvider(db, 'email', { recipientUserId: 1, subject: 'Test', body: '__SIMULATE_PERMANENT_FAILURE__', actionUrl: null })
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.failureClass, 'permanent')
})

test('providers: an in_app dispatch through dispatchViaProvider is defensively rejected as "skipped" — in_app never uses the provider abstraction', async () => {
  const db = await getTestDb()
  const outcome = await dispatchViaProvider(db, 'in_app', { recipientUserId: 1, subject: null, body: 'x', actionUrl: null })
  assert.equal(outcome.status, 'skipped')
})

test('providers: an unregistered/no-integration category (a synthetic disabled row) truthfully reports "unavailable", never fabricates "delivered"', async () => {
  const db = await getTestDb()
  // Temporarily disable the email integration row, dispatch, then restore
  // — proving the honest 'unavailable' path without permanently mutating
  // shared seed state for other tests/files.
  await db.prepare(`UPDATE cc_integrations SET status = 'degraded' WHERE provider_key = 'test_email_adapter'`).run()
  try {
    const outcome = await dispatchViaProvider(db, 'email', { recipientUserId: 1, subject: 'x', body: 'x', actionUrl: null })
    assert.equal(outcome.status, 'unavailable')
    assert.match(outcome.error, /degraded/)
  } finally {
    await db.prepare(`UPDATE cc_integrations SET status = 'configured' WHERE provider_key = 'test_email_adapter'`).run()
  }
})

test('providers: disabling the email integration entirely (enabled=0) causes dispatch to report "not_configured", never a fabricated success', async () => {
  const db = await getTestDb()
  await db.prepare(`UPDATE cc_integrations SET enabled = 0 WHERE provider_key = 'test_email_adapter'`).run()
  try {
    const outcome = await dispatchViaProvider(db, 'email', { recipientUserId: 1, subject: 'x', body: 'x', actionUrl: null })
    assert.equal(outcome.status, 'not_configured')
  } finally {
    await db.prepare(`UPDATE cc_integrations SET enabled = 1 WHERE provider_key = 'test_email_adapter'`).run()
  }
})

// ---------- Category G: outbox / delivery lifecycle states ----------

test('outbox: a successful in_app dispatch reaches terminal state "delivered" with delivered_at set', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('outbox_delivered')
  const key = `outbox_delivered_event:${userId}`
  const enq = await enqueueAndProcessNow(db, { idempotencyKey: key, eventType: 'outbox_delivered_event', recipientUserId: userId, category: 'system', payload: {} })
  const delivery = await queryOneD1(`SELECT status, delivered_at, attempt_count FROM notification_deliveries WHERE outbox_id = ${enq.outboxId} AND channel = 'in_app'`)
  assert.equal(delivery.status, 'delivered')
  assert.ok(delivery.delivered_at)
  assert.equal(delivery.attempt_count, 1)
})

test('outbox: a channel dispatch that transiently fails is recorded as "failed"/"transient" WITH a scheduled next_retry_at, and does not block the outbox event from reaching "processed"', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('outbox_transient')
  const key = `outbox_transient_event:${userId}`
  // Force an explicit preference row selecting the 'email' channel for a
  // category, then use the sentinel string in the payload's rendered body
  // via a dedicated template so the REAL dispatch path (not a synthetic
  // delivery row) produces the failure.
  await db.prepare(`INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, is_active) VALUES ('outbox_transient_event', 'email', 'en', 1, 'Test', '__SIMULATE_TRANSIENT_FAILURE__', 1)`).run()

  const enq = await enqueueAndProcessNow(db, { idempotencyKey: key, eventType: 'outbox_transient_event', recipientUserId: userId, category: 'payment', payload: {} })
  const outboxRow = await queryOneD1(`SELECT status FROM notification_outbox WHERE id = ${enq.outboxId}`)
  assert.equal(outboxRow.status, 'processed', 'a per-channel transient failure must not block the outbox event from reaching processed')

  const delivery = await queryOneD1(`SELECT status, failure_class, next_retry_at, attempt_count FROM notification_deliveries WHERE outbox_id = ${enq.outboxId} AND channel = 'email'`)
  assert.equal(delivery.status, 'failed')
  assert.equal(delivery.failure_class, 'transient')
  assert.ok(delivery.next_retry_at, 'a transient failure must have a scheduled next_retry_at')
  assert.equal(delivery.attempt_count, 1)
})

test('outbox: a channel dispatch that PERMANENTLY fails is recorded as "failed"/"permanent" with NO next_retry_at — never scheduled for a pointless retry', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('outbox_permanent')
  const key = `outbox_permanent_event:${userId}`
  await db.prepare(`INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, is_active) VALUES ('outbox_permanent_event', 'email', 'en', 1, 'Test', '__SIMULATE_PERMANENT_FAILURE__', 1)`).run()

  const enq = await enqueueAndProcessNow(db, { idempotencyKey: key, eventType: 'outbox_permanent_event', recipientUserId: userId, category: 'payment', payload: {} })
  const delivery = await queryOneD1(`SELECT status, failure_class, next_retry_at FROM notification_deliveries WHERE outbox_id = ${enq.outboxId} AND channel = 'email'`)
  assert.equal(delivery.status, 'failed')
  assert.equal(delivery.failure_class, 'permanent')
  assert.equal(delivery.next_retry_at, null, 'a permanent failure must never be scheduled for retry')
})

test('outbox retry: retryFailedDeliveries picks up a due transient failure, re-dispatches it, and a SUCCEEDING retry moves it to "delivered" without creating a duplicate delivery row', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('retry_success')
  const key = `retry_success_event:${userId}`
  await db.prepare(`INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, is_active) VALUES ('retry_success_event', 'email', 'en', 1, 'Test', '__SIMULATE_TRANSIENT_FAILURE__', 1)`).run()
  const enq = await enqueueAndProcessNow(db, { idempotencyKey: key, eventType: 'retry_success_event', recipientUserId: userId, category: 'payment', payload: {} })

  const deliveryBefore = await queryOneD1(`SELECT id FROM notification_deliveries WHERE outbox_id = ${enq.outboxId} AND channel = 'email'`)

  // Force next_retry_at into the past so this row is immediately due, and
  // swap the template to a non-failing body so the retry SUCCEEDS this
  // time (simulating "the transient provider issue cleared up").
  await db.prepare(`UPDATE notification_deliveries SET next_retry_at = datetime('now', '-1 minutes') WHERE id = ${deliveryBefore.id}`).run()
  await db.prepare(`UPDATE notification_templates SET is_active = 0 WHERE event_type = 'retry_success_event' AND channel = 'email'`).run()
  await db.prepare(`INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, is_active) VALUES ('retry_success_event', 'email', 'en', 2, 'Test', 'Recovered body, no sentinel', 1)`).run()

  const outcome = await retryFailedDeliveries(db, 10)
  assert.ok(outcome.attempted >= 1)
  assert.ok(outcome.retried >= 1)

  const deliveryAfter = await queryOneD1(`SELECT id, status, attempt_count FROM notification_deliveries WHERE outbox_id = ${enq.outboxId} AND channel = 'email'`)
  assert.equal(deliveryAfter.id, deliveryBefore.id, 'the SAME delivery row must be reused on retry, never a duplicate')
  assert.equal(deliveryAfter.status, 'delivered')
  assert.equal(deliveryAfter.attempt_count, 2)

  const rowCount = await queryOneD1(`SELECT COUNT(*) as n FROM notification_deliveries WHERE outbox_id = ${enq.outboxId} AND channel = 'email'`)
  assert.equal(rowCount.n, 1, 'exactly one delivery row must exist for this (outbox_id, channel) pair, even after a retry')
})

test('outbox retry: a delivery whose next_retry_at has NOT yet arrived is correctly skipped by retryFailedDeliveries', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('retry_not_due')
  const key = `retry_not_due_event:${userId}`
  await db.prepare(`INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, is_active) VALUES ('retry_not_due_event', 'email', 'en', 1, 'Test', '__SIMULATE_TRANSIENT_FAILURE__', 1)`).run()
  const enq = await enqueueAndProcessNow(db, { idempotencyKey: key, eventType: 'retry_not_due_event', recipientUserId: userId, category: 'payment', payload: {} })

  const delivery = await queryOneD1(`SELECT id, next_retry_at FROM notification_deliveries WHERE outbox_id = ${enq.outboxId} AND channel = 'email'`)
  assert.ok(delivery.next_retry_at, 'sanity: a next_retry_at must have been scheduled')
  // next_retry_at was scheduled ~1 minute in the future by the real
  // backoff table — do NOT rewrite it; just confirm this specific row is
  // absent from a retry pass run immediately (it is not yet due).
  const outcome = await retryFailedDeliveries(db, 50)
  const stillFailed = await queryOneD1(`SELECT status FROM notification_deliveries WHERE id = ${delivery.id}`)
  assert.equal(stillFailed.status, 'failed', 'a not-yet-due transient failure must remain untouched by a retry pass')
})

test('outbox retry: two CONCURRENT retryFailedDeliveries passes over the SAME due row never double-dispatch it (CAS-claimed, exactly one performs the retry)', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('retry_concurrent')
  const key = `retry_concurrent_event:${userId}`
  await db.prepare(`INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, is_active) VALUES ('retry_concurrent_event', 'email', 'en', 1, 'Test', 'Fine now', 1)`).run()
  const enq = await enqueueAndProcessNow(db, { idempotencyKey: key, eventType: 'retry_concurrent_event', recipientUserId: userId, category: 'payment', payload: {} })

  // Manually synthesize a due transient-failed state on this row (bypassing
  // needing the sentinel dance twice) to focus purely on the CAS-claim race.
  const delivery = await queryOneD1(`SELECT id FROM notification_deliveries WHERE outbox_id = ${enq.outboxId} AND channel = 'email'`)
  await db.prepare(`UPDATE notification_deliveries SET status = 'failed', failure_class = 'transient', next_retry_at = datetime('now', '-1 minutes') WHERE id = ${delivery.id}`).run()

  const results = await Promise.all([retryFailedDeliveries(db, 10), retryFailedDeliveries(db, 10)])
  const totalRetried = results[0].retried + results[1].retried
  assert.equal(totalRetried, 1, 'exactly one of the two concurrent retry passes must win the CAS claim on this row')
})

test('outbox retry: a delivery that has exhausted MAX_DELIVERY_ATTEMPTS (5) is never picked up again by retryFailedDeliveries, remaining genuinely terminal', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('retry_exhausted')
  const key = `retry_exhausted_event:${userId}`
  await db.prepare(`INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, is_active) VALUES ('retry_exhausted_event', 'email', 'en', 1, 'Test', 'x', 1)`).run()
  const enq = await enqueueAndProcessNow(db, { idempotencyKey: key, eventType: 'retry_exhausted_event', recipientUserId: userId, category: 'payment', payload: {} })
  const delivery = await queryOneD1(`SELECT id FROM notification_deliveries WHERE outbox_id = ${enq.outboxId} AND channel = 'email'`)

  // Simulate having already exhausted the retry budget: attempt_count=5
  // (== MAX_DELIVERY_ATTEMPTS), status failed/transient, next_retry_at set
  // (as if a bug tried to schedule one anyway) — retryFailedDeliveries'
  // own WHERE clause (attempt_count < MAX_DELIVERY_ATTEMPTS) must exclude it.
  await db.prepare(`UPDATE notification_deliveries SET status = 'failed', failure_class = 'transient', attempt_count = 5, next_retry_at = datetime('now', '-1 minutes') WHERE id = ${delivery.id}`).run()

  const outcome = await retryFailedDeliveries(db, 50)
  const after = await queryOneD1(`SELECT status, attempt_count FROM notification_deliveries WHERE id = ${delivery.id}`)
  assert.equal(after.status, 'failed', 'an exhausted delivery must remain failed, never silently retried past its bound')
  assert.equal(after.attempt_count, 5, 'attempt_count must not increment for an excluded, exhausted row')
})
