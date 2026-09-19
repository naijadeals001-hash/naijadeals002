/**
 * Stage 2C — Seller listing creation currency default.
 * Proves the acceptance test Pat specified verbatim: "New GH listing (non-NG
 * vendor fixture) -> GHS automatically, without requiring the seller/client
 * to supply an arbitrary currency contradicting the seller's country" and
 * the mirror case for NG -> NGN.
 *
 * Uses the organization-store path (already proven correct in
 * 04.org-vendor-country.test.mjs) to get a real GH-country vendor, then
 * creates a listing through the real seller API as that organization.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, cleanupRunNonce, queryOneD1, RUN_NONCE } from './helpers/client.mjs'

let user
let ghOrgId
let ngOrgId
let sharedProductId

test.before(async () => {
  user = await registerUser('listingcurrency')

  const ghOrg = await user.client.post('/api/organizations', {
    name: `ListingCurrencyTest-GH-${Date.now()}`,
    organization_type: 'business',
    country_iso: 'GH',
  })
  ghOrgId = ghOrg.body.organization.id
  await user.client.post(`/api/organizations/${ghOrgId}/store`, { name: 'GH Listing Test Store' })

  const ngOrg = await user.client.post('/api/organizations', {
    name: `ListingCurrencyTest-NG-${Date.now()}`,
    organization_type: 'business',
    country_iso: 'NG',
  })
  ngOrgId = ngOrg.body.organization.id
  await user.client.post(`/api/organizations/${ngOrgId}/store`, { name: 'NG Listing Test Store' })

  // Any existing, approved category id works — listings just need a valid product to attach to.
  const category = await queryOneD1(`SELECT id FROM categories LIMIT 1`)
  const productRes = await user.client.post(`/api/seller/products?organization_id=${ghOrgId}`, {
    title: `Listing Currency Test Product ${Date.now()}`,
    category_id: category.id,
    image_url: 'https://example.com/test.jpg',
  })
  assert.equal(productRes.status, 201, JSON.stringify(productRes.body))
  sharedProductId = productRes.body.id
})

test.after(async () => {
  // Must run BEFORE cleanupRunNonce(): organizations.created_by_user_id has a
  // FOREIGN KEY REFERENCES users(id) — deleting the user first (as cleanupRunNonce
  // does) while these org/product rows still exist raises SQLITE_CONSTRAINT_FOREIGNKEY.
  // See the identical bug found + fixed in 04.org-vendor-country.test.mjs.
  const { execD1 } = await import('./helpers/client.mjs')
  await execD1(
    `DELETE FROM product_listings WHERE product_id = ${sharedProductId};` +
    `DELETE FROM products WHERE id = ${sharedProductId};` +
    `DELETE FROM vendors WHERE organization_id IN (SELECT id FROM organizations WHERE name LIKE 'ListingCurrencyTest%');` +
    `DELETE FROM organization_members WHERE organization_id IN (SELECT id FROM organizations WHERE name LIKE 'ListingCurrencyTest%');` +
    `DELETE FROM organizations WHERE name LIKE 'ListingCurrencyTest%';`
  )
  await cleanupRunNonce(RUN_NONCE)
})

test('a new listing created by a GH-country vendor gets currency=GHS automatically, with NO currency field in the request', async () => {
  const res = await user.client.post(`/api/seller/listings?organization_id=${ghOrgId}`, {
    product_id: sharedProductId,
    price_kobo: 500000,
    stock: 10,
    // deliberately no currency field anywhere in this payload
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  const listing = await queryOneD1(`SELECT currency FROM product_listings WHERE id = ${res.body.id}`)
  assert.ok(listing, 'expected the newly created listing to be found by id')
  assert.equal(listing.currency, 'GHS', 'a GH vendor\'s new listing must automatically get GHS, never the schema NGN default')
})

test('a new listing created by an NG-country vendor gets currency=NGN automatically (unchanged baseline behavior)', async () => {
  const category = await queryOneD1(`SELECT id FROM categories LIMIT 1`)
  const productRes = await user.client.post(`/api/seller/products?organization_id=${ngOrgId}`, {
    title: `Listing Currency NG Test Product ${Date.now()}`,
    category_id: category.id,
    image_url: 'https://example.com/test2.jpg',
  })
  assert.equal(productRes.status, 201, JSON.stringify(productRes.body))
  const ngProductId = productRes.body.id

  const res = await user.client.post(`/api/seller/listings?organization_id=${ngOrgId}`, {
    product_id: ngProductId,
    price_kobo: 500000,
    stock: 10,
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  const listing = await queryOneD1(`SELECT currency FROM product_listings WHERE id = ${res.body.id}`)
  assert.equal(listing.currency, 'NGN')

  const { execD1 } = await import('./helpers/client.mjs')
  await execD1(`DELETE FROM product_listings WHERE product_id = ${ngProductId}; DELETE FROM products WHERE id = ${ngProductId};`)
})
