/**
 * Stage 2C — Organization -> vendor country propagation.
 * Proves the confirmed vendor-country bug fix in createOrganizationStore():
 * a GH-country organization's store must get country_iso='GH', NOT silently
 * default to 'NG'. Also proves the pre-existing NG path is unaffected.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, cleanupRunNonce, queryOneD1, RUN_NONCE } from './helpers/client.mjs'

let user

test.before(async () => {
  user = await registerUser('orgcountry')
})

test.after(async () => {
  // organizations/vendors created by this suite aren't covered by
  // cleanupRunNonce's user-email-based sweep — clean them up explicitly.
  // IMPORTANT: this must run BEFORE cleanupRunNonce(). organizations.created_by_user_id
  // and vendors.user_id both carry a FOREIGN KEY REFERENCES users(id) — if the org/vendor
  // rows created by this test are still present when cleanupRunNonce() tries to
  // DELETE FROM users, SQLite rejects it with SQLITE_CONSTRAINT_FOREIGNKEY. Deleting
  // child rows (vendors, organization_members, organizations) first, then the user,
  // respects the FK dependency order.
  const { execD1 } = await import('./helpers/client.mjs')
  await execD1(
    `DELETE FROM vendors WHERE organization_id IN (SELECT id FROM organizations WHERE name LIKE 'OrgCountryTest%');` +
    `DELETE FROM organization_members WHERE organization_id IN (SELECT id FROM organizations WHERE name LIKE 'OrgCountryTest%');` +
    `DELETE FROM organizations WHERE name LIKE 'OrgCountryTest%';`
  )
  await cleanupRunNonce(RUN_NONCE)
})

test('a GH-country organization creating a store with NO explicit country_iso in the request gets GH, not silently NG', async () => {
  const orgRes = await user.client.post('/api/organizations', {
    name: `OrgCountryTest-GH-${Date.now()}`,
    organization_type: 'business',
    country_iso: 'GH',
  })
  assert.equal(orgRes.status, 200, JSON.stringify(orgRes.body))
  assert.equal(orgRes.body.organization.country_iso, 'GH')
  const organizationId = orgRes.body.organization.id

  // Confirm the org row itself is GH before creating the store.
  const orgRow = await queryOneD1(`SELECT country_iso FROM organizations WHERE id = ${organizationId}`)
  assert.equal(orgRow.country_iso, 'GH')

  const storeRes = await user.client.post(`/api/organizations/${organizationId}/store`, {
    name: 'Accra Test Store',
    // NOTE: deliberately omitting country_iso — this is the exact bug scenario:
    // the body has no country_iso, so createOrganizationStore() must resolve
    // it from the parent organization, never fall back to a bare 'NG' default.
  })
  assert.equal(storeRes.status, 201, JSON.stringify(storeRes.body))
  assert.equal(storeRes.body.store.country_iso, 'GH', 'vendor store must inherit the GH-country organization\'s country_iso, not silently default to NG')
})

test('an NG-country organization (or one with no country_iso at all) still gets NG — the pre-existing default path is unaffected', async () => {
  const orgRes = await user.client.post('/api/organizations', {
    name: `OrgCountryTest-NG-${Date.now()}`,
    organization_type: 'business',
    // no country_iso supplied at all — should default to NG at the organizations layer
  })
  assert.equal(orgRes.status, 200, JSON.stringify(orgRes.body))
  assert.equal(orgRes.body.organization.country_iso, 'NG')
  const organizationId = orgRes.body.organization.id

  const storeRes = await user.client.post(`/api/organizations/${organizationId}/store`, {
    name: 'Lagos Test Store',
  })
  assert.equal(storeRes.status, 201, JSON.stringify(storeRes.body))
  assert.equal(storeRes.body.store.country_iso, 'NG')
})

test('an explicit body.country_iso on the store-creation request still wins over the organization default (explicit input takes precedence)', async () => {
  const orgRes = await user.client.post('/api/organizations', {
    name: `OrgCountryTest-Explicit-${Date.now()}`,
    organization_type: 'business',
    country_iso: 'NG',
  })
  const organizationId = orgRes.body.organization.id

  // Body explicitly says GH even though the org itself is NG — validated
  // server-side input should win, per the field's own doc comment.
  const storeRes = await user.client.post(`/api/organizations/${organizationId}/store`, {
    name: 'Explicit Country Store',
    country_iso: 'GH',
  })
  assert.equal(storeRes.status, 201, JSON.stringify(storeRes.body))
  assert.equal(storeRes.body.store.country_iso, 'GH')
})
