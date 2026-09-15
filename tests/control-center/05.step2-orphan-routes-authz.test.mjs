/**
 * ADR-001 Step 2 (docs/ADR-001-IMPLEMENTATION-PLAN.md §4) — permanent
 * regression coverage for the 19 routes re-homed from src/routes/api-admin.ts
 * (legacy requirePlatformRole('admin')) to src/routes/api-control-center.ts
 * (requireControlCenterPermission(key)). Mirrors
 * 02.authorization-rbac.test.mjs's exact AUTHZ-1/AUTHZ-2 pattern: for every
 * newly-gated route, one positive test (a role holding the permission
 * succeeds) and one negative test (a role lacking it gets a genuine 403,
 * with zero business-side-effect on the 403 path where mutation is
 * involved) — per ADR-001 §10 requirement #2 / the Implementation Plan §4.3.
 *
 * `vendor_admin` is used as the universal negative fixture throughout: a
 * live query of cc_role_permissions (this session, ADR-001 Step 2 fresh
 * audit) confirms it holds ONLY audit.read, providers.*, vendors.* — none
 * of the 7 permission keys these 19 routes require (moderation.read,
 * catalog.read, catalog.manage, disputes.read, disputes.manage,
 * refunds.approve, configuration.countries.read, notifications.read).
 *
 * `platform_admin` is used as the universal positive fixture — its
 * migration-0050 blanket rule (`WHERE key != 'configuration.write'`,
 * re-applied for Step 1's 3 new keys by migration 0052) means it holds
 * every one of these 7 keys.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  registerUser,
  grantControlCenterRole,
  execD1,
  queryOneD1,
} from './helpers/client.mjs'

async function loginAs(label, roleKey) {
  const { client, email, password, userId } = await registerUser(label)
  await grantControlCenterRole(userId, roleKey)
  const res = await client.post('/control-center/login', { identifier: email, password })
  assert.equal(res.status, 200, `login failed for role ${roleKey}: ${JSON.stringify(res.body)}`)
  return { client, userId }
}

// ---------------------------------------------------------------------------
// Fixture helpers — minimal, direct-D1, following createTestVendor's own
// established style in helpers/client.mjs (test-only, never through a
// public endpoint).
// ---------------------------------------------------------------------------

/** A real category row already seeded by migration 0031 (id=1, 'Home Services') — reused, not created, to avoid schema assumptions about categories.*/
const FIXTURE_CATEGORY_ID = 1

async function createTestCollection(label) {
  const slug = `cctest-step2-collection-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const row = await queryOneD1(
    `INSERT INTO collections (slug, name, description, is_active) VALUES ('${slug}', '${slug}', 'step2 test fixture', 1) RETURNING id`
  )
  return row.id
}

async function createTestCategoryAttribute(label) {
  const key = `cctest_step2_attr_${label}_${Date.now()}`
  const row = await queryOneD1(
    `INSERT INTO category_attributes (category_id, key, label, data_type) VALUES (${FIXTURE_CATEGORY_ID}, '${key}', '${key}', 'text') RETURNING id`
  )
  return row.id
}

/** A minimal vendor + product + product_listing chain with moderation_status='pending_review', matching getPendingModerationQueue()'s exact WHERE clause. */
async function createTestPendingListing(label) {
  const { userId: ownerUserId } = await registerUser(`step2listingowner_${label}`)
  const vslug = `cctest-step2-vendor-${label}-${Date.now()}`
  const vendor = await queryOneD1(
    `INSERT INTO vendors (slug, name, business_email, user_id, verification_status) VALUES ('${vslug}', '${vslug}', 'cctest_${label}@test.ng', ${ownerUserId}, 'verified') RETURNING id`
  )
  const pslug = `cctest-step2-product-${label}-${Date.now()}`
  const product = await queryOneD1(
    `INSERT INTO products (slug, category_id, title, image_url) VALUES ('${pslug}', ${FIXTURE_CATEGORY_ID}, '${pslug}', 'https://example.test/x.png') RETURNING id`
  )
  const listing = await queryOneD1(
    `INSERT INTO product_listings (product_id, vendor_id, price_kobo, stock, moderation_status) VALUES (${product.id}, ${vendor.id}, 100000, 5, 'pending_review') RETURNING id`
  )
  return { listingId: listing.id, vendorId: vendor.id, productId: product.id }
}

/** A minimal paid-enough order row so createAndExecuteRefund() has a captured total_kobo to refund against. No order_items needed for a whole-order refund (orderItemId omitted). */
async function createTestOrderForRefund(label) {
  const { userId } = await registerUser(`step2orderowner_${label}`)
  const orderNumber = `CCTEST-STEP2-${label}-${Date.now()}`
  const order = await queryOneD1(
    `INSERT INTO orders (order_number, user_id, subtotal_kobo, total_kobo, shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state)
     VALUES ('${orderNumber}', ${userId}, 50000, 50000, 'Test Buyer', '08000000000', '1 Test St', 'Lagos', 'Lagos') RETURNING id`
  )
  return order.id
}

/** A minimal open dispute row tied to a fresh order, matching getOpenDisputesForAdmin()'s WHERE status IN ('open','investigating'). */
async function createTestDispute(label) {
  const orderId = await createTestOrderForRefund(`dispute_${label}`)
  const { userId: raisedBy } = await registerUser(`step2disputeraiser_${label}`)
  const dispute = await queryOneD1(
    `INSERT INTO disputes (order_id, raised_by_user_id, reason, status) VALUES (${orderId}, ${raisedBy}, 'item not as described', 'open') RETURNING id`
  )
  return dispute.id
}

// ============================================================
// MODERATION QUEUE — GET /api/control-center/moderation/queue
// requires moderation.read (existing key)
// ============================================================

test('STEP2-1: a role WITH moderation.read (content_admin) can list the moderation queue', async () => {
  await createTestPendingListing('s21')
  const { client } = await loginAs('step2_contentadmin', 'content_admin')
  const res = await client.get('/api/control-center/moderation/queue')
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
  assert.ok(Array.isArray(res.body?.results), 'expected a results array')
})

test('STEP2-2: a role WITHOUT moderation.read (vendor_admin) gets a genuine 403 listing the moderation queue', async () => {
  const { client } = await loginAs('step2_vendoradmin_mod', 'vendor_admin')
  const res = await client.get('/api/control-center/moderation/queue')
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
})

// ============================================================
// COLLECTIONS — requires catalog.read / catalog.manage (Step 1 keys)
// ============================================================

test('STEP2-3: a role WITH catalog.read (platform_admin) can list collections', async () => {
  const { client } = await loginAs('step2_pa_collread', 'platform_admin')
  const res = await client.get('/api/control-center/collections')
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
  assert.ok(Array.isArray(res.body?.results))
})

test('STEP2-4: a role WITHOUT catalog.read (vendor_admin) gets a genuine 403 listing collections', async () => {
  const { client } = await loginAs('step2_va_collread', 'vendor_admin')
  const res = await client.get('/api/control-center/collections')
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
})

test('STEP2-5: a role WITH catalog.manage (platform_admin) can create a collection', async () => {
  const { client } = await loginAs('step2_pa_collcreate', 'platform_admin')
  const slug = `step2-collection-create-${Date.now()}`
  const res = await client.post('/api/control-center/collections', { slug, name: 'Step 2 Test Collection' })
  assert.equal(res.status, 201, `expected 201, got: ${JSON.stringify(res.body)}`)
  assert.ok(res.body?.id)
})

test('STEP2-6: a role WITHOUT catalog.manage (vendor_admin) gets a genuine 403 creating a collection, AND no row is created', async () => {
  const { client } = await loginAs('step2_va_collcreate', 'vendor_admin')
  const slug = `step2-collection-denied-${Date.now()}`
  const res = await client.post('/api/control-center/collections', { slug, name: 'Should Not Be Created' })
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT id FROM collections WHERE slug = '${slug}'`)
  assert.equal(row, null, 'a 403-denied create must never persist a row')
})

test('STEP2-7: a role WITH catalog.manage (platform_admin) can update a collection', async () => {
  const collectionId = await createTestCollection('update_pos')
  const { client } = await loginAs('step2_pa_collupdate', 'platform_admin')
  const res = await client.patch(`/api/control-center/collections/${collectionId}`, { name: 'Renamed by Step 2 test' })
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
})

test('STEP2-8: a role WITHOUT catalog.manage (vendor_admin) gets a genuine 403 updating a collection, AND the row is unchanged', async () => {
  const collectionId = await createTestCollection('update_neg')
  const { client } = await loginAs('step2_va_collupdate', 'vendor_admin')
  const res = await client.patch(`/api/control-center/collections/${collectionId}`, { name: 'Should Not Apply' })
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT name FROM collections WHERE id = ${collectionId}`)
  assert.notEqual(row.name, 'Should Not Apply', 'a 403-denied update must never mutate the row')
})

test('STEP2-9: a role WITH catalog.manage (platform_admin) can activate/deactivate a collection', async () => {
  const collectionId = await createTestCollection('activate_pos')
  const { client } = await loginAs('step2_pa_collactivate', 'platform_admin')
  const deactivate = await client.post(`/api/control-center/collections/${collectionId}/deactivate`, {})
  assert.equal(deactivate.status, 200, `expected success, got: ${JSON.stringify(deactivate.body)}`)
  const activate = await client.post(`/api/control-center/collections/${collectionId}/activate`, {})
  assert.equal(activate.status, 200, `expected success, got: ${JSON.stringify(activate.body)}`)
})

test('STEP2-10: a role WITHOUT catalog.manage (vendor_admin) gets a genuine 403 activating/deactivating a collection', async () => {
  const collectionId = await createTestCollection('activate_neg')
  const { client } = await loginAs('step2_va_collactivate', 'vendor_admin')
  const res = await client.post(`/api/control-center/collections/${collectionId}/deactivate`, {})
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT is_active FROM collections WHERE id = ${collectionId}`)
  assert.equal(Number(row.is_active), 1, 'a 403-denied deactivate must never mutate the row (fixture starts active)')
})

test('STEP2-11: a role WITH catalog.read (platform_admin) can list a collection\'s products', async () => {
  const collectionId = await createTestCollection('products_read_pos')
  const { client } = await loginAs('step2_pa_collprodread', 'platform_admin')
  const res = await client.get(`/api/control-center/collections/${collectionId}/products`)
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
  assert.ok(Array.isArray(res.body?.results))
})

test('STEP2-12: a role WITHOUT catalog.read (vendor_admin) gets a genuine 403 listing a collection\'s products', async () => {
  const collectionId = await createTestCollection('products_read_neg')
  const { client } = await loginAs('step2_va_collprodread', 'vendor_admin')
  const res = await client.get(`/api/control-center/collections/${collectionId}/products`)
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
})

test('STEP2-13: a role WITH catalog.manage (platform_admin) can add a product to a collection', async () => {
  const collectionId = await createTestCollection('products_add_pos')
  const { productId } = await createTestPendingListing('addprod_pos')
  const { client } = await loginAs('step2_pa_collprodadd', 'platform_admin')
  const res = await client.post(`/api/control-center/collections/${collectionId}/products`, { product_id: productId })
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
})

test('STEP2-14: a role WITHOUT catalog.manage (vendor_admin) gets a genuine 403 adding a product to a collection, AND no row is created', async () => {
  const collectionId = await createTestCollection('products_add_neg')
  const { productId } = await createTestPendingListing('addprod_neg')
  const { client } = await loginAs('step2_va_collprodadd', 'vendor_admin')
  const res = await client.post(`/api/control-center/collections/${collectionId}/products`, { product_id: productId })
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT product_id FROM product_collections WHERE collection_id = ${collectionId} AND product_id = ${productId}`)
  assert.equal(row, null, 'a 403-denied add-to-collection must never persist a row')
})

test('STEP2-15: a role WITH catalog.manage (platform_admin) can remove a product from a collection', async () => {
  const collectionId = await createTestCollection('products_remove_pos')
  const { productId } = await createTestPendingListing('removeprod_pos')
  const { client } = await loginAs('step2_pa_collprodremove', 'platform_admin')
  await client.post(`/api/control-center/collections/${collectionId}/products`, { product_id: productId })
  const res = await client.delete(`/api/control-center/collections/${collectionId}/products/${productId}`)
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
})

test('STEP2-16: a role WITHOUT catalog.manage (vendor_admin) gets a genuine 403 removing a product from a collection, AND the row survives', async () => {
  const collectionId = await createTestCollection('products_remove_neg')
  const { productId } = await createTestPendingListing('removeprod_neg')
  const { client: paClient } = await loginAs('step2_pa_seed_removeneg', 'platform_admin')
  await paClient.post(`/api/control-center/collections/${collectionId}/products`, { product_id: productId })

  const { client } = await loginAs('step2_va_collprodremove', 'vendor_admin')
  const res = await client.delete(`/api/control-center/collections/${collectionId}/products/${productId}`)
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT product_id FROM product_collections WHERE collection_id = ${collectionId} AND product_id = ${productId}`)
  assert.ok(row, 'a 403-denied remove must never delete the row')
})

test('STEP2-17: a role WITH catalog.manage (platform_admin) can reorder a collection\'s products', async () => {
  const collectionId = await createTestCollection('reorder_pos')
  const { productId } = await createTestPendingListing('reorder_pos')
  const { client } = await loginAs('step2_pa_collreorder', 'platform_admin')
  await client.post(`/api/control-center/collections/${collectionId}/products`, { product_id: productId })
  const res = await client.post(`/api/control-center/collections/${collectionId}/reorder`, { product_ids: [productId] })
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
})

test('STEP2-18: a role WITHOUT catalog.manage (vendor_admin) gets a genuine 403 reordering a collection\'s products', async () => {
  const collectionId = await createTestCollection('reorder_neg')
  const { client } = await loginAs('step2_va_collreorder', 'vendor_admin')
  const res = await client.post(`/api/control-center/collections/${collectionId}/reorder`, { product_ids: [] })
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
})

// ============================================================
// CATEGORY ATTRIBUTES — requires catalog.read / catalog.manage
// ============================================================

test('STEP2-19: a role WITH catalog.read (platform_admin) can list category attributes', async () => {
  await createTestCategoryAttribute('list_pos')
  const { client } = await loginAs('step2_pa_attrread', 'platform_admin')
  const res = await client.get(`/api/control-center/categories/${FIXTURE_CATEGORY_ID}/attributes`)
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
  assert.ok(Array.isArray(res.body?.results))
})

test('STEP2-20: a role WITHOUT catalog.read (vendor_admin) gets a genuine 403 listing category attributes', async () => {
  const { client } = await loginAs('step2_va_attrread', 'vendor_admin')
  const res = await client.get(`/api/control-center/categories/${FIXTURE_CATEGORY_ID}/attributes`)
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
})

test('STEP2-21: a role WITH catalog.manage (platform_admin) can create a category attribute', async () => {
  const { client } = await loginAs('step2_pa_attrcreate', 'platform_admin')
  const key = `step2_attr_create_${Date.now()}`
  const res = await client.post(`/api/control-center/categories/${FIXTURE_CATEGORY_ID}/attributes`, { key, label: key, data_type: 'text' })
  assert.equal(res.status, 201, `expected 201, got: ${JSON.stringify(res.body)}`)
  assert.ok(res.body?.id)
})

test('STEP2-22: a role WITHOUT catalog.manage (vendor_admin) gets a genuine 403 creating a category attribute, AND no row is created', async () => {
  const { client } = await loginAs('step2_va_attrcreate', 'vendor_admin')
  const key = `step2_attr_denied_${Date.now()}`
  const res = await client.post(`/api/control-center/categories/${FIXTURE_CATEGORY_ID}/attributes`, { key, label: key, data_type: 'text' })
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT id FROM category_attributes WHERE key = '${key}'`)
  assert.equal(row, null, 'a 403-denied create must never persist a row')
})

test('STEP2-23: a role WITH catalog.manage (platform_admin) can update a category attribute', async () => {
  const attrId = await createTestCategoryAttribute('update_pos')
  const { client } = await loginAs('step2_pa_attrupdate', 'platform_admin')
  const res = await client.patch(`/api/control-center/attributes/${attrId}`, { label: 'Renamed by Step 2 test' })
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
})

test('STEP2-24: a role WITHOUT catalog.manage (vendor_admin) gets a genuine 403 updating a category attribute, AND the row is unchanged', async () => {
  const attrId = await createTestCategoryAttribute('update_neg')
  const { client } = await loginAs('step2_va_attrupdate', 'vendor_admin')
  const res = await client.patch(`/api/control-center/attributes/${attrId}`, { label: 'Should Not Apply' })
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT label FROM category_attributes WHERE id = ${attrId}`)
  assert.notEqual(row.label, 'Should Not Apply', 'a 403-denied update must never mutate the row')
})

test('STEP2-25: a role WITH catalog.manage (platform_admin) can delete a category attribute', async () => {
  const attrId = await createTestCategoryAttribute('delete_pos')
  const { client } = await loginAs('step2_pa_attrdelete', 'platform_admin')
  const res = await client.delete(`/api/control-center/attributes/${attrId}`)
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
})

test('STEP2-26: a role WITHOUT catalog.manage (vendor_admin) gets a genuine 403 deleting a category attribute, AND the row survives', async () => {
  const attrId = await createTestCategoryAttribute('delete_neg')
  const { client } = await loginAs('step2_va_attrdelete', 'vendor_admin')
  const res = await client.delete(`/api/control-center/attributes/${attrId}`)
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT id FROM category_attributes WHERE id = ${attrId}`)
  assert.ok(row, 'a 403-denied delete must never remove the row')
})

// ============================================================
// DISPUTES & REFUNDS — requires disputes.read / disputes.manage / refunds.approve
// ============================================================

test('STEP2-27: a role WITH disputes.read (operations_admin) can list open disputes', async () => {
  await createTestDispute('list_pos')
  const { client } = await loginAs('step2_opsadmin_dispread', 'operations_admin')
  const res = await client.get('/api/control-center/disputes')
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
  assert.ok(Array.isArray(res.body?.results))
})

test('STEP2-28: a role WITHOUT disputes.read (vendor_admin) gets a genuine 403 listing disputes', async () => {
  const { client } = await loginAs('step2_va_dispread', 'vendor_admin')
  const res = await client.get('/api/control-center/disputes')
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
})

test('STEP2-29: a role WITH disputes.manage (operations_admin) can resolve a dispute', async () => {
  const disputeId = await createTestDispute('resolve_pos')
  const { client } = await loginAs('step2_opsadmin_dispmanage', 'operations_admin')
  const res = await client.post(`/api/control-center/disputes/${disputeId}/resolve`, { status: 'resolved', note: 'Step 2 test resolution' })
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
})

test('STEP2-30: a role WITHOUT disputes.manage (support_admin — has disputes.read but not disputes.manage per migration 0050) gets a genuine 403 resolving a dispute, AND the dispute stays open', async () => {
  const disputeId = await createTestDispute('resolve_neg')
  const { client } = await loginAs('step2_support_dispmanage', 'support_admin')
  const res = await client.post(`/api/control-center/disputes/${disputeId}/resolve`, { status: 'resolved', note: 'Should not apply' })
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT status FROM disputes WHERE id = ${disputeId}`)
  assert.equal(row.status, 'open', 'a 403-denied resolve must never mutate dispute status — support_admin has disputes.read only, proving read/manage split')
})

test('STEP2-31: a role WITH refunds.approve (finance_admin) can execute a refund', async () => {
  const orderId = await createTestOrderForRefund('refund_pos')
  const { client } = await loginAs('step2_financeadmin_refund', 'finance_admin')
  const res = await client.post(`/api/control-center/orders/${orderId}/refund`, { amount_kobo: 10000, reason: 'Step 2 test refund' })
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
  assert.ok(res.body?.refundId)
})

test('STEP2-32: a role WITHOUT refunds.approve (vendor_admin) gets a genuine 403 attempting a refund, AND no refund row is created', async () => {
  const orderId = await createTestOrderForRefund('refund_neg')
  const { client } = await loginAs('step2_va_refund', 'vendor_admin')
  const res = await client.post(`/api/control-center/orders/${orderId}/refund`, { amount_kobo: 10000, reason: 'Should not apply' })
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
  const row = await queryOneD1(`SELECT id FROM refunds WHERE order_id = ${orderId}`)
  assert.equal(row, null, 'a 403-denied refund attempt must never create a refund row or credit a wallet')
})

// ============================================================
// COUNTRY REFERENCE DATA — requires configuration.countries.read (Step 1 key)
// ============================================================

test('STEP2-33: a role WITH configuration.countries.read (platform_admin) can list countries', async () => {
  const { client } = await loginAs('step2_pa_countries', 'platform_admin')
  const res = await client.get('/api/control-center/countries')
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
  assert.ok(Array.isArray(res.body?.results) && res.body.results.length > 0, 'expected the 10 pre-seeded cc_countries rows')
})

test('STEP2-34: a role WITHOUT configuration.countries.read (vendor_admin) gets a genuine 403 listing countries', async () => {
  const { client } = await loginAs('step2_va_countries', 'vendor_admin')
  const res = await client.get('/api/control-center/countries')
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
})

// ============================================================
// NOTIFICATIONS OVERVIEW — requires notifications.read (existing key)
// ============================================================

test('STEP2-35: a role WITH notifications.read (marketing_admin) can view the notifications overview', async () => {
  const { client } = await loginAs('step2_marketingadmin_notif', 'marketing_admin')
  const res = await client.get('/api/control-center/notifications/overview')
  assert.equal(res.status, 200, `expected success, got: ${JSON.stringify(res.body)}`)
})

test('STEP2-36: a role WITHOUT notifications.read (vendor_admin) gets a genuine 403 viewing the notifications overview', async () => {
  const { client } = await loginAs('step2_va_notif', 'vendor_admin')
  const res = await client.get('/api/control-center/notifications/overview')
  assert.equal(res.status, 403, `expected 403, got: ${res.status} ${JSON.stringify(res.body)}`)
})

// ============================================================
// RETIREMENT PROOF — the 19 re-homed routes must be genuinely GONE from
// api-admin.ts (404, not merely re-gated), per ADR-001 §10 requirement #1's
// pattern applied to Step 2's re-homing (not Step 3's separate retirement
// of the 4/5 OVERLAPPING routes, which remain live in api-admin.ts by
// design and are explicitly NOT covered by this test file).
// ============================================================

test('STEP2-37: all 19 re-homed routes now return a genuine 404 under their OLD /api/admin/* path — proving true re-homing, not dual-mounting', async () => {
  // A genuine users.role='admin' account is required to distinguish a
  // TRUE 404 (route deleted) from the blanket requirePlatformRole('admin')
  // middleware's own 401/403 (which would mask a still-existing route).
  const fresh = await registerUser('step2_legacyadmin_404check')
  await execD1(`UPDATE users SET role = 'admin' WHERE id = ${fresh.userId}`)
  const loginRes = await fresh.client.post('/api/auth/login', { identifier: fresh.email, password: fresh.password })
  assert.equal(loginRes.status, 200)

  const oldPaths = [
    ['GET', '/api/admin/moderation/queue'],
    ['GET', '/api/admin/collections'],
    ['POST', '/api/admin/collections'],
    ['PATCH', '/api/admin/collections/1'],
    ['POST', '/api/admin/collections/1/activate'],
    ['POST', '/api/admin/collections/1/deactivate'],
    ['GET', '/api/admin/collections/1/products'],
    ['POST', '/api/admin/collections/1/products'],
    ['DELETE', '/api/admin/collections/1/products/1'],
    ['POST', '/api/admin/collections/1/reorder'],
    ['GET', `/api/admin/categories/${FIXTURE_CATEGORY_ID}/attributes`],
    ['POST', `/api/admin/categories/${FIXTURE_CATEGORY_ID}/attributes`],
    ['PATCH', '/api/admin/attributes/1'],
    ['DELETE', '/api/admin/attributes/1'],
    ['GET', '/api/admin/disputes'],
    ['POST', '/api/admin/disputes/1/resolve'],
    ['POST', '/api/admin/orders/1/refund'],
    ['GET', '/api/admin/countries'],
    ['GET', '/api/admin/notifications/overview'],
  ]
  assert.equal(oldPaths.length, 19, 'this list must cover exactly the 19 re-homed routes')

  for (const [method, path] of oldPaths) {
    const res =
      method === 'GET' ? await fresh.client.get(path)
      : method === 'POST' ? await fresh.client.post(path, {})
      : method === 'PATCH' ? await fresh.client.patch(path, {})
      : await fresh.client.delete(path)
    assert.equal(res.status, 404, `expected 404 (route genuinely deleted) for ${method} ${path}, got: ${res.status} ${JSON.stringify(res.body)}`)
  }
})

test('STEP2-38: the Step-3-territory overlap routes remain LIVE (not 404) in api-admin.ts, unchanged by this Step — proving Step 2 did not accidentally delete Step 3\'s scope', async () => {
  const fresh = await registerUser('step2_legacyadmin_liveoverlap')
  await execD1(`UPDATE users SET role = 'admin' WHERE id = ${fresh.userId}`)
  const loginRes = await fresh.client.post('/api/auth/login', { identifier: fresh.email, password: fresh.password })
  assert.equal(loginRes.status, 200)

  // moderation/listings/:id has an app-level "not found" JSON body for a
  // nonexistent id — distinct from a Hono routing 404 (no body / different
  // shape). A 404 status ALONE would be ambiguous here, so we assert on the
  // specific app-level error message that only a live handler can produce.
  const listingRes = await fresh.client.get('/api/admin/moderation/listings/999999')
  assert.equal(listingRes.status, 404, `expected app-level 404, got: ${JSON.stringify(listingRes.body)}`)
  assert.equal(listingRes.body?.error, 'Listing not found', 'moderation/listings/:id is Step 3 territory and must remain live (app-level 404, not routing 404)')

  // process-outbox / retry-failed have no "not found" case — a 200 here proves the route exists and is live.
  const outboxRes = await fresh.client.post('/api/admin/notifications/process-outbox', {})
  assert.equal(outboxRes.status, 200, 'process-outbox is Step 3 territory and must remain live in api-admin.ts')
  const retryRes = await fresh.client.post('/api/admin/notifications/retry-failed', {})
  assert.equal(retryRes.status, 200, 'retry-failed is Step 3 territory and must remain live in api-admin.ts')

  // users/:id/status has no "not found" for a malformed body — a 400 (not 404) proves the route is live.
  const statusRes = await fresh.client.post('/api/admin/users/1/status', {})
  assert.equal(statusRes.status, 400, 'users/:id/status is Step 3 territory and must remain live in api-admin.ts')
})
