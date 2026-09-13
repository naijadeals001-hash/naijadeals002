/**
 * Engine 11 (Search & Discovery), Phase 1 — write-path instrumentation
 * proof for write path #9 (adjustStock, src/lib/inventory.ts). This is
 * the previously-missed 9th path (product_listings.stock/updated_at
 * mutated zero events before this unit) and specifically covers the
 * STOCK CHANGE leg of the Phase 1 acceptance rule (CREATE / UPDATE /
 * STATUS CHANGE / PRICE CHANGE / STOCK CHANGE / DELETE).
 *
 * PRECONDITION: run with the dev server STOPPED.
 *
 * NODE FLAG NOTE (Category C invocation issue, diagnosed this unit, NOT
 * an application defect): inventory.ts's InsufficientStockError uses a
 * TypeScript parameter-property constructor
 * (`constructor(public listingId: number, ...)`), which
 * `--experimental-strip-types` (used by every other file in this repo's
 * test suites) cannot parse — it only strips type annotations, it does
 * not transform parameter-property sugar into real field assignments.
 * `--experimental-transform-types` is a proper superset available on
 * this Node version (v22.23.2) that DOES handle it. This file requires
 * that flag INSTEAD OF --experimental-strip-types. No application source
 * was changed to work around this test-runner limitation.
 *
 * Run command:
 *   node --experimental-transform-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/search-engine/05.adjust-stock-write-path.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestVendor, createTestProduct, createTestProductListing, queryOneD1, queryD1, disposeTestDb } from './helpers/direct-db.mjs'
import { adjustStock, InsufficientStockError } from '../../src/lib/inventory.ts'

test.after(async () => {
  await disposeTestDb()
})

test('adjustStock: a genuine restock (positive delta) enqueues exactly one search_index_events upsert row', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('adjust_restock')
  const productId = await createTestProduct(vendorId, 'adjust_restock')
  const listingId = await createTestProductListing(productId, vendorId, 100000)

  const newStock = await adjustStock(db, listingId, 20, 'restock')
  assert.equal(newStock, 30, '10 initial + 20 restock = 30')

  const rows = await queryD1(`SELECT entity_type, entity_id, operation, status FROM search_index_events WHERE entity_type='product_listing' AND entity_id=${listingId}`)
  assert.equal(rows.length, 1, 'adjustStock must enqueue exactly one search index event for the STOCK CHANGE')
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[0].status, 'pending')
})

test('adjustStock: a SECOND genuine adjustment on the SAME listing produces a SECOND, DISTINCT event (append-only change log)', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('adjust_twice')
  const productId = await createTestProduct(vendorId, 'adjust_twice')
  const listingId = await createTestProductListing(productId, vendorId, 100000)

  await adjustStock(db, listingId, -3, 'order_placed')
  // Wait past D1 datetime('now')'s 1-second resolution boundary — same
  // fix as prior units' diagnosed test-authoring defect.
  await new Promise((resolve) => setTimeout(resolve, 1100))
  await adjustStock(db, listingId, -2, 'order_placed')

  const rows = await queryD1(`SELECT operation, source_updated_at FROM search_index_events WHERE entity_type='product_listing' AND entity_id=${listingId} ORDER BY id ASC`)
  assert.equal(rows.length, 2, 'two genuinely distinct stock adjustments must produce two distinct events')
  assert.notEqual(rows[0].source_updated_at, rows[1].source_updated_at)
})

test('adjustStock: an over-decrement rejected by InsufficientStockError (no backorder) enqueues NO event — the mutation never happened', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('adjust_insufficient')
  const productId = await createTestProduct(vendorId, 'adjust_insufficient')
  const listingId = await createTestProductListing(productId, vendorId, 100000) // stock=10, allow_backorder=0 (fixture default)

  await assert.rejects(() => adjustStock(db, listingId, -999, 'order_placed'), InsufficientStockError)

  const rows = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product_listing' AND entity_id=${listingId}`)
  assert.equal(rows.n, 0, 'a rejected over-decrement must not enqueue a search index event for a stock level that never actually changed')
})

test('adjustStock: order_cancelled (positive delta, restoring stock) is instrumented identically to restock — no special-casing by reason', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('adjust_cancel')
  const productId = await createTestProduct(vendorId, 'adjust_cancel')
  const listingId = await createTestProductListing(productId, vendorId, 100000)

  await adjustStock(db, listingId, -5, 'order_placed')
  await new Promise((resolve) => setTimeout(resolve, 1100))
  await adjustStock(db, listingId, 5, 'order_cancelled')

  const rows = await queryD1(`SELECT operation FROM search_index_events WHERE entity_type='product_listing' AND entity_id=${listingId} ORDER BY id ASC`)
  assert.equal(rows.length, 2, 'both the decrement and the cancellation-restore must independently enqueue events — every real stock mutation is a re-index signal regardless of reason')
  assert.equal(rows[0].operation, 'upsert')
  assert.equal(rows[1].operation, 'upsert')
})

test('adjustStock: a nonexistent listing id throws "not found" BEFORE any event emission attempt', async () => {
  const db = await getTestDb()
  await assert.rejects(() => adjustStock(db, 999999999, 5, 'restock'), /not found/)
  // No entity_id to check directly (the whole point is nothing was
  // created), but confirm no orphan event exists for this impossible id.
  const rows = await queryOneD1(`SELECT COUNT(*) as n FROM search_index_events WHERE entity_type='product_listing' AND entity_id=999999999`)
  assert.equal(rows.n, 0)
})
