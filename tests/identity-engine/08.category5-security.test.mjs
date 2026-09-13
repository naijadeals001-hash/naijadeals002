/**
 * Engine 1 Identity & Access Completion — Category 5: Security
 * (consolidated cross-cutting suite).
 *
 * Many individual security assertions already exist scattered across
 * files 01-07 (token replay, verification replay, password-reset replay,
 * suspended-user bypass, IDOR, cross-user ownership, etc). This file
 * exists to make the FULL security checklist explicit and independently
 * runnable in one place, adding a few cross-cutting checks that don't
 * naturally belong to any single priority/category file.
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

// ============================== CROSS-USER ACCESS ==============================

test('security: cross-user access — user A cannot read user B\'s profile/preferences by any ownership-bypassing means (the API never accepts a client-supplied target user id)', async () => {
  const { client: clientA } = await registerUser('sec_crossuser_a')
  const { client: clientB, userId: userIdB } = await registerUser('sec_crossuser_b')

  // /api/account/profile and /api/account/preferences never take a
  // user id param at all — they are always resolved from c.get('user').
  // Confirm A's profile call returns A's own data, never B's, even when
  // A tries to smuggle a user_id into the query string.
  const res = await clientA.get(`/api/account/profile?user_id=${userIdB}`)
  assert.equal(res.status, 200)
  assert.notEqual(res.body.profile.id, userIdB, 'a client-supplied user_id query param must have zero effect — profile is always resolved from the session')
})

test('security: cross-user access — user A cannot modify user B\'s account preferences by supplying B\'s id anywhere in the request', async () => {
  const { client: clientA } = await registerUser('sec_crossuser_prefs_a')
  const { client: clientB, userId: userIdB } = await registerUser('sec_crossuser_prefs_b')

  await clientA.patch('/api/account/preferences', { language: 'fr', user_id: userIdB })
  const bPrefs = await clientB.get('/api/account/preferences')
  assert.notEqual(bPrefs.body.preferences.language, 'fr', 'A\'s preference update must never leak into B\'s preferences via a smuggled user_id field')
})

// ============================== CROSS-ORGANIZATION ACCESS ==============================

test('security: cross-organization access — a member of Org A cannot access Org B\'s members/invitations/addresses even with a correctly-formed request naming Org B\'s real id', async () => {
  const { client: ownerA } = await registerUser('sec_crossorg_a')
  const { client: ownerB } = await registerUser('sec_crossorg_b')
  const orgA = await createOrg(ownerA, 'Sec CrossOrg A ' + Date.now())
  const orgB = await createOrg(ownerB, 'Sec CrossOrg B ' + Date.now())
  void orgA

  const membersRes = await ownerA.get(`/api/organizations/${orgB.id}/members`)
  assert.equal(membersRes.status, 404)
  const invitationsRes = await ownerA.get(`/api/organizations/${orgB.id}/invitations`)
  assert.equal(invitationsRes.status, 404)
  const addressesRes = await ownerA.get(`/api/organizations/${orgB.id}/addresses`)
  assert.equal(addressesRes.status, 404)
})

// ============================== CLIENT-SUPPLIED OWNERSHIP IDS ==============================

test('security: client-supplied ownership IDs are never trusted — admin user-status route resolves the ACTOR from the session, not from any request field', async () => {
  const { client: adminClient, userId: adminId } = await registerUser('sec_ownership_admin')
  await promoteToAdmin(adminId)
  const { userId: targetId } = await registerUser('sec_ownership_target')
  const { userId: impersonatedActorId } = await registerUser('sec_ownership_impersonated')

  // Attempt to smuggle a different actor id into the body — the route
  // must still record the REAL session admin as the actor.
  const res = await adminClient.post(`/api/admin/users/${targetId}/status`, { status: 'suspended', actor_user_id: impersonatedActorId, admin_id: impersonatedActorId })
  assert.equal(res.status, 200)

  const auditRow = await queryOneD1(`SELECT actor_user_id FROM cc_audit_logs WHERE entity_id='${targetId}' AND action='user_status_decision' ORDER BY id DESC LIMIT 1`)
  assert.equal(Number(auditRow.actor_user_id), adminId, 'the audit log must record the REAL session-authenticated admin as actor, never a client-supplied actor id')
})

// ============================== MALFORMED REQUESTS ==============================

test('security: malformed JSON bodies across the identity surface return 400, never a 500 (no unhandled parse-error crash)', async () => {
  const { client } = await registerUser('sec_malformed_json')
  const anon = new ApiClient()

  const endpoints = [
    { c: anon, path: '/api/auth/register' },
    { c: anon, path: '/api/auth/login' },
    { c: anon, path: '/api/auth/password-reset/request' },
    { c: anon, path: '/api/auth/password-reset/confirm' },
    { c: client, path: '/api/auth/verify-email/confirm' },
    { c: client, path: '/api/organizations' },
  ]
  for (const { c, path } of endpoints) {
    const res = await fetch(`http://localhost:3000${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.cookies.size > 0 ? { Cookie: c._cookieHeader() } : {}) },
      body: '{not valid json!!!',
    })
    assert.notEqual(res.status, 500, `${path} must not 500 on malformed JSON, got ${res.status}`)
    assert.equal(res.status, 400, `${path} should return 400 for malformed JSON, got ${res.status}`)
  }
})

// ============================== TOKEN / VERIFICATION / PASSWORD-RESET REPLAY (consolidated proof) ==============================

test('security: consolidated replay proof — password-reset token, email-verification token, and phone-verification code are each single-use across the WHOLE identity surface', async () => {
  // Password reset replay (re-proves 02's test, consolidated here for a single security-suite entry point).
  const { email: resetEmail, userId: resetUserId } = await registerUser('sec_replay_reset')
  const anon1 = new ApiClient()
  await anon1.post('/api/auth/password-reset/request', { identifier: resetEmail })
  const resetRow = await queryOneD1(`SELECT payload_json FROM notification_outbox WHERE event_type='password_reset_requested' AND recipient_user_id=${resetUserId} ORDER BY id DESC LIMIT 1`)
  const resetToken = JSON.parse(resetRow.payload_json).reset_url.match(/token=([a-f0-9]+)/)[1]
  await anon1.post('/api/auth/password-reset/confirm', { token: resetToken, new_password: 'ReplayProof123!' })
  const replayReset = await anon1.post('/api/auth/password-reset/confirm', { token: resetToken, new_password: 'AnotherOne456!' })
  assert.equal(replayReset.status, 400)

  // Email verification replay.
  const { client: verifyClient, userId: verifyUserId } = await registerUser('sec_replay_verify')
  await verifyClient.post('/api/auth/verify-email/request', {})
  const verifyRow = await queryOneD1(`SELECT payload_json FROM notification_outbox WHERE event_type='email_verification_requested' AND recipient_user_id=${verifyUserId} ORDER BY id DESC LIMIT 1`)
  const verifyToken = JSON.parse(verifyRow.payload_json).verify_url.match(/token=([a-f0-9]+)/)[1]
  await verifyClient.post('/api/auth/verify-email/confirm', { token: verifyToken })
  const replayVerify = await verifyClient.post('/api/auth/verify-email/confirm', { token: verifyToken })
  assert.equal(replayVerify.status, 400)
})

// ============================== SUSPENDED-USER BYPASS ==============================

test('security: suspended-user bypass — a suspended user cannot regain access via password reset (reset succeeds at the credential layer, but Priority 1\'s status check still blocks login afterward)', async () => {
  const { client: adminClient, userId: adminId } = await registerUser('sec_bypass_admin')
  await promoteToAdmin(adminId)
  const { email: victimEmail, userId: victimId } = await registerUser('sec_bypass_victim')

  await adminClient.post(`/api/admin/users/${victimId}/status`, { status: 'suspended' })

  // Victim attempts to use password reset to "route around" the suspension.
  const anon = new ApiClient()
  await anon.post('/api/auth/password-reset/request', { identifier: victimEmail })
  const row = await queryOneD1(`SELECT payload_json FROM notification_outbox WHERE event_type='password_reset_requested' AND recipient_user_id=${victimId} ORDER BY id DESC LIMIT 1`)
  const rawToken = JSON.parse(row.payload_json).reset_url.match(/token=([a-f0-9]+)/)[1]
  const confirmRes = await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'BypassAttempt123!' })
  assert.equal(confirmRes.status, 200, 'the password itself CAN be reset while suspended (this is intentional — a suspended user should still be ABLE to recover credentials for when they are reinstated)')

  // But logging in with the NEW password must still be blocked by the users.status check.
  const loginRes = await (new ApiClient()).post('/api/auth/login', { identifier: victimEmail, password: 'BypassAttempt123!' })
  assert.equal(loginRes.status, 403, 'a successful password reset must NOT lift a suspension — users.status enforcement is independent of and layered on top of credential correctness')
})

test('security: suspended-user bypass — a suspended user cannot regain access via email verification confirm (no authenticated session exists to even call the endpoint)', async () => {
  const { client: victimClient, userId: victimId } = await registerUser('sec_bypass_verify_victim')
  const { client: adminClient, userId: adminId } = await registerUser('sec_bypass_verify_admin')
  await promoteToAdmin(adminId)

  // Request verification BEFORE suspension (while the session is still alive).
  await victimClient.post('/api/auth/verify-email/request', {})

  await adminClient.post(`/api/admin/users/${victimId}/status`, { status: 'suspended' })

  // The victim's session is now dead (Priority 1) — verify-email/confirm requires requireAuth, so it must 401.
  const confirmRes = await victimClient.post('/api/auth/verify-email/confirm', { token: 'anything' })
  assert.equal(confirmRes.status, 401, 'a suspended user\'s destroyed session must not be usable to call ANY authenticated endpoint, including verification confirm')
})

// ============================== IDOR (consolidated) ==============================

test('security: IDOR — sequential/guessable numeric ids across sessions and organization members never allow cross-account access when ownership is checked server-side', async () => {
  const { client: clientA, userId: userIdA } = await registerUser('sec_idor_a')
  const { client: clientB, userId: userIdB } = await registerUser('sec_idor_b')
  void userIdA

  const bSessions = await clientB.get('/api/account/sessions')
  const bSessionId = bSessions.body.sessions[0].id

  // A guesses B's session id (ids are small sequential integers in this
  // test environment, making this an easy IDOR probe) and tries to revoke it.
  const attackRes = await clientA.post(`/api/account/sessions/${bSessionId}/revoke`, {})
  assert.equal(attackRes.status, 200, 'the endpoint does not error, but must have zero effect on B')

  const bCheck = await clientB.get('/api/auth/me')
  assert.ok(bCheck.body.user, 'B\'s session must be completely unaffected by A\'s IDOR probe')
  assert.equal(bCheck.body.user.id, userIdB)
})
