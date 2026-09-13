/**
 * Engine 11 (Search & Discovery), Phase 1 — write-path instrumentation
 * proof for write paths #7-8 (createBookableListing/updateBookableListing,
 * src/lib/bookings.ts). Direct-library mode, mirrors
 * 02/03.*-write-paths.test.mjs's methodology exactly.
 *
 * PRECONDITION: run with the dev server STOPPED.
 *
 * Run command:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/search-engine/04.bookable-listing-write-paths.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, queryOneD1, queryD1, disposeTestDb, RUN_NONCE } from './helpers/direct-db.mjs'
import { createBookableListing, updateBookableListing } from '../../src/lib/bookings.ts'

test.after(async () => {
  await disposeTestDb()
})

/** createBookableListing takes a bare providerUserId, not a resolved provider_profiles row — a lightweight bare user is sufficient here, matching this function's own signature. */
async function createTestProviderUser(label) {
  const db = await getTestDb()
  const email = `search_test_bkg_${label}_${RUN_NONCE}@test.ng`
  const result = await db
    .prepare('INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .bind(email, `SearchTest BookingProvider ${label}`, 'test-hash', 'test-salt')
    .run()
  return Number(result.meta.last_row_id)
}

test('createBookableListing: a real INSERT produces exactly one search_index_events upsert row for the new listing id', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestProviderUser('create_bkg')

  const listingId = await createBookableListing(db, providerUserId, {
    listingType: 'gig_service',
    title: 'Search WritePath Test Bookable A',
    countryIso: 'NG',
    basePriceKobo: 500000,
  })
  assert.ok(listingId > 0)

  const rows = await queryD1(`SELECT entity_type, entity_id, operation, status FROM search_index_events WHERE entity_type='bookable_listing' AND entity_id=${listingId}`)
  assert.equal(rows.length, 1, 'createBookableListing must enqueue exactly one search index event')
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[0].status, 'pending')
})

test('updateBookableListing: a genuine PRICE CHANGE (ownership-matched, individual identity) produces a SECOND, DISTINCT search_index_events row', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestProviderUser('update_bkg_price')
  const listingId = await createBookableListing(db, providerUserId, {
    listingType: 'gig_service',
    title: 'Search WritePath Test Bookable B',
    countryIso: 'NG',
    basePriceKobo: 500000,
  })

  // Wait past D1 datetime('now')'s 1-second resolution boundary — same
  // fix as 02/03's diagnosed test-authoring defect (backdating cannot
  // retroactively change a value the create event already captured).
  await new Promise((resolve) => setTimeout(resolve, 1100))

  const updated = await updateBookableListing(db, providerUserId, listingId, { basePriceKobo: 450000 })
  assert.equal(updated, true, 'a genuine, ownership-matched price change must report true')

  const rows = await queryD1(`SELECT operation, source_updated_at FROM search_index_events WHERE entity_type='bookable_listing' AND entity_id=${listingId} ORDER BY id ASC`)
  assert.equal(rows.length, 2, 'create + price-change update must produce exactly two distinct events')
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[1].operation, 'upsert')
  assert.notEqual(rows[0].source_updated_at, rows[1].source_updated_at)
})

test('updateBookableListing: a 0-row UPDATE (wrong provider / cross-tenant mismatch) must NOT enqueue a search index event', async () => {
  const db = await getTestDb()
  const ownerUserId = await createTestProviderUser('bkg_owner')
  const attackerUserId = await createTestProviderUser('bkg_attacker')
  const listingId = await createBookableListing(db, ownerUserId, {
    listingType: 'gig_service',
    title: 'Search WritePath Test Bookable C',
    countryIso: 'NG',
    basePriceKobo: 500000,
  })

  const beforeCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='bookable_listing' AND entity_id=${listingId}`)

  const updated = await updateBookableListing(db, attackerUserId, listingId, { basePriceKobo: 1 })
  assert.equal(updated, false, 'a mismatched-provider update must report false (0 rows affected)')

  const afterCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='bookable_listing' AND entity_id=${listingId}`)
  assert.equal(afterCount.n, beforeCount.n, 'no search index event may be enqueued for a write that never actually happened')
})

test('updateBookableListing: an org-owned listing is NOT mutable via the individual-identity path (organization_id IS NULL guard) and enqueues no event', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestProviderUser('bkg_org_guard')
  // Create a minimal organization row directly so we can attribute a
  // listing to it (createBookableListing accepts organizationId).
  // created_by_user_id is NOT NULL — confirmed against sqlite_master this
  // session; reuse providerUserId as the creator, it need not be distinct.
  const org = await db
    .prepare(`INSERT INTO organizations (name, created_by_user_id) VALUES (?, ?)`)
    .bind(`SearchTestOrg_${RUN_NONCE}`, providerUserId)
    .run()
  const organizationId = Number(org.meta.last_row_id)
  const listingId = await createBookableListing(db, providerUserId, {
    listingType: 'gig_service',
    title: 'Search WritePath Test Bookable D (org-owned)',
    countryIso: 'NG',
    basePriceKobo: 500000,
    organizationId,
  })

  const beforeCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='bookable_listing' AND entity_id=${listingId}`)
  // updateBookableListing's WHERE clause requires organization_id IS NULL
  // — an org-owned listing must report false here even though
  // providerUserId matches (it's the creator's historical attribution,
  // not a current mutation right via this path).
  const updated = await updateBookableListing(db, providerUserId, listingId, { basePriceKobo: 1 })
  assert.equal(updated, false, 'an org-owned listing must not be mutable via the individual-identity update path')
  const afterCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='bookable_listing' AND entity_id=${listingId}`)
  assert.equal(afterCount.n, beforeCount.n, 'the org-owned-listing guard rejection must not enqueue a search index event either')
})

test('validation guard: basePriceKobo <= 0 throws BEFORE any INSERT or event emission', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestProviderUser('bkg_invalid')
  await assert.rejects(
    () => createBookableListing(db, providerUserId, { listingType: 'gig_service', title: 'Should Never Be Created', countryIso: 'NG', basePriceKobo: 0 }),
    /basePriceKobo must be > 0/,
  )
  const listingExists = await queryOneD1(`SELECT COUNT(*) as n FROM bookable_listings WHERE title='Should Never Be Created'`)
  assert.equal(listingExists.n, 0, 'a validation-rejected create must not have inserted a row at all')
})
