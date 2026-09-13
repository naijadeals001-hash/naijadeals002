/**
 * Engine 11 (Search & Discovery), Phase 1 — enqueueSearchIndexEvent()
 * idempotency, CAS-race, and stale-event-key scenarios. Direct-library
 * mode, mirroring tests/notification-engine/02.idempotency-concurrency
 * .test.mjs exactly — enqueueSearchIndexEvent() has no dedicated 1:1
 * HTTP endpoint (called inline from other library functions), so
 * calling it in-process via getPlatformProxy() is the correct layer to
 * prove the CAS/idempotency behavior is closed at the database boundary.
 *
 * PRECONDITION: run with the dev server STOPPED (see
 * helpers/direct-db.mjs's header comment).
 *
 * Run command:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/search-engine/01.enqueue-idempotency-concurrency.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestVendor, createTestProduct, queryOneD1, queryD1, disposeTestDb } from './helpers/direct-db.mjs'
import { enqueueSearchIndexEvent } from '../../src/lib/search-index-events.ts'

test.after(async () => {
  await disposeTestDb()
})

test('idempotency: duplicate SEQUENTIAL enqueue for the same (entity, operation, source_updated_at) is a confirmed no-op, exactly one row ever exists', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('idem_seq')
  const productId = await createTestProduct(vendorId, 'idem_seq')
  const sourceUpdatedAt = '2026-01-01 00:00:00'

  const first = await enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt })
  assert.equal(first.created, true)
  const second = await enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt })
  assert.equal(second.created, false, 'the second call with the SAME (entity, op, source_updated_at) must be a confirmed no-op')
  assert.equal(second.eventId, first.eventId, 'the no-op must still return the EXISTING row id')

  const count = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product' AND entity_id=${productId} AND source_updated_at='${sourceUpdatedAt}'`)
  assert.equal(count.n, 1)
})

test('idempotency: repeated identical enqueue calls across 5 sequential invocations still produce exactly one row', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('idem_repeat')
  const productId = await createTestProduct(vendorId, 'idem_repeat')
  const sourceUpdatedAt = '2026-01-02 00:00:00'
  for (let i = 0; i < 5; i++) {
    await enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt })
  }
  const count = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product' AND entity_id=${productId} AND source_updated_at='${sourceUpdatedAt}'`)
  assert.equal(count.n, 1)
})

test('idempotency: 2-way CONCURRENT duplicate enqueue for the same key — exactly one winner', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('idem_2way')
  const productId = await createTestProduct(vendorId, 'idem_2way')
  const sourceUpdatedAt = '2026-01-03 00:00:00'
  const results = await Promise.all([
    enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt }),
    enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt }),
  ])
  assert.equal(results.filter((r) => r.created).length, 1)
  const count = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product' AND entity_id=${productId} AND source_updated_at='${sourceUpdatedAt}'`)
  assert.equal(count.n, 1)
})

test('idempotency: 8-way CONCURRENT duplicate enqueue for the same key — exactly one winner (the core CAS race)', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('idem_8way')
  const productId = await createTestProduct(vendorId, 'idem_8way')
  const sourceUpdatedAt = '2026-01-04 00:00:00'
  const results = await Promise.all(
    Array.from({ length: 8 }, () => enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt }))
  )
  assert.equal(results.filter((r) => r.created).length, 1, 'exactly ONE of 8 concurrent callers must win the CAS insert')
  const count = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product' AND entity_id=${productId} AND source_updated_at='${sourceUpdatedAt}'`)
  assert.equal(count.n, 1)
})

test('ordering: a NEWER source_updated_at for the SAME entity produces a DISTINCT new row, not a duplicate', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('order_newer')
  const productId = await createTestProduct(vendorId, 'order_newer')

  const t1 = await enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt: '2026-02-01 00:00:00' })
  const t2 = await enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt: '2026-02-02 00:00:00' })
  assert.equal(t1.created, true)
  assert.equal(t2.created, true)
  assert.notEqual(t1.eventId, t2.eventId, 'two genuinely distinct updated_at values must produce two distinct events — this table is an append-only change log, not a single mutable row')

  const rows = await queryD1(`SELECT operation, source_updated_at, status FROM search_index_events WHERE entity_type='product' AND entity_id=${productId} ORDER BY source_updated_at ASC`)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].source_updated_at, '2026-02-01 00:00:00')
  assert.equal(rows[1].source_updated_at, '2026-02-02 00:00:00')
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[1].status, 'pending')
})

test('delete: a delete operation for an entity that has a prior upsert produces a DISTINCT new row (never mutates/overwrites the prior upsert row)', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('delete_after_upsert')
  const productId = await createTestProduct(vendorId, 'delete_after_upsert')

  const upsertResult = await enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt: '2026-03-01 00:00:00' })
  const deleteResult = await enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'delete', sourceUpdatedAt: '2026-03-02 00:00:00' })
  assert.equal(upsertResult.created, true)
  assert.equal(deleteResult.created, true)
  assert.notEqual(upsertResult.eventId, deleteResult.eventId)

  const rows = await queryD1(`SELECT operation FROM search_index_events WHERE entity_type='product' AND entity_id=${productId} ORDER BY id ASC`)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[1].operation, 'delete')
})

test('CHECK constraint: an invalid operation value is rejected at the database layer, not silently accepted', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('check_op')
  const productId = await createTestProduct(vendorId, 'check_op')
  await assert.rejects(
    () => enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'republish', sourceUpdatedAt: '2026-04-01 00:00:00' }),
    /CHECK constraint failed|constraint/i,
    'a non-upsert/delete operation value must be rejected by the CHECK constraint, proving the enum cannot be bypassed by a caller bug'
  )
})

test('CHECK constraint: an invalid entity_type value is rejected at the database layer, not silently accepted', async () => {
  const db = await getTestDb()
  await assert.rejects(
    () => enqueueSearchIndexEvent(db, { entityType: 'restaurant', entityId: 1, operation: 'upsert', sourceUpdatedAt: '2026-04-01 00:00:00' }),
    /CHECK constraint failed|constraint/i,
    'restaurant is a DEAD table per the audit (0 rows, 0 write paths) and must NOT be a valid entity_type until a real write path exists for it'
  )
})

test('CAS claim lifecycle: a pending event can be claimed exactly once (pending -> processing), a second claim attempt on the same row fails', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('cas_claim')
  const productId = await createTestProduct(vendorId, 'cas_claim')
  const enqueued = await enqueueSearchIndexEvent(db, { entityType: 'product', entityId: productId, operation: 'upsert', sourceUpdatedAt: '2026-05-01 00:00:00' })

  const claim1 = await db.prepare(`UPDATE search_index_events SET status='processing' WHERE id=? AND status='pending'`).bind(enqueued.eventId).run()
  const claim2 = await db.prepare(`UPDATE search_index_events SET status='processing' WHERE id=? AND status='pending'`).bind(enqueued.eventId).run()

  assert.equal((claim1.meta.rows_written ?? claim1.meta.changes) > 0, true, 'the first claim must succeed')
  assert.equal((claim2.meta.rows_written ?? claim2.meta.changes) > 0, false, 'the second claim on an already-processing row must be a confirmed no-op (CAS guard)')
})
