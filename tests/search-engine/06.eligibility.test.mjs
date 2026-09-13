/**
 * Engine 11 (Search & Discovery), Phase 1 — shared two-level visibility
 * eligibility helper proof (src/lib/search-eligibility.ts).
 *
 * Covers, for each of the 4 entity types: the ELIGIBLE case, EACH
 * documented ineligibility reason (entity's own field, then owner's
 * standing), not-found, and (for product_listing) parent-product
 * propagation. Plus isEntitySearchEligible()'s dispatch correctness.
 *
 * This module is pure/read-only — no search_index_events interaction,
 * no FTS indexer. Direct-library mode, mirrors 02-05's methodology.
 *
 * PRECONDITION: run with the dev server STOPPED.
 *
 * Run command:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/search-engine/06.eligibility.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestVendor, createTestProduct, createTestProductListing, createTestProviderProfile, disposeTestDb, RUN_NONCE } from './helpers/direct-db.mjs'
import {
  checkProductEligibility,
  checkProductListingEligibility,
  checkServiceListingEligibility,
  checkBookableListingEligibility,
  isEntitySearchEligible,
} from '../../src/lib/search-eligibility.ts'

const SERVICE_CATEGORY_ID = 91

test.after(async () => {
  await disposeTestDb()
})

async function createTestServiceListing(db, providerProfileId, label) {
  const result = await db
    .prepare(
      `INSERT INTO service_listings (provider_profile_id, category_id, title, base_price_kobo, is_active, status)
       VALUES (?, ?, ?, 500000, 1, 'active')`
    )
    .bind(providerProfileId, SERVICE_CATEGORY_ID, `SearchTest EligSvc ${label}`)
    .run()
  return Number(result.meta.last_row_id)
}

async function createTestBookableUser(label) {
  const db = await getTestDb()
  const email = `search_test_elig_${label}_${RUN_NONCE}@test.ng`
  const result = await db
    .prepare('INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .bind(email, `SearchTest EligUser ${label}`, 'test-hash', 'test-salt')
    .run()
  return Number(result.meta.last_row_id)
}

async function createTestBookableListing(db, providerUserId, label, organizationId = null) {
  const result = await db
    .prepare(
      `INSERT INTO bookable_listings
        (listing_type, provider_user_id, title, country_iso, booking_mode, pricing_unit, base_price_kobo, is_active, organization_id)
       VALUES ('gig_service', ?, ?, 'NG', 'request', 'per_booking', 500000, 1, ?)`
    )
    .bind(providerUserId, `SearchTest EligBkg ${label}`, organizationId)
    .run()
  return Number(result.meta.last_row_id)
}

async function createTestOrganization(db, createdByUserId, status = 'active', verificationStatus = 'unverified') {
  const result = await db
    .prepare(`INSERT INTO organizations (name, created_by_user_id, status, verification_status) VALUES (?, ?, ?, ?)`)
    .bind(`SearchTestEligOrg_${RUN_NONCE}_${Math.random().toString(36).slice(2, 8)}`, createdByUserId, status, verificationStatus)
    .run()
  return Number(result.meta.last_row_id)
}

// ---------------------------------------------------------------- product ---

test('checkProductEligibility: an active, is_active=1, moderation_status=active product is ELIGIBLE', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_prod_ok')
  const productId = await createTestProduct(vendorId, 'elig_ok')
  const result = await checkProductEligibility(db, productId)
  assert.deepEqual(result, { eligible: true, reasons: [] })
})

test('checkProductEligibility: is_active=0 is INELIGIBLE with product_is_active_false', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_prod_inactive')
  const productId = await createTestProduct(vendorId, 'elig_inactive')
  await db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').bind(productId).run()
  const result = await checkProductEligibility(db, productId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('product_is_active_false'))
})

test('checkProductEligibility: moderation_status != active is INELIGIBLE with the specific reason code', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_prod_mod')
  const productId = await createTestProduct(vendorId, 'elig_mod')
  await db.prepare(`UPDATE products SET moderation_status = 'flagged' WHERE id = ?`).bind(productId).run()
  const result = await checkProductEligibility(db, productId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('product_moderation_status_flagged'))
})

test('checkProductEligibility: nonexistent product id returns product_not_found', async () => {
  const db = await getTestDb()
  const result = await checkProductEligibility(db, 999999999)
  assert.deepEqual(result, { eligible: false, reasons: ['product_not_found'] })
})

// --------------------------------------------------------- product_listing ---

test('checkProductListingEligibility: a fully healthy listing + vendor + parent product is ELIGIBLE', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_pl_ok')
  const productId = await createTestProduct(vendorId, 'elig_pl_ok')
  const listingId = await createTestProductListing(productId, vendorId)
  const result = await checkProductListingEligibility(db, listingId)
  assert.deepEqual(result, { eligible: true, reasons: [] })
})

test('checkProductListingEligibility: listing is_active=0 is INELIGIBLE', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_pl_inactive')
  const productId = await createTestProduct(vendorId, 'elig_pl_inactive')
  const listingId = await createTestProductListing(productId, vendorId)
  await db.prepare('UPDATE product_listings SET is_active = 0 WHERE id = ?').bind(listingId).run()
  const result = await checkProductListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('listing_is_active_false'))
})

test('checkProductListingEligibility: listing moderation_status != active is INELIGIBLE', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_pl_mod')
  const productId = await createTestProduct(vendorId, 'elig_pl_mod')
  const listingId = await createTestProductListing(productId, vendorId)
  await db.prepare(`UPDATE product_listings SET moderation_status = 'flagged' WHERE id = ?`).bind(listingId).run()
  const result = await checkProductListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('listing_moderation_status_flagged'))
})

test('checkProductListingEligibility: vendor store_status=suspended is INELIGIBLE with vendor_store_status_suspended', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_pl_vendorsusp')
  const productId = await createTestProduct(vendorId, 'elig_pl_vendorsusp')
  const listingId = await createTestProductListing(productId, vendorId)
  await db.prepare(`UPDATE vendors SET store_status = 'suspended' WHERE id = ?`).bind(vendorId).run()
  const result = await checkProductListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('vendor_store_status_suspended'))
})

test('checkProductListingEligibility: vendor verification_status=suspended is INELIGIBLE with vendor_verification_status_suspended', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_pl_vsusp')
  const productId = await createTestProduct(vendorId, 'elig_pl_vsusp')
  const listingId = await createTestProductListing(productId, vendorId)
  await db.prepare(`UPDATE vendors SET verification_status = 'suspended' WHERE id = ?`).bind(vendorId).run()
  const result = await checkProductListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('vendor_verification_status_suspended'))
})

test('checkProductListingEligibility: vendor verification_status=rejected is INELIGIBLE with vendor_verification_status_rejected', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_pl_vrej')
  const productId = await createTestProduct(vendorId, 'elig_pl_vrej')
  const listingId = await createTestProductListing(productId, vendorId)
  await db.prepare(`UPDATE vendors SET verification_status = 'rejected' WHERE id = ?`).bind(vendorId).run()
  const result = await checkProductListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('vendor_verification_status_rejected'))
})

test('checkProductListingEligibility: an ineligible PARENT product propagates as parent_product_* prefixed reasons', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_pl_parent')
  const productId = await createTestProduct(vendorId, 'elig_pl_parent')
  const listingId = await createTestProductListing(productId, vendorId)
  await db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').bind(productId).run()
  const result = await checkProductListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('parent_product_is_active_false'), `expected parent_product_is_active_false, got ${JSON.stringify(result.reasons)}`)
})

test('checkProductListingEligibility: nonexistent listing id returns product_listing_not_found', async () => {
  const db = await getTestDb()
  const result = await checkProductListingEligibility(db, 999999999)
  assert.deepEqual(result, { eligible: false, reasons: ['product_listing_not_found'] })
})

// --------------------------------------------------------- service_listing ---

test('checkServiceListingEligibility: a fully healthy listing + provider is ELIGIBLE', async () => {
  const db = await getTestDb()
  const { providerProfileId } = await createTestProviderProfile('elig_sl_ok')
  const listingId = await createTestServiceListing(db, providerProfileId, 'elig_ok')
  const result = await checkServiceListingEligibility(db, listingId)
  assert.deepEqual(result, { eligible: true, reasons: [] })
})

test('checkServiceListingEligibility: listing is_active=0 is INELIGIBLE', async () => {
  const db = await getTestDb()
  const { providerProfileId } = await createTestProviderProfile('elig_sl_inactive')
  const listingId = await createTestServiceListing(db, providerProfileId, 'elig_inactive')
  await db.prepare('UPDATE service_listings SET is_active = 0 WHERE id = ?').bind(listingId).run()
  const result = await checkServiceListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('listing_is_active_false'))
})

test('checkServiceListingEligibility: listing status != active is INELIGIBLE with the specific reason code', async () => {
  const db = await getTestDb()
  const { providerProfileId } = await createTestProviderProfile('elig_sl_status')
  const listingId = await createTestServiceListing(db, providerProfileId, 'elig_status')
  await db.prepare(`UPDATE service_listings SET status = 'pending_review' WHERE id = ?`).bind(listingId).run()
  const result = await checkServiceListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('listing_status_pending_review'))
})

test('checkServiceListingEligibility: provider operational_status=suspended is INELIGIBLE with provider_operational_status_suspended', async () => {
  const db = await getTestDb()
  const { providerProfileId } = await createTestProviderProfile('elig_sl_opsusp')
  const listingId = await createTestServiceListing(db, providerProfileId, 'elig_opsusp')
  await db.prepare(`UPDATE provider_profiles SET operational_status = 'suspended' WHERE id = ?`).bind(providerProfileId).run()
  const result = await checkServiceListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('provider_operational_status_suspended'))
})

test('checkServiceListingEligibility: provider verification_status=rejected is INELIGIBLE with provider_verification_status_rejected', async () => {
  const db = await getTestDb()
  const { providerProfileId } = await createTestProviderProfile('elig_sl_vrej')
  const listingId = await createTestServiceListing(db, providerProfileId, 'elig_vrej')
  await db.prepare(`UPDATE provider_profiles SET verification_status = 'rejected' WHERE id = ?`).bind(providerProfileId).run()
  const result = await checkServiceListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('provider_verification_status_rejected'))
})

test('checkServiceListingEligibility: nonexistent listing id returns service_listing_not_found', async () => {
  const db = await getTestDb()
  const result = await checkServiceListingEligibility(db, 999999999)
  assert.deepEqual(result, { eligible: false, reasons: ['service_listing_not_found'] })
})

// -------------------------------------------------------- bookable_listing ---

test('checkBookableListingEligibility: an INDIVIDUAL-owned listing with an active owner is ELIGIBLE', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestBookableUser('elig_bkg_indiv_ok')
  const listingId = await createTestBookableListing(db, providerUserId, 'indiv_ok')
  const result = await checkBookableListingEligibility(db, listingId)
  assert.deepEqual(result, { eligible: true, reasons: [] })
})

test('checkBookableListingEligibility: listing is_active=0 is INELIGIBLE regardless of owner standing', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestBookableUser('elig_bkg_inactive')
  const listingId = await createTestBookableListing(db, providerUserId, 'inactive')
  await db.prepare('UPDATE bookable_listings SET is_active = 0 WHERE id = ?').bind(listingId).run()
  const result = await checkBookableListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('listing_is_active_false'))
})

test('checkBookableListingEligibility (individual path): owner user.status=suspended is INELIGIBLE with owner_user_status_suspended', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestBookableUser('elig_bkg_usersusp')
  const listingId = await createTestBookableListing(db, providerUserId, 'usersusp')
  await db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).bind(providerUserId).run()
  const result = await checkBookableListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('owner_user_status_suspended'))
})

test('checkBookableListingEligibility (individual path): owner user.status=deleted is INELIGIBLE with owner_user_status_deleted', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestBookableUser('elig_bkg_userdel')
  const listingId = await createTestBookableListing(db, providerUserId, 'userdel')
  await db.prepare(`UPDATE users SET status = 'deleted' WHERE id = ?`).bind(providerUserId).run()
  const result = await checkBookableListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('owner_user_status_deleted'))
})

test('checkBookableListingEligibility (org path): an ORG-owned listing with a healthy organization is ELIGIBLE', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestBookableUser('elig_bkg_org_ok')
  const organizationId = await createTestOrganization(db, providerUserId, 'active', 'verified')
  const listingId = await createTestBookableListing(db, providerUserId, 'org_ok', organizationId)
  // Set the individual owner user to suspended to PROVE the org path does
  // NOT consult users.status at all once organization_id is set (the
  // two paths are mutually exclusive, per this module's corrected design).
  await db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).bind(providerUserId).run()
  const result = await checkBookableListingEligibility(db, listingId)
  assert.deepEqual(result, { eligible: true, reasons: [] }, 'org-owned eligibility must be decided by the ORGANIZATION status, never the historical creator user status')
})

test('checkBookableListingEligibility (org path): organization.status=suspended is INELIGIBLE with organization_status_suspended', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestBookableUser('elig_bkg_orgsusp')
  const organizationId = await createTestOrganization(db, providerUserId, 'suspended', 'verified')
  const listingId = await createTestBookableListing(db, providerUserId, 'orgsusp', organizationId)
  const result = await checkBookableListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('organization_status_suspended'))
})

test('checkBookableListingEligibility (org path): organization.status=disabled is INELIGIBLE with organization_status_disabled', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestBookableUser('elig_bkg_orgdis')
  const organizationId = await createTestOrganization(db, providerUserId, 'disabled', 'verified')
  const listingId = await createTestBookableListing(db, providerUserId, 'orgdis', organizationId)
  const result = await checkBookableListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('organization_status_disabled'))
})

test('checkBookableListingEligibility (org path): organization.verification_status=rejected is INELIGIBLE with organization_verification_status_rejected', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestBookableUser('elig_bkg_orgvrej')
  const organizationId = await createTestOrganization(db, providerUserId, 'active', 'rejected')
  const listingId = await createTestBookableListing(db, providerUserId, 'orgvrej', organizationId)
  const result = await checkBookableListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('organization_verification_status_rejected'))
})

test('checkBookableListingEligibility (org path): organization.verification_status=suspended is INELIGIBLE with organization_verification_status_suspended', async () => {
  const db = await getTestDb()
  const providerUserId = await createTestBookableUser('elig_bkg_orgvsusp')
  const organizationId = await createTestOrganization(db, providerUserId, 'active', 'suspended')
  const listingId = await createTestBookableListing(db, providerUserId, 'orgvsusp', organizationId)
  const result = await checkBookableListingEligibility(db, listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('organization_verification_status_suspended'))
})

test('checkBookableListingEligibility: nonexistent listing id returns bookable_listing_not_found', async () => {
  const db = await getTestDb()
  const result = await checkBookableListingEligibility(db, 999999999)
  assert.deepEqual(result, { eligible: false, reasons: ['bookable_listing_not_found'] })
})

// ------------------------------------------------------ dispatch (isEntitySearchEligible) ---

test('isEntitySearchEligible: dispatches correctly for all 4 entity types (eligible cases)', async () => {
  const db = await getTestDb()

  const { vendorId } = await createTestVendor('elig_dispatch_prod')
  const productId = await createTestProduct(vendorId, 'dispatch')
  assert.deepEqual(await isEntitySearchEligible(db, 'product', productId), { eligible: true, reasons: [] })

  const listingId = await createTestProductListing(productId, vendorId)
  assert.deepEqual(await isEntitySearchEligible(db, 'product_listing', listingId), { eligible: true, reasons: [] })

  const { providerProfileId } = await createTestProviderProfile('elig_dispatch_svc')
  const serviceListingId = await createTestServiceListing(db, providerProfileId, 'dispatch')
  assert.deepEqual(await isEntitySearchEligible(db, 'service_listing', serviceListingId), { eligible: true, reasons: [] })

  const providerUserId = await createTestBookableUser('elig_dispatch_bkg')
  const bookableListingId = await createTestBookableListing(db, providerUserId, 'dispatch')
  assert.deepEqual(await isEntitySearchEligible(db, 'bookable_listing', bookableListingId), { eligible: true, reasons: [] })
})

test('isEntitySearchEligible: dispatches correctly to the INELIGIBLE path for a suspended vendor listing (end-to-end sanity)', async () => {
  const db = await getTestDb()
  const { vendorId } = await createTestVendor('elig_dispatch_susp')
  const productId = await createTestProduct(vendorId, 'dispatch_susp')
  const listingId = await createTestProductListing(productId, vendorId)
  await db.prepare(`UPDATE vendors SET store_status = 'suspended' WHERE id = ?`).bind(vendorId).run()
  const result = await isEntitySearchEligible(db, 'product_listing', listingId)
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('vendor_store_status_suspended'))
})
