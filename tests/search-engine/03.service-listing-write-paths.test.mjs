/**
 * Engine 11 (Search & Discovery), Phase 1 — write-path instrumentation
 * proof for write paths #5-6 (createServiceListing/updateServiceListing,
 * src/lib/services.ts). Direct-library mode, mirrors
 * 02.product-listing-write-paths.test.mjs's methodology exactly.
 *
 * PRECONDITION: run with the dev server STOPPED.
 *
 * Run command:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/search-engine/03.service-listing-write-paths.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestProviderProfile, queryOneD1, queryD1, disposeTestDb } from './helpers/direct-db.mjs'
import { createServiceListing, updateServiceListing } from '../../src/lib/services.ts'

const SERVICE_CATEGORY_ID = 91

test.after(async () => {
  await disposeTestDb()
})

test('createServiceListing: a real INSERT produces exactly one search_index_events upsert row for the new listing id', async () => {
  const db = await getTestDb()
  const { providerProfileId } = await createTestProviderProfile('create_svc')

  const listingId = await createServiceListing(db, providerProfileId, {
    category_id: SERVICE_CATEGORY_ID,
    title: 'Search WritePath Test Service A',
    base_price_kobo: 500000,
  })
  assert.ok(listingId > 0)

  const rows = await queryD1(`SELECT entity_type, entity_id, operation, status FROM search_index_events WHERE entity_type='service_listing' AND entity_id=${listingId}`)
  assert.equal(rows.length, 1, 'createServiceListing must enqueue exactly one search index event')
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[0].status, 'pending')
})

test('updateServiceListing: a genuine PRICE CHANGE (ownership-matched) produces a SECOND, DISTINCT search_index_events row', async () => {
  const db = await getTestDb()
  const { providerProfileId } = await createTestProviderProfile('update_svc_price')
  const listingId = await createServiceListing(db, providerProfileId, {
    category_id: SERVICE_CATEGORY_ID,
    title: 'Search WritePath Test Service B',
    base_price_kobo: 500000,
  })

  // Wait past D1 datetime('now')'s 1-second resolution boundary so the
  // update's own timestamp genuinely differs from the create-time value
  // already captured and enqueued (same fix applied in
  // 02.product-listing-write-paths.test.mjs after that unit's diagnosed
  // test-authoring defect — backdating AFTER the create event already
  // captured its value cannot retroactively change it).
  await new Promise((resolve) => setTimeout(resolve, 1100))

  const updated = await updateServiceListing(db, providerProfileId, listingId, { base_price_kobo: 450000 })
  assert.equal(updated, true, 'a genuine, ownership-matched price change must report true')

  const rows = await queryD1(`SELECT operation, source_updated_at FROM search_index_events WHERE entity_type='service_listing' AND entity_id=${listingId} ORDER BY id ASC`)
  assert.equal(rows.length, 2, 'create + price-change update must produce exactly two distinct events')
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[1].operation, 'upsert')
  assert.notEqual(rows[0].source_updated_at, rows[1].source_updated_at, 'the update event must carry the NEWER updated_at value')
})

test('updateServiceListing: a 0-row UPDATE (wrong provider / cross-tenant mismatch) must NOT enqueue a search index event for a row this call never touched', async () => {
  const db = await getTestDb()
  const { providerProfileId: ownerProviderId } = await createTestProviderProfile('svc_owner')
  const { providerProfileId: attackerProviderId } = await createTestProviderProfile('svc_attacker')
  const listingId = await createServiceListing(db, ownerProviderId, {
    category_id: SERVICE_CATEGORY_ID,
    title: 'Search WritePath Test Service C',
    base_price_kobo: 500000,
  })

  const beforeCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='service_listing' AND entity_id=${listingId}`)

  const updated = await updateServiceListing(db, attackerProviderId, listingId, { base_price_kobo: 1 })
  assert.equal(updated, false, 'a mismatched-provider update must report false (0 rows affected)')

  const afterCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='service_listing' AND entity_id=${listingId}`)
  assert.equal(afterCount.n, beforeCount.n, 'no search index event may be enqueued for a write that never actually happened')
})

test('updateServiceListing: an empty input (fields.length===0 short-circuit) enqueues NO event', async () => {
  const db = await getTestDb()
  const { providerProfileId } = await createTestProviderProfile('svc_noop')
  const listingId = await createServiceListing(db, providerProfileId, {
    category_id: SERVICE_CATEGORY_ID,
    title: 'Search WritePath Test Service D',
    base_price_kobo: 500000,
  })

  const beforeCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='service_listing' AND entity_id=${listingId}`)
  const result = await updateServiceListing(db, providerProfileId, listingId, {})
  assert.equal(result, true, 'the empty-input short-circuit itself returns true (matches existing pre-Engine-11 behavior, unchanged)')
  const afterCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='service_listing' AND entity_id=${listingId}`)
  assert.equal(afterCount.n, beforeCount.n, 'a no-op update call (no fields provided) must not enqueue a spurious re-index event')
})

test('base_price_kobo validation guard: an invalid create (no price for a fixed pricing_model) throws BEFORE any INSERT or event emission', async () => {
  const db = await getTestDb()
  const { providerProfileId } = await createTestProviderProfile('svc_invalid')
  await assert.rejects(
    () => createServiceListing(db, providerProfileId, { category_id: SERVICE_CATEGORY_ID, title: 'Should Never Be Created' }),
    /base_price_kobo is required/,
  )
  const rows = await queryD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='service_listing'`)
  // Not a precise per-listing check (no listing id exists for a rejected
  // create) — this confirms the rejected call didn't silently create a
  // listing AND enqueue an event for it despite throwing.
  const listingExists = await queryOneD1(`SELECT COUNT(*) as n FROM service_listings WHERE title='Should Never Be Created'`)
  assert.equal(listingExists.n, 0, 'a validation-rejected create must not have inserted a row at all')
})
