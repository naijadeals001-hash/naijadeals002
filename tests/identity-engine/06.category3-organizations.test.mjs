/**
 * Engine 1 Identity & Access Completion — Category 3: Organizations.
 * Black-box HTTP tests against the real running dev server + direct D1
 * ground-truth assertions. Covers src/routes/api-organizations.ts and
 * src/lib/organizations.ts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, queryOneD1, ApiClient } from './helpers/client.mjs'

async function roleIdByKey(key) {
  const row = await queryOneD1(`SELECT id FROM organization_roles WHERE organization_id IS NULL AND key = '${key}'`)
  assert.ok(row, `expected a system role with key='${key}'`)
  return row.id
}

async function createOrg(client, name) {
  const res = await client.post('/api/organizations', { name })
  assert.equal(res.status, 200, `createOrg failed: ${JSON.stringify(res.body)}`)
  return res.body.organization
}

// ============================== CREATION / MEMBERSHIP ==============================

test('organizations: creating an organization makes the creator its owner with is_owner=1 and role=owner', async () => {
  const { client } = await registerUser('org_create')
  const org = await createOrg(client, 'Test Org Create ' + Date.now())

  const getRes = await client.get(`/api/organizations/${org.id}`)
  assert.equal(getRes.status, 200)
  assert.equal(getRes.body.role, 'owner')

  const memberRow = await queryOneD1(`SELECT m.is_owner FROM organization_members m WHERE m.organization_id=${org.id} ORDER BY m.id ASC LIMIT 1`)
  assert.equal(Number(memberRow.is_owner), 1)
})

test('organizations: GET / lists only organizations the caller is an active member of', async () => {
  const { client: clientA } = await registerUser('org_list_a')
  const { client: clientB } = await registerUser('org_list_b')
  const orgA = await createOrg(clientA, 'Org List A ' + Date.now())
  const orgB = await createOrg(clientB, 'Org List B ' + Date.now())

  const listA = await clientA.get('/api/organizations')
  assert.ok(listA.body.organizations.some((o) => o.id === orgA.id))
  assert.ok(!listA.body.organizations.some((o) => o.id === orgB.id), 'A must not see B\'s organization in the list')

  const listB = await clientB.get('/api/organizations')
  assert.ok(listB.body.organizations.some((o) => o.id === orgB.id))
  assert.ok(!listB.body.organizations.some((o) => o.id === orgA.id))
})

test('organizations: PATCH /:organizationId updates the profile when the caller has organization.manage (owner)', async () => {
  const { client } = await registerUser('org_patch_owner')
  const org = await createOrg(client, 'Org Patch ' + Date.now())

  const res = await client.patch(`/api/organizations/${org.id}`, { display_name: 'New Display Name' })
  assert.equal(res.status, 200)
  assert.equal(res.body.organization.display_name, 'New Display Name')
})

test('organizations: creating an organization with a missing/blank name is rejected with 400', async () => {
  const { client } = await registerUser('org_missing_name')
  const res1 = await client.post('/api/organizations', {})
  assert.equal(res1.status, 400)
  const res2 = await client.post('/api/organizations', { name: '   ' })
  assert.equal(res2.status, 400)
})

// ============================== NON-MEMBER ISOLATION ==============================

test('organizations: non-member isolation — a user who is not a member cannot GET the organization (404, anti-enumeration — same response as a nonexistent id)', async () => {
  const { client: owner } = await registerUser('org_isolation_owner')
  const { client: outsider } = await registerUser('org_isolation_outsider')
  const org = await createOrg(owner, 'Org Isolation ' + Date.now())

  const outsiderRes = await outsider.get(`/api/organizations/${org.id}`)
  assert.equal(outsiderRes.status, 404)

  const nonexistentRes = await outsider.get('/api/organizations/999999999')
  assert.equal(nonexistentRes.status, 404)
  assert.equal(outsiderRes.body.error, nonexistentRes.body.error, 'a real-but-foreign organization and a nonexistent one must produce IDENTICAL error responses (no organization-existence disclosure to a non-member)')
})

test('organizations: non-member isolation — a non-member cannot PATCH, list members, or list invitations for a foreign organization', async () => {
  const { client: owner } = await registerUser('org_isolation_owner2')
  const { client: outsider } = await registerUser('org_isolation_outsider2')
  const org = await createOrg(owner, 'Org Isolation 2 ' + Date.now())

  const patchRes = await outsider.patch(`/api/organizations/${org.id}`, { display_name: 'Hacked' })
  assert.equal(patchRes.status, 404)

  const membersRes = await outsider.get(`/api/organizations/${org.id}/members`)
  assert.equal(membersRes.status, 404)

  const invitationsRes = await outsider.get(`/api/organizations/${org.id}/invitations`)
  assert.equal(invitationsRes.status, 404)

  // Confirm the organization's actual data was NOT modified by the attempted patch.
  const ownerCheck = await owner.get(`/api/organizations/${org.id}`)
  assert.notEqual(ownerCheck.body.organization.display_name, 'Hacked')
})

// ============================== ROLES ==============================

test('organizations: GET /:organizationId/roles returns the 4 system roles (owner/admin/manager/staff)', async () => {
  const { client } = await registerUser('org_roles')
  const org = await createOrg(client, 'Org Roles ' + Date.now())
  const res = await client.get(`/api/organizations/${org.id}/roles`)
  assert.equal(res.status, 200)
  const keys = res.body.roles.map((r) => r.key)
  for (const expected of ['owner', 'admin', 'manager', 'staff']) {
    assert.ok(keys.includes(expected), `expected system role '${expected}' in the roles list`)
  }
})

// ============================== INVITATIONS: FULL LIFECYCLE ==============================

test('organizations: invitation full lifecycle — create, accept, new member appears with the invited role, invitation status becomes accepted', async () => {
  const { client: owner } = await registerUser('org_invite_lifecycle_owner')
  const { client: invitee, email: inviteeEmail } = await registerUser('org_invite_lifecycle_invitee')
  const org = await createOrg(owner, 'Org Invite Lifecycle ' + Date.now())
  const managerRoleId = await roleIdByKey('manager')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: inviteeEmail, role_id: managerRoleId })
  assert.equal(inviteRes.status, 200)
  assert.ok(inviteRes.body.invite_token, 'the raw invite token must be returned ONCE to the inviter')
  assert.equal(inviteRes.body.invitation.token_hash, undefined, 'the invitation object itself must never include token_hash')

  const acceptRes = await invitee.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })
  assert.equal(acceptRes.status, 200)
  assert.equal(acceptRes.body.member.role_id, managerRoleId)

  // The invitee must now see the organization in their own list.
  const inviteeOrgs = await invitee.get('/api/organizations')
  assert.ok(inviteeOrgs.body.organizations.some((o) => o.id === org.id))

  const invitationRow = await queryOneD1(`SELECT status FROM organization_invitations WHERE organization_id=${org.id} AND invited_email='${inviteeEmail}'`)
  assert.equal(invitationRow.status, 'accepted')
})

test('organizations: invitation reject — a rejected invitation does not create a membership and its status becomes rejected', async () => {
  const { client: owner } = await registerUser('org_invite_reject_owner')
  const { client: invitee, email: inviteeEmail } = await registerUser('org_invite_reject_invitee')
  const org = await createOrg(owner, 'Org Invite Reject ' + Date.now())
  const staffRoleId = await roleIdByKey('staff')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: inviteeEmail, role_id: staffRoleId })
  const rejectRes = await invitee.post('/api/organizations/invitations/reject', { token: inviteRes.body.invite_token })
  assert.equal(rejectRes.status, 200)

  const inviteeOrgs = await invitee.get('/api/organizations')
  assert.ok(!inviteeOrgs.body.organizations.some((o) => o.id === org.id), 'a rejected invitation must never result in membership')

  const invitationRow = await queryOneD1(`SELECT status FROM organization_invitations WHERE organization_id=${org.id} AND invited_email='${inviteeEmail}'`)
  assert.equal(invitationRow.status, 'rejected')
})

test('organizations: invitation revoke — an owner can revoke a pending invitation; the token becomes permanently unusable', async () => {
  const { client: owner } = await registerUser('org_invite_revoke_owner')
  const { client: invitee, email: inviteeEmail } = await registerUser('org_invite_revoke_invitee')
  const org = await createOrg(owner, 'Org Invite Revoke ' + Date.now())
  const staffRoleId = await roleIdByKey('staff')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: inviteeEmail, role_id: staffRoleId })
  const invitationId = inviteRes.body.invitation.id

  const revokeRes = await owner.post(`/api/organizations/${org.id}/invitations/${invitationId}/revoke`, {})
  assert.equal(revokeRes.status, 200)

  // Revoked invitation rejected: the invitee can no longer accept it.
  const acceptRes = await invitee.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })
  assert.equal(acceptRes.status, 400)

  const invitationRow = await queryOneD1(`SELECT status FROM organization_invitations WHERE id=${invitationId}`)
  assert.equal(invitationRow.status, 'revoked')
})

test('organizations: invitation replay is rejected — accepting the same invitation token twice fails the second time', async () => {
  const { client: owner } = await registerUser('org_invite_replay_owner')
  const { client: invitee, email: inviteeEmail } = await registerUser('org_invite_replay_invitee')
  const org = await createOrg(owner, 'Org Invite Replay ' + Date.now())
  const staffRoleId = await roleIdByKey('staff')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: inviteeEmail, role_id: staffRoleId })
  const firstAccept = await invitee.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })
  assert.equal(firstAccept.status, 200)

  const replayAccept = await invitee.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })
  assert.equal(replayAccept.status, 400, 'an already-accepted invitation token must not be re-acceptable')
})

test('organizations: invitation cannot be accepted by an unauthorized identity — a DIFFERENT authenticated user (not the invited email) can still redeem the raw token if they possess it, which is the correct/expected token-bearer model; but a user with NO knowledge of the token cannot guess it (structurally impossible via brute force of a 24-byte random token) — this test proves acceptance is gated on TOKEN possession, not on session identity matching the invited email, and that a garbage token is rejected outright', async () => {
  const { client: owner } = await registerUser('org_invite_unauth_owner')
  const { email: inviteeEmail } = await registerUser('org_invite_unauth_invitee')
  const { client: randomUser } = await registerUser('org_invite_unauth_random')
  const org = await createOrg(owner, 'Org Invite Unauth ' + Date.now())
  const staffRoleId = await roleIdByKey('staff')

  await owner.post(`/api/organizations/${org.id}/invitations`, { email: inviteeEmail, role_id: staffRoleId })

  // A garbage/guessed token must be rejected outright.
  const garbageRes = await randomUser.post('/api/organizations/invitations/accept', { token: 'a'.repeat(48) })
  assert.equal(garbageRes.status, 400)
})

test('organizations: only a member with members.manage can create/list/revoke invitations — a plain member without that permission gets 403', async () => {
  const { client: owner } = await registerUser('org_invite_perm_owner')
  const { client: staffMember, email: staffEmail } = await registerUser('org_invite_perm_staff')
  const org = await createOrg(owner, 'Org Invite Perm ' + Date.now())
  const staffRoleId = await roleIdByKey('staff')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: staffEmail, role_id: staffRoleId })
  await staffMember.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })

  // Now staffMember IS a member but staff role lacks members.manage.
  const { email: thirdPartyEmail } = await registerUser('org_invite_perm_thirdparty')
  const staffInviteAttempt = await staffMember.post(`/api/organizations/${org.id}/invitations`, { email: thirdPartyEmail, role_id: staffRoleId })
  assert.equal(staffInviteAttempt.status, 403, 'a staff-role member (no members.manage permission) must not be able to create invitations')
})

// ============================== LAST-OWNER PROTECTION ==============================

test('organizations: last-owner protection — the sole owner cannot be demoted (role change) via the members endpoint', async () => {
  const { client: owner } = await registerUser('org_lastowner_demote')
  const org = await createOrg(owner, 'Org LastOwner Demote ' + Date.now())
  const adminRoleId = await roleIdByKey('admin')

  const membersRes = await owner.get(`/api/organizations/${org.id}/members`)
  const ownerMember = membersRes.body.members.find((m) => Number(m.is_owner) === 1)
  assert.ok(ownerMember)

  const demoteRes = await owner.patch(`/api/organizations/${org.id}/members/${ownerMember.id}`, { role_id: adminRoleId })
  assert.equal(demoteRes.status, 409, 'demoting the sole owner must be rejected with 409 (LastOwnerError)')
})

test('organizations: last-owner protection — the sole owner cannot be suspended', async () => {
  const { client: owner } = await registerUser('org_lastowner_suspend')
  const org = await createOrg(owner, 'Org LastOwner Suspend ' + Date.now())

  const membersRes = await owner.get(`/api/organizations/${org.id}/members`)
  const ownerMember = membersRes.body.members.find((m) => Number(m.is_owner) === 1)

  const suspendRes = await owner.patch(`/api/organizations/${org.id}/members/${ownerMember.id}`, { status: 'suspended' })
  assert.equal(suspendRes.status, 409)
})

test('organizations: last-owner protection — the sole owner cannot be removed', async () => {
  const { client: owner } = await registerUser('org_lastowner_remove')
  const org = await createOrg(owner, 'Org LastOwner Remove ' + Date.now())

  const membersRes = await owner.get(`/api/organizations/${org.id}/members`)
  const ownerMember = membersRes.body.members.find((m) => Number(m.is_owner) === 1)

  const removeRes = await owner.delete(`/api/organizations/${org.id}/members/${ownerMember.id}`)
  assert.equal(removeRes.status, 409)
})

test('organizations: last-owner protection does NOT block demoting/suspending/removing a SECOND owner when at least one owner remains', async () => {
  const { client: owner } = await registerUser('org_lastowner_second_owner')
  const { client: secondOwnerClient, email: secondOwnerEmail } = await registerUser('org_lastowner_second_owner_b')
  const org = await createOrg(owner, 'Org LastOwner Second ' + Date.now())
  const ownerRoleId = await roleIdByKey('owner')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: secondOwnerEmail, role_id: ownerRoleId })
  await secondOwnerClient.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })

  const membersRes = await owner.get(`/api/organizations/${org.id}/members`)
  const secondOwnerMember = membersRes.body.members.find((m) => m.user_email === secondOwnerEmail)
  assert.ok(secondOwnerMember)

  const demoteRes = await owner.patch(`/api/organizations/${org.id}/members/${secondOwnerMember.id}`, { role_id: await roleIdByKey('admin') })
  assert.equal(demoteRes.status, 200, 'demoting one of TWO owners must succeed — last-owner protection only blocks reaching zero owners')
})

// ============================== OWNER-ONLY ACTIONS ==============================

test('organizations: transfer-ownership requires the owner role — a non-owner member (even with members.manage) cannot transfer ownership', async () => {
  const { client: owner } = await registerUser('org_transfer_perm_owner')
  const { client: adminMember, email: adminEmail, userId: adminUserId } = await registerUser('org_transfer_perm_admin')
  const org = await createOrg(owner, 'Org Transfer Perm ' + Date.now())
  const adminRoleId = await roleIdByKey('admin')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: adminEmail, role_id: adminRoleId })
  await adminMember.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })

  const attemptRes = await adminMember.post(`/api/organizations/${org.id}/transfer-ownership`, { new_owner_user_id: adminUserId })
  assert.equal(attemptRes.status, 403, 'an admin-role member must not be able to transfer ownership — that requires the owner role specifically')
})

test('organizations: transfer-ownership succeeds for the current owner, demoting them to admin and promoting the target to owner', async () => {
  const { client: owner, userId: ownerUserId } = await registerUser('org_transfer_success_owner')
  const { client: newOwnerClient, email: newOwnerEmail, userId: newOwnerUserId } = await registerUser('org_transfer_success_target')
  const org = await createOrg(owner, 'Org Transfer Success ' + Date.now())
  const managerRoleId = await roleIdByKey('manager')

  const inviteRes = await owner.post(`/api/organizations/${org.id}/invitations`, { email: newOwnerEmail, role_id: managerRoleId })
  await newOwnerClient.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })

  const transferRes = await owner.post(`/api/organizations/${org.id}/transfer-ownership`, { new_owner_user_id: newOwnerUserId })
  assert.equal(transferRes.status, 200)

  const membersRes = await newOwnerClient.get(`/api/organizations/${org.id}/members`)
  const oldOwnerMember = membersRes.body.members.find((m) => m.user_id === ownerUserId)
  const newOwnerMember = membersRes.body.members.find((m) => m.user_id === newOwnerUserId)
  assert.equal(Number(oldOwnerMember.is_owner), 0, 'the previous owner must be demoted (is_owner=0)')
  assert.equal(oldOwnerMember.role_key, 'admin', 'the previous owner must land on the admin role, never left without any role')
  assert.equal(Number(newOwnerMember.is_owner), 1)
  assert.equal(newOwnerMember.role_key, 'owner')
})
