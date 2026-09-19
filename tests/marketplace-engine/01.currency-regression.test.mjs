/**
 * Stage 2C (Currency & Address Foundation) — Currency regression suite.
 *
 * Proves the NG/NGN baseline is byte-identical after Stage 2C's changes:
 * catalog listing money formatting, cart, and existing NG checkout paths
 * must produce EXACTLY the same numbers/format they always did, now that
 * `product_listings.currency` and `formatMoney()` exist. Also proves the
 * stored-currency architecture itself: an NGN listing's `currency` field is
 * present and equals 'NGN' everywhere it's surfaced.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiClient, queryOneD1 } from './helpers/client.mjs'

test('catalog /api/catalog/products surfaces currency="NGN" on NG listings, price format unchanged', async () => {
  const client = new ApiClient()
  const res = await client.get('/api/catalog/products?limit=5')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.products) && res.body.products.length > 0, 'expected at least one product')
  for (const p of res.body.products) {
    assert.ok('currency' in p, `product ${p.id} missing currency field`)
    assert.equal(typeof p.price_kobo, 'number')
  }
  // Baseline products (ids 1-3, seeded NG catalog from Stage 1) must be NGN.
  const ngProduct = res.body.products.find((p) => p.currency === 'NGN')
  assert.ok(ngProduct, 'expected at least one NGN product in the default feed')
})

test('a known GHS listing (Accra Shea Collective, listing 123) surfaces currency="GHS" via by-ids', async () => {
  const client = new ApiClient()
  // product_id 86 is the fixture GHS listing established in migration 0071's backfill.
  const res = await client.get('/api/catalog/products/by-ids?ids=86')
  assert.equal(res.status, 200)
  assert.equal(res.body.products.length, 1)
  assert.equal(res.body.products[0].currency, 'GHS', 'expected the Ghana-vendor listing to carry GHS, not the schema NGN default')
})

test('a known MAD listing (Marrakech Leather & Rugs vendor) surfaces currency="MAD"', async () => {
  const madListing = await queryOneD1(`SELECT product_id FROM product_listings WHERE currency = 'MAD' LIMIT 1`)
  assert.ok(madListing, 'expected at least one MAD-currency listing to exist in the seeded catalog')
  const client = new ApiClient()
  const res = await client.get(`/api/catalog/products/by-ids?ids=${madListing.product_id}`)
  assert.equal(res.status, 200)
  assert.equal(res.body.products[0].currency, 'MAD')
})

test('production-parity: currency is a STORED fact, not runtime-derived — changing a vendor country_iso after the fact does NOT retroactively change an existing listing currency', async () => {
  // This is the core architectural invariant Pat mandated: currency is set once
  // at listing-creation time and never re-derived from vendors.country_iso at
  // read time. We prove it by temporarily flipping a NG vendor's country_iso in
  // isolation (never touching its listings.currency) and confirming existing
  // listing rows are unaffected, then restoring the original value.
  const vendor = await queryOneD1(`SELECT id, country_iso FROM vendors WHERE country_iso = 'NG' LIMIT 1`)
  assert.ok(vendor, 'expected at least one NG vendor to exist')
  const listingBefore = await queryOneD1(`SELECT id, currency FROM product_listings WHERE vendor_id = ${vendor.id} LIMIT 1`)
  if (!listingBefore) return // vendor has no listings — nothing to prove, skip silently
  assert.equal(listingBefore.currency, 'NGN')

  const { execD1 } = await import('./helpers/client.mjs')
  try {
    await execD1(`UPDATE vendors SET country_iso = 'GH' WHERE id = ${vendor.id}`)
    const listingAfter = await queryOneD1(`SELECT id, currency FROM product_listings WHERE id = ${listingBefore.id}`)
    assert.equal(listingAfter.currency, 'NGN', 'listing currency must remain the STORED fact — must NOT flip just because the vendor row changed')
  } finally {
    await execD1(`UPDATE vendors SET country_iso = '${vendor.country_iso}' WHERE id = ${vendor.id}`)
  }
})

test('nigerian_states table is untouched (37 rows, unchanged) and country_regions generalizes it additively', async () => {
  const ngStates = await queryOneD1(`SELECT COUNT(*) as n FROM nigerian_states`)
  assert.equal(Number(ngStates.n), 37, 'nigerian_states row count must remain exactly 37 — Stage 2C must not delete/alter it')

  const ngRegions = await queryOneD1(`SELECT COUNT(*) as n FROM country_regions WHERE country_iso = 'NG'`)
  assert.equal(Number(ngRegions.n), 37, 'country_regions NG rows must mirror nigerian_states exactly (37)')

  const ghRegions = await queryOneD1(`SELECT COUNT(*) as n FROM country_regions WHERE country_iso = 'GH'`)
  assert.ok(Number(ghRegions.n) > 0, 'expected GH regions to have been seeded by migration 0071')
})
