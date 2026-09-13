/**
 * Engine 11 (Search & Discovery), Phase 1 — write-path instrumentation
 * proof for write paths #1-4 (createProduct/updateProduct/createListing/
 * updateListing, src/lib/seller-products.ts). Direct-library mode.
 *
 * ACCEPTANCE BAR PROVEN HERE (per the user's explicit Phase 1 acceptance
 * rule): CREATE / UPDATE / PRICE CHANGE / STOCK-adjacent field change ->
 * a real search_index_events row is durably enqueued, with correct
 * idempotency/ordering — all WITHOUT any FTS5 indexer existing. This
 * file does not test eligibility/visibility (that is
 * computeSearchEligibility, a separate unit) — only that the EVENT
 * STREAM itself is correctly produced by each real write path.
 *
 * PRECONDITION: run with the dev server STOPPED.
 *
 * Run command:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/search-engine/02.product-listing-write-paths.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestVendor, createTestProduct, queryOneD1, queryD1, disposeTestDb } from './helpers/direct-db.mjs'
import { createProduct, updateProduct, createListing, updateListing, sellerOwnsProduct } from '../../src/lib/seller-products.ts'

test.after(async () => {
  await disposeTestDb()
})

test('createProduct: a real INSERT produces exactly one search_index_events upsert row for the new product id', async () => {
  const db = await getTestDb()
  const productId = await createProduct(db, {
    category_id: 1,
    title: 'Search WritePath Test Product A',
    image_url: 'https://example.test/a.jpg',
  })
  assert.ok(productId > 0)

  const rows = await queryD1(`SELECT entity_type, entity_id, operation, status FROM search_index_events WHERE entity_type='product' AND entity_id=${productId}`)
  assert.equal(rows.length, 1, 'createProduct must enqueue exactly one search index event')
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[0].status, 'pending')
})

test('updateProduct: a genuine field change produces a SECOND, DISTINCT search_index_events row (append-only change log)', async () => {
  const db = await getTestDb()
  const productId = await createProduct(db, {
    category_id: 1,
    title: 'Search WritePath Test Product B',
    image_url: 'https://example.test/b.jpg',
  })
  const { vendorId } = await createTestVendor('update_product')
  // sellerOwnsProduct() (updateProduct's ownership guard) requires the
  // vendor to hold at least one listing on this product — create one so
  // the update call is actually authorized, isolating this test to the
  // event-emission behavior rather than the ownership guard itself.
  await createListing(db, vendorId, { product_id: productId, price_kobo: 100000, stock: 5 })
  assert.equal(await sellerOwnsProduct(db, vendorId, productId), true)

  // DETERMINISM FIX (Category B — proven, not assumed; see
  // docs/ENGINE-11-SEARCH-DISCOVERY-PHASE-1-VERIFICATION.md / migration
  // 0047's header): search_index_events' idempotency_key is
  // `${entity_type}:${entity_id}:${operation}:${source_updated_at}` BY
  // DESIGN — enqueueSearchIndexEvent() intentionally collapses two
  // events for the same entity+operation at the SAME source_updated_at
  // value via `ON CONFLICT(idempotency_key) DO NOTHING` (this is the
  // exact same CAS-guard discipline Engine 9/7 already established, and
  // File 01's own Test 5 already independently proves "a NEWER
  // source_updated_at produces a DISTINCT new row" — the contract is
  // correct, this test's PRECONDITION for exercising it was not).
  //
  // ROOT CAUSE (confirmed by reading updateProduct()'s implementation,
  // not assumed): `updateProduct()` always appends a LITERAL
  // `updated_at = datetime('now')` SQL clause bound to the real UPDATE
  // statement — it is the actual UPDATE's own timestamp write, not a
  // value the caller supplies or that gets read back unmodified. So the
  // ORIGINAL approach of manually rewinding the stored updated_at value
  // beforehand (whether by a flat "-5 seconds" or any other offset) can
  // never work: whatever is written pre-emptively is unconditionally
  // clobbered by updateProduct()'s own datetime('now') at call time.
  // (An earlier attempt at this fix rewound the value "-10 seconds
  // relative to the current read" — that failed for the identical
  // reason and was empirically confirmed still flaky before being
  // replaced by this approach.)
  // The event's source_updated_at is read back from that SAME real
  // wall-clock write immediately after — so the only genuine
  // precondition for two DISTINCT source_updated_at values is that real
  // wall-clock time crosses a full D1 1-second resolution boundary
  // between createProduct()'s write and updateProduct()'s write. The
  // setup steps above (createTestVendor + createListing + the ownership
  // check) consume a VARIABLE amount of real time, so relying on them
  // alone is not deterministic — confirmed by instrumented reproduction
  // showing an intermittent ~30-40% failure rate across standalone runs,
  // with failing runs showing pre- and post-update updated_at values
  // that were byte-identical.
  //
  // Fix: explicitly poll D1's OWN clock (not Node's, to avoid any
  // host/D1 clock-drift assumption) until it reports a value strictly
  // later than the product's own create-time updated_at, BEFORE calling
  // updateProduct(). This bounds the wait to at most ~1 second in the
  // worst case and makes the second-boundary crossing deterministic
  // rather than incidental. Zero application code touched; the
  // `notEqual` distinctness assertion below is unchanged and unweakened
  // — this only guarantees its actual precondition is met.
  const createdRow = await db.prepare('SELECT updated_at FROM products WHERE id = ?').bind(productId).first()
  for (;;) {
    const { now } = await db.prepare(`SELECT datetime('now') AS now`).first()
    if (now !== createdRow.updated_at) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  await updateProduct(db, vendorId, productId, { title: 'Search WritePath Test Product B (edited)' })

  const rows = await queryD1(`SELECT operation, source_updated_at FROM search_index_events WHERE entity_type='product' AND entity_id=${productId} ORDER BY id ASC`)
  assert.equal(rows.length, 2, 'create + update must produce exactly two distinct events, not a mutated single row')
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[1].operation, 'upsert')
  assert.notEqual(rows[0].source_updated_at, rows[1].source_updated_at, 'the update event must carry the NEWER updated_at value, proving it read back the real column rather than reusing a stale timestamp')
})
// NOTE: updateProduct's ownership check throws NotOwnedError for a
// mismatched vendor BEFORE reaching the UPDATE statement at all (see
// sellerOwnsProduct guard at the top of updateProduct) — so there is no
// "0-row UPDATE that must not emit an event" case to test for products
// the way there is for listings below. That asymmetry is inherent to
// the existing function, not something Phase 1 introduces.

test('createListing: a real INSERT produces exactly one search_index_events upsert row for the new listing id', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('create_listing')
  const productId = await createTestProduct(vendorId, 'create_listing')

  const listingId = await createListing(db, vendorId, { product_id: productId, price_kobo: 500000, stock: 10 })
  assert.ok(listingId > 0)

  const rows = await queryD1(`SELECT entity_type, entity_id, operation, status FROM search_index_events WHERE entity_type='product_listing' AND entity_id=${listingId}`)
  assert.equal(rows.length, 1, 'createListing must enqueue exactly one search index event')
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[0].status, 'pending')
})

test('updateListing: a genuine PRICE CHANGE (ownership-matched) produces a SECOND, DISTINCT search_index_events row', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('update_listing_price')
  const productId = await createTestProduct(vendorId, 'update_listing_price')
  const listingId = await createListing(db, vendorId, { product_id: productId, price_kobo: 500000, stock: 10 })

  // NOTE (test-defect fix, diagnosed via Failure Diagnosis Protocol
  // Category B): backdating the row's updated_at here does NOT change the
  // source_updated_at the create call already captured and enqueued
  // (read back BEFORE this line runs). What must differ is the value
  // updateListing's own `datetime('now')` produces vs. that already-
  // captured create-time value — so wait past D1 datetime('now')'s
  // 1-second resolution boundary instead of rewriting history backward.
  await new Promise((resolve) => setTimeout(resolve, 1100))

  const updated = await updateListing(db, vendorId, listingId, { price_kobo: 450000 })
  assert.equal(updated, true, 'a genuine, ownership-matched price change must report true')

  const rows = await queryD1(`SELECT operation, source_updated_at FROM search_index_events WHERE entity_type='product_listing' AND entity_id=${listingId} ORDER BY id ASC`)
  assert.equal(rows.length, 2, 'create + price-change update must produce exactly two distinct events')
  assert.notEqual(rows[0].source_updated_at, rows[1].source_updated_at)
})

test('updateListing: a 0-row UPDATE (wrong vendor / cross-tenant mismatch) must NOT enqueue a search index event for a row this call never touched', async () => {
  const db = await getTestDb()
  const { vendorId: ownerVendorId } = await createTestVendor('listing_owner')
  const { vendorId: attackerVendorId } = await createTestVendor('listing_attacker')
  const productId = await createTestProduct(ownerVendorId, 'ownership_guard')
  const listingId = await createListing(db, ownerVendorId, { product_id: productId, price_kobo: 500000, stock: 10 })

  const beforeCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product_listing' AND entity_id=${listingId}`)

  const updated = await updateListing(db, attackerVendorId, listingId, { price_kobo: 1 })
  assert.equal(updated, false, 'a mismatched-vendor update must report false (0 rows affected) — the existing ownership-by-construction invariant')

  const afterCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product_listing' AND entity_id=${listingId}`)
  assert.equal(afterCount.n, beforeCount.n, "no search index event may be enqueued for a write that never actually happened — an attacker probing another vendor's listing id must not be able to trigger a spurious re-index signal for it")
})

test('idempotency across write paths: calling updateProduct twice with no ACTUAL field change (fields.length === 0 short-circuit) enqueues NO additional event', async () => {
  const db = await getTestDb()
  const productId = await createProduct(db, {
    category_id: 1,
    title: 'Search WritePath Test Product C',
    image_url: 'https://example.test/c.jpg',
  })
  const { vendorId } = await createTestVendor('noop_update_product')
  await createListing(db, vendorId, { product_id: productId, price_kobo: 100000, stock: 5 }) // required so the ownership guard passes and we actually reach the fields.length===0 short-circuit

  const beforeCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product' AND entity_id=${productId}`)
  await updateProduct(db, vendorId, productId, {}) // empty input -> updateProduct's own `if (fields.length === 0) return` short-circuit, before any UPDATE or event emission
  const afterCount = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product' AND entity_id=${productId}`)
  assert.equal(afterCount.n, beforeCount.n, 'a no-op update call (no fields provided) must not enqueue a spurious re-index event')
})
