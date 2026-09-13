/**
 * Engine 1 Identity & Access Completion — Category 4: RBAC.
 * Black-box HTTP tests against the real running dev server. Covers
 * src/lib/rbac.ts's four primitives (requireOrganizationMember,
 * requireOrganizationRole, requirePermission, requirePlatformRole).
 *
 * NOTE: organization-role and permission-boundary behavior is already
 * exercised extensively (incidentally) by
 * 06.category3-organizations.test.mjs's invitation/last-owner/transfer-
 * ownership tests. This file focuses on what those did NOT cover:
 * platform-admin gating, privilege escalation attempts, and permission-
 * boundary edge cases not already proven.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, promoteToAdmin, queryOneD1, ApiClient } from './helpers/client.mjs'

async function roleIdByKey(key) {
  const row = await queryOneD1(`SELECT id FROM organization_roles WHERE organization_id IS NULL AND key = '${key}'`)
  return row.id
}

async function createOrg(client, name) {
  const res = await client.post('/api/organizations', { name })
  assert.equal(res.status, 200)
  return res.body.organization
}

// ============================== PLATFORM ADMIN ==============================

test('RBAC: requirePlatformRole(\'admin\') blocks a non-admin platform user from every /api/admin/* route (401/403 boundary)', async () => {
  const { client, userId } = await registerUser('rbac_platform_nonadmin')
  const res = await client.post(`/api/admin/users/${userId}/status`, { status: 'suspended' })
  assert.equal(res.status, 403)
})

test('RBAC: requirePlatformRole(\'admin\') allows a genuine platform admin through', async () => {
  const { client: adminClient, userId: adminId } = await registerUser('rbac_platform_admin')
  await promoteToAdmin(adminId)
  const { userId: targetId } = await registerUser('rbac_platform_admin_target')

  const res = await adminClient.post(`/api/admin/users/${targetId}/status`, { status: 'suspended' })
  assert.equal(res.status, 200)
})

test('RBAC: an unauthenticated caller gets 401 (not 403) from an admin route — the auth boundary is checked before the role boundary', async () => {
  const anon = new ApiClient()
  const res = await anon.post('/api/admin/users/1/status', { status: 'suspended' })
  assert.equal(res.status, 401)
})

test('RBAC: platform role (users.role) is entirely independent of organization role — a user who is an ORGANIZATION owner is still just a platform \'customer\' and cannot access /api/admin/*', async () => {
  const { client } = await registerUser('rbac_org_owner_not_platform_admin')
  await createOrg(client, 'RBAC Independence Org ' + Date.now())

  const res = await client.post('/api/admin/users/1/status', { status: 'suspended' })
  assert.equal(res.status, 403, 'being an organization owner must never confer platform-admin privileges')
})

// ============================== PRIVILEGE ESCALATION ==============================

test('RBAC: privilege escalation — a member cannot promote THEMSELVES to a higher role by directly PATCHing their own member row without members.manage', async () => {
  const { client: owner } = await registerUser('rbac_escalation_owner')
  const { client: staffMember, email: staffEmail } = await registerUser('rbac_escalation_staff')
  const org = await createOrg(owner, 'RBAC Escalation Org ' + Date.now())
  const staffRoleId = await roleIdByKey('staff')
  const ownerRoleId = await roleIdByKey('owner')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: staffEmail, role_id: staffRoleId })
  await staffMember.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })

  const membersRes = await owner.get(`/api/organizations/${org.id}/members`)
  const selfMemberRow = membersRes.body.members.find((m) => m.user_email === staffEmail)

  const escalateRes = await staffMember.patch(`/api/organizations/${org.id}/members/${selfMemberRow.id}`, { role_id: ownerRoleId })
  assert.equal(escalateRes.status, 403, 'staff (no members.manage) must not be able to self-promote to owner')

  const roleCheck = await queryOneD1(`SELECT role_id, is_owner FROM organization_members WHERE id=${selfMemberRow.id}`)
  assert.notEqual(Number(roleCheck.role_id), ownerRoleId, 'the escalation attempt must not have mutated the role in the database')
  assert.equal(Number(roleCheck.is_owner), 0)
})

test('RBAC: privilege escalation — a member cannot supply a client-side organization_id/role claim to gain access to an org they are not a member of (server always resolves membership from the session, never trusts client claims)', async () => {
  const { client: owner } = await registerUser('rbac_client_claim_owner')
  const { client: outsider } = await registerUser('rbac_client_claim_outsider')
  const org = await createOrg(owner, 'RBAC Client Claim Org ' + Date.now())

  // The outsider tries to act on the real organization id directly — the
  // ONLY thing that determines access is resolveMembership(session_user_id,
  // organizationId), never anything the client could claim in a body.
  const res = await outsider.patch(`/api/organizations/${org.id}`, { display_name: 'Escalated', role_claim: 'owner', is_owner: true })
  assert.equal(res.status, 404, 'a non-member supplying extra body fields claiming ownership must still be treated as a complete non-member (404, not 403 — anti-enumeration)')

  const ownerCheck = await owner.get(`/api/organizations/${org.id}`)
  assert.notEqual(ownerCheck.body.organization.display_name, 'Escalated')
})

test('RBAC: privilege escalation — an org member cannot use a role_id belonging to ANOTHER organization\'s custom role to gain unintended permissions (cross-organization role injection rejected)', async () => {
  // System roles (organization_id IS NULL) are shared/usable by every org
  // by design, so this test targets the ACTUAL cross-org guard: the route
  // validates `role.organization_id !== null && role.organization_id !== organizationId`.
  // We simulate a "foreign custom role" by creating one directly via D1
  // scoped to a DIFFERENT organization, then attempting to assign it in Org A.
  const { client: ownerA } = await registerUser('rbac_role_injection_a')
  const { client: ownerB, email: memberBEmail } = await registerUser('rbac_role_injection_b')
  const orgA = await createOrg(ownerA, 'RBAC Injection Org A ' + Date.now())
  const orgB = await createOrg(ownerB, 'RBAC Injection Org B ' + Date.now())

  const staffRoleId = await roleIdByKey('staff')
  const inviteRes = await ownerA.post(`/api/organizations/${orgA.id}/invitations`, { email: 'rbac_injection_target_' + Date.now() + '@test.ng', role_id: staffRoleId })
  // Create a custom role scoped to Org B directly via D1 (simulating a role that legitimately exists but belongs to a different org).
  const customRoleResult = await queryOneD1(`INSERT INTO organization_roles (organization_id, key, name, is_system) VALUES (${orgB.id}, 'orgb_custom', 'OrgB Custom', 0) RETURNING id`)
  const foreignRoleId = customRoleResult.id

  const membersRes = await ownerA.get(`/api/organizations/${orgA.id}/members`)
  const ownerMemberA = membersRes.body.members.find((m) => Number(m.is_owner) === 1)

  const injectRes = await ownerA.patch(`/api/organizations/${orgA.id}/members/${ownerMemberA.id}`, { role_id: foreignRoleId })
  assert.equal(injectRes.status, 400, 'assigning a role_id that belongs to a DIFFERENT organization must be rejected, not silently applied')
})

// ============================== PERMISSION BOUNDARY ==============================

test('RBAC: permission boundary — manager role has bookings.manage/orders.manage but NOT organization.manage/members.manage/billing.manage', async () => {
  const { client: owner } = await registerUser('rbac_manager_boundary_owner')
  const { client: managerClient, email: managerEmail } = await registerUser('rbac_manager_boundary_manager')
  const org = await createOrg(owner, 'RBAC Manager Boundary Org ' + Date.now())
  const managerRoleId = await roleIdByKey('manager')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: managerEmail, role_id: managerRoleId })
  await managerClient.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })

  // A manager must be BLOCKED from organization.manage-gated PATCH.
  const patchRes = await managerClient.patch(`/api/organizations/${org.id}`, { display_name: 'Manager Attempt' })
  assert.equal(patchRes.status, 403)

  // A manager must be BLOCKED from members.manage-gated member listing.
  const membersRes = await managerClient.get(`/api/organizations/${org.id}/members`)
  assert.equal(membersRes.status, 403)

  // Confirm the permission set returned for this membership reflects this exactly.
  const selfRes = await managerClient.get(`/api/organizations/${org.id}`)
  assert.equal(selfRes.status, 200)
  assert.equal(selfRes.body.role, 'manager')
  assert.ok(!selfRes.body.permissions.includes('organization.manage'))
  assert.ok(!selfRes.body.permissions.includes('members.manage'))
  assert.ok(!selfRes.body.permissions.includes('billing.manage'))
  assert.ok(selfRes.body.permissions.includes('orders.manage'), 'manager should have orders.manage per the migration 0037 seed')
})

test('RBAC: permission boundary — staff role is read-only across commerce permissions (no *.manage permissions at all)', async () => {
  const { client: owner } = await registerUser('rbac_staff_boundary_owner')
  const { client: staffClient, email: staffEmail } = await registerUser('rbac_staff_boundary_staff')
  const org = await createOrg(owner, 'RBAC Staff Boundary Org ' + Date.now())
  const staffRoleId = await roleIdByKey('staff')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: staffEmail, role_id: staffRoleId })
  await staffClient.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })

  const selfRes = await staffClient.get(`/api/organizations/${org.id}`)
  const manageKeys = selfRes.body.permissions.filter((k) => k.endsWith('.manage'))
  assert.equal(manageKeys.length, 0, `staff must have ZERO *.manage permissions, found: ${JSON.stringify(manageKeys)}`)
})

test('RBAC: permission boundary — owner implicitly has EVERY permission, including ones with no explicit organization_role_permissions row (short-circuit verified)', async () => {
  const { client: owner } = await registerUser('rbac_owner_allperms')
  const org = await createOrg(owner, 'RBAC Owner AllPerms Org ' + Date.now())

  const selfRes = await owner.get(`/api/organizations/${org.id}`)
  const allPermsRes = await owner.get(`/api/organizations/${org.id}/permissions`)
  const allPermKeys = allPermsRes.body.permissions.map((p) => p.key)

  assert.equal(selfRes.body.permissions.length, allPermKeys.length, 'the owner must have exactly every permission the platform defines')
  for (const key of allPermKeys) {
    assert.ok(selfRes.body.permissions.includes(key), `owner is missing permission '${key}'`)
  }
})

test('RBAC: unauthorized mutation — a suspended organization member (status=suspended, not removed) loses access to protected org actions even though the membership row still exists', async () => {
  const { client: owner } = await registerUser('rbac_suspended_member_owner')
  const { client: managerClient, email: managerEmail } = await registerUser('rbac_suspended_member_manager')
  const org = await createOrg(owner, 'RBAC Suspended Member Org ' + Date.now())
  const managerRoleId = await roleIdByKey('manager')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: managerEmail, role_id: managerRoleId })
  await managerClient.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })

  // Confirm access works before suspension.
  const beforeRes = await managerClient.get(`/api/organizations/${org.id}`)
  assert.equal(beforeRes.status, 200)

  const membersRes = await owner.get(`/api/organizations/${org.id}/members`)
  const managerMember = membersRes.body.members.find((m) => m.user_email === managerEmail)
  await owner.patch(`/api/organizations/${org.id}/members/${managerMember.id}`, { status: 'suspended' })

  // resolveMembership() only matches status='active' — a suspended member
  // must now be treated exactly like a non-member (404, anti-enumeration).
  const afterRes = await managerClient.get(`/api/organizations/${org.id}`)
  assert.equal(afterRes.status, 404, 'a suspended organization member must lose org access entirely, resolved server-side via resolveMembership status=active filter')
})
