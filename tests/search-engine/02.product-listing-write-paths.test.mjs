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

  // Force updated_at to visibly differ from creation instant (D1's
  // datetime('now') has 1-second resolution) so this test does not
  // depend on the two calls straddling a wall-clock second by luck.
  await db.prepare(`UPDATE products SET updated_at = datetime('now', '-5 seconds') WHERE id = ?`).bind(productId).run()

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
