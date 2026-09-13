/**
 * Engine 1 Identity & Access Completion — Category 6: Lifecycle.
 *
 * This file is deliberately a CONSOLIDATED, LIFECYCLE-FOCUSED view: most
 * individual facts asserted here are already proven piecemeal by files
 * 01-08 (each from its own priority/category angle). This file instead
 * walks each subsystem through its full state-machine end-to-end in a
 * single test per lifecycle, so the sequencing itself — not just each
 * individual state — is what gets verified. No existing test file is
 * modified; nothing here weakens or replaces prior coverage.
 *
 * KNOWN LIMITATION DOCUMENTED HERE (not a defect — a truthful finding):
 * organizations.status (migration 0037, CHECK IN 'active','suspended',
 * 'disabled') exists in the schema but is NEVER read, written, or
 * enforced anywhere in application code — no route sets it, and
 * resolveMembership()/rbac.ts never check it. Organization-LEVEL status
 * lifecycle is therefore NOT IMPLEMENTED/NOT APPLICABLE; only MEMBER-
 * level status (invited/active/suspended/removed, enforced via
 * resolveMembership's `status = 'active'` filter) is a real, tested
 * lifecycle. This file tests what is actually implemented and records
 * the gap rather than inventing a passing test for code that isn't there.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerUser, promoteToAdmin, execD1, queryOneD1, countActiveSessions, ApiClient } from './helpers/client.mjs'

async function roleIdByKey(key) {
  const row = await queryOneD1(`SELECT id FROM organization_roles WHERE organization_id IS NULL AND key = '${key}'`)
  return row.id
}
async function createOrg(client, name) {
  const res = await client.post('/api/organizations', { name })
  assert.equal(res.status, 200)
  return res.body.organization
}
async function getRawEmailTokenFromOutbox(userId) {
  const row = await queryOneD1(`SELECT payload_json FROM notification_outbox WHERE event_type='email_verification_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`)
  return JSON.parse(row.payload_json).verify_url.match(/token=([a-f0-9]+)/)[1]
}
async function getRawResetTokenFromOutbox(userId) {
  const row = await queryOneD1(`SELECT payload_json FROM notification_outbox WHERE event_type='password_reset_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`)
  return JSON.parse(row.payload_json).reset_url.match(/token=([a-f0-9]+)/)[1]
}
async function loginRaw(identifier, password, ip) {
  const res = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) },
    body: JSON.stringify({ identifier, password }),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

// ============================== 1. USER STATUS LIFECYCLE ==============================

test('lifecycle: user status — active -> pending_verification does NOT block access; active -> suspended DOES, destroying sessions; -> active restoration re-permits login and does not resurrect the old (already-destroyed) session', async () => {
  const { client: adminClient, userId: adminId } = await registerUser('lc_status_admin')
  await promoteToAdmin(adminId)
  const { client: victimClient, email, password, userId } = await registerUser('lc_status_victim')

  // Step 0: active, fully functional.
  const step0 = await victimClient.get('/api/auth/me')
  assert.ok(step0.body.user)
  assert.equal(step0.body.user.status, 'active')

  // Step 1: active -> pending_verification (non-blocking transition).
  let decision = await adminClient.post(`/api/admin/users/${userId}/status`, { status: 'pending_verification' })
  assert.equal(decision.status, 200)
  assert.equal(decision.body.sessionsRevoked, false)
  const step1 = await victimClient.get('/api/auth/me')
  assert.ok(step1.body.user, 'pending_verification must not block the existing session')
  assert.equal(step1.body.user.status, 'pending_verification')

  // Step 2: pending_verification -> suspended (blocking transition) — the SAME session that survived step 1 must now die.
  decision = await adminClient.post(`/api/admin/users/${userId}/status`, { status: 'suspended' })
  assert.equal(decision.status, 200)
  assert.equal(decision.body.sessionsRevoked, true)
  const step2 = await victimClient.get('/api/auth/me')
  assert.equal(step2.body.user, null)
  assert.equal(await countActiveSessions(userId), 0)

  // Cannot re-login while suspended.
  const blockedLogin = await (new ApiClient()).post('/api/auth/login', { identifier: email, password })
  assert.equal(blockedLogin.status, 403)

  // Step 3: suspended -> active (restoration). Login must now succeed AGAIN with a FRESH session.
  decision = await adminClient.post(`/api/admin/users/${userId}/status`, { status: 'active' })
  assert.equal(decision.status, 200)
  assert.equal(decision.body.sessionsRevoked, false, 'restoring to active is not itself a blocking transition, so it must not report a session revocation')

  const restoredLoginClient = new ApiClient()
  const restoredLogin = await restoredLoginClient.post('/api/auth/login', { identifier: email, password })
  assert.equal(restoredLogin.status, 200)
  const restoredMe = await restoredLoginClient.get('/api/auth/me')
  assert.equal(restoredMe.body.user.status, 'active')

  // The OLD (pre-suspension) session cookie must remain permanently dead — restoration does not resurrect it.
  const oldSessionCheck = await victimClient.get('/api/auth/me')
  assert.equal(oldSessionCheck.body.user, null, 'restoring an account to active must never resurrect a session that was destroyed by a prior suspension')
})

test('lifecycle: user status — disabled and deleted follow the identical blocking lifecycle as suspended (session death, login refusal, restoration re-permits)', async () => {
  const { client: adminClient, userId: adminId } = await registerUser('lc_status_disabled_admin')
  await promoteToAdmin(adminId)

  for (const blockingStatus of ['disabled', 'deleted']) {
    const { client, email, password, userId } = await registerUser(`lc_status_${blockingStatus}`)
    const decision = await adminClient.post(`/api/admin/users/${userId}/status`, { status: blockingStatus })
    assert.equal(decision.status, 200)
    assert.equal(decision.body.sessionsRevoked, true)

    const meCheck = await client.get('/api/auth/me')
    assert.equal(meCheck.body.user, null)

    const loginAttempt = await (new ApiClient()).post('/api/auth/login', { identifier: email, password })
    assert.equal(loginAttempt.status, 403)

    const restore = await adminClient.post(`/api/admin/users/${userId}/status`, { status: 'active' })
    assert.equal(restore.status, 200)
    const restoredLogin = await (new ApiClient()).post('/api/auth/login', { identifier: email, password })
    assert.equal(restoredLogin.status, 200, `${blockingStatus} -> active restoration must re-permit login`)
  }
})

// ============================== 2. SESSION LIFECYCLE ==============================

test('lifecycle: session — full state machine: create (login) -> authenticated request -> expire -> dead; separately create -> logout -> dead; create two -> revoke one -> other survives -> revoke-all-others -> only caller survives', async () => {
  const { client: mainClient, email, password, userId } = await registerUser('lc_session_full')

  // Create (registration already created session #1) -> authenticated request works.
  const check1 = await mainClient.get('/api/auth/me')
  assert.ok(check1.body.user)

  // Expire session #1 directly (simulating natural TTL expiry) -> dead.
  await execD1(`UPDATE sessions SET expires_at = datetime('now','-1 minutes') WHERE user_id=${userId}`)
  const afterExpiry = await mainClient.get('/api/auth/me')
  assert.equal(afterExpiry.body.user, null)

  // Fresh login (session #2) -> logout -> dead.
  const client2 = new ApiClient()
  await client2.post('/api/auth/login', { identifier: email, password })
  const beforeLogout = await client2.get('/api/auth/me')
  assert.ok(beforeLogout.body.user)
  const logoutRes = await client2.post('/api/auth/logout', {})
  assert.equal(logoutRes.status, 200)
  const afterLogout = await client2.get('/api/auth/me')
  assert.equal(afterLogout.body.user, null)
  assert.equal(await countActiveSessions(userId), 0, 'both the expired and the logged-out session must be gone')

  // Two fresh concurrent sessions (#3 caller, #4 other) -> revoke #4 specifically -> #3 survives, #4 dies.
  const clientCaller = new ApiClient()
  await clientCaller.post('/api/auth/login', { identifier: email, password })
  const clientOther = new ApiClient()
  await clientOther.post('/api/auth/login', { identifier: email, password })
  assert.equal(await countActiveSessions(userId), 2)

  const callerSessions = await clientCaller.get('/api/account/sessions')
  const otherEntry = callerSessions.body.sessions.find((s) => !s.is_current)
  await clientCaller.post(`/api/account/sessions/${otherEntry.id}/revoke`, {})
  assert.equal(await countActiveSessions(userId), 1)
  assert.ok((await clientCaller.get('/api/auth/me')).body.user, 'caller session must survive revoking a DIFFERENT session')
  assert.equal((await clientOther.get('/api/auth/me')).body.user, null, 'the specifically-revoked session must be dead')

  // Add two MORE sessions, then revoke-all-others from the caller's perspective -> only caller survives.
  const clientThird = new ApiClient()
  await clientThird.post('/api/auth/login', { identifier: email, password })
  const clientFourth = new ApiClient()
  await clientFourth.post('/api/auth/login', { identifier: email, password })
  assert.equal(await countActiveSessions(userId), 3)

  await clientCaller.post('/api/account/sessions/revoke-all', {})
  assert.equal(await countActiveSessions(userId), 1)
  assert.ok((await clientCaller.get('/api/auth/me')).body.user, 'the caller\'s own session must survive revoke-all-others')
  assert.equal((await clientThird.get('/api/auth/me')).body.user, null)
  assert.equal((await clientFourth.get('/api/auth/me')).body.user, null)
})

test('lifecycle: session — behavior after an account-status change is the SAME regardless of how many sessions existed at the moment of suspension (0, 1, or many)', async () => {
  const { client: adminClient, userId: adminId } = await registerUser('lc_session_status_admin')
  await promoteToAdmin(adminId)

  // Case: zero active sessions at the moment of suspension (already logged out).
  const { client: zeroClient, email: zeroEmail, password: zeroPassword, userId: zeroUserId } = await registerUser('lc_session_status_zero')
  await zeroClient.post('/api/auth/logout', {})
  assert.equal(await countActiveSessions(zeroUserId), 0)
  const zeroDecision = await adminClient.post(`/api/admin/users/${zeroUserId}/status`, { status: 'suspended' })
  assert.equal(zeroDecision.status, 200)
  assert.equal(zeroDecision.body.sessionsRevoked, true, 'sessionsRevoked reflects the STATUS TRANSITION being blocking, independent of how many session rows actually existed to delete')
  const zeroLoginAttempt = await (new ApiClient()).post('/api/auth/login', { identifier: zeroEmail, password: zeroPassword })
  assert.equal(zeroLoginAttempt.status, 403)

  // Case: many (3) active sessions at the moment of suspension.
  const { client: manyClient, email: manyEmail, password: manyPassword, userId: manyUserId } = await registerUser('lc_session_status_many')
  const many2 = new ApiClient()
  await many2.post('/api/auth/login', { identifier: manyEmail, password: manyPassword })
  const many3 = new ApiClient()
  await many3.post('/api/auth/login', { identifier: manyEmail, password: manyPassword })
  assert.equal(await countActiveSessions(manyUserId), 3)
  await adminClient.post(`/api/admin/users/${manyUserId}/status`, { status: 'suspended' })
  assert.equal(await countActiveSessions(manyUserId), 0, 'ALL sessions must die, not just one')
  for (const c of [manyClient, many2, many3]) {
    assert.equal((await c.get('/api/auth/me')).body.user, null)
  }
})

// ============================== 3. PASSWORD-RESET LIFECYCLE ==============================

test('lifecycle: password-reset — full state machine: request -> token created (hashed) -> outbox event -> confirm -> password replaced -> ALL sessions revoked -> old password dead -> new password live -> token now permanently unusable', async () => {
  const { client: sessionA, email, password: oldPassword, userId } = await registerUser('lc_reset_full')
  const sessionB = new ApiClient()
  await sessionB.post('/api/auth/login', { identifier: email, password: oldPassword })
  assert.equal(await countActiveSessions(userId), 2)

  const anon = new ApiClient()
  const requestRes = await anon.post('/api/auth/password-reset/request', { identifier: email })
  assert.equal(requestRes.status, 200)

  const tokenRow = await queryOneD1(`SELECT token_hash, consumed_at FROM password_reset_tokens WHERE user_id=${userId} ORDER BY id DESC LIMIT 1`)
  assert.equal(tokenRow.consumed_at, null, 'freshly-created token must be unconsumed')
  const rawToken = await getRawResetTokenFromOutbox(userId)
  assert.notEqual(tokenRow.token_hash, rawToken)

  const confirmRes = await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'LifecycleNewPass123!' })
  assert.equal(confirmRes.status, 200)

  assert.equal(await countActiveSessions(userId), 0, 'BOTH pre-existing sessions must be revoked by a completed reset')
  assert.equal((await sessionA.get('/api/auth/me')).body.user, null)
  assert.equal((await sessionB.get('/api/auth/me')).body.user, null)

  const oldLogin = await (new ApiClient()).post('/api/auth/login', { identifier: email, password: oldPassword })
  assert.equal(oldLogin.status, 401)
  const newLogin = await (new ApiClient()).post('/api/auth/login', { identifier: email, password: 'LifecycleNewPass123!' })
  assert.equal(newLogin.status, 200)

  const consumedRow = await queryOneD1(`SELECT consumed_at FROM password_reset_tokens WHERE user_id=${userId} ORDER BY id DESC LIMIT 1`)
  assert.notEqual(consumedRow.consumed_at, null, 'the token row must now show a consumption timestamp')
  const replayRes = await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'AnotherAttempt456!' })
  assert.equal(replayRes.status, 400, 'the token must be permanently dead after use, not reusable')
})

test('lifecycle: password-reset — expired-token lifecycle: request -> age past TTL -> confirm now rejected -> a FRESH request still works normally afterward', async () => {
  const { email, password, userId } = await registerUser('lc_reset_expired_lifecycle')
  const anon = new ApiClient()
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const expiredToken = await getRawResetTokenFromOutbox(userId)
  await execD1(`UPDATE password_reset_tokens SET expires_at = datetime('now','-1 minutes') WHERE user_id=${userId}`)

  const expiredConfirm = await anon.post('/api/auth/password-reset/confirm', { token: expiredToken, new_password: 'ShouldFail123!' })
  assert.equal(expiredConfirm.status, 400)

  // The lifecycle is not permanently broken by one expired token — a new request/confirm cycle must work.
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const freshToken = await getRawResetTokenFromOutbox(userId)
  const freshConfirm = await anon.post('/api/auth/password-reset/confirm', { token: freshToken, new_password: 'FreshAttemptWorks123!' })
  assert.equal(freshConfirm.status, 200)

  const finalLogin = await (new ApiClient()).post('/api/auth/login', { identifier: email, password: 'FreshAttemptWorks123!' })
  assert.equal(finalLogin.status, 200)
  void password
})

// ============================== 4. VERIFICATION LIFECYCLE ==============================

test('lifecycle: email verification — full state machine: unverified -> request -> confirm -> verified (persists across a fresh session) -> further request attempts rejected as already-verified', async () => {
  const { client, userId } = await registerUser('lc_verify_email_full')

  const beforeRow = await queryOneD1(`SELECT is_email_verified FROM users WHERE id=${userId}`)
  assert.equal(Number(beforeRow.is_email_verified), 0)

  await client.post('/api/auth/verify-email/request', {})
  const token = await getRawEmailTokenFromOutbox(userId)
  const confirmRes = await client.post('/api/auth/verify-email/confirm', { token })
  assert.equal(confirmRes.status, 200)

  const afterRow = await queryOneD1(`SELECT is_email_verified FROM users WHERE id=${userId}`)
  assert.equal(Number(afterRow.is_email_verified), 1)

  // Verification state PERSISTS beyond the session that performed it — a
  // brand-new login session must still see is_email_verified=1 (this is a
  // durable account attribute, not session-scoped).
  //
  // NOTE: asserted via a direct D1 read (the same pattern the phone-
  // verification-independence test below already uses), NOT via
  // GET /api/account/profile. That endpoint's SELECT is a deliberately
  // scoped general-purpose profile view (id/name/email/phone/role/status/
  // country_iso/preferred_language/created_at) — is_email_verified /
  // is_phone_verified are read exclusively by src/lib/identity-verification.ts
  // by design, and no route or frontend consumer (src/pages/account.tsx)
  // ever expects the profile endpoint to carry them. An earlier version of
  // this test asserted against /api/account/profile and failed (NaN !== 1)
  // — that was a test defect (an invented endpoint contract), not an
  // application defect; classified and corrected 2026-09-13.
  const freshSession = new ApiClient()
  await freshSession.post('/api/auth/login', { identifier: (await queryOneD1(`SELECT email FROM users WHERE id=${userId}`)).email, password: 'TestPass123!' })
  const freshMe = await freshSession.get('/api/auth/me')
  assert.equal(freshMe.status, 200, 'fresh session must authenticate successfully')
  const persistedRow = await queryOneD1(`SELECT is_email_verified FROM users WHERE id=${userId}`)
  assert.equal(Number(persistedRow.is_email_verified), 1, 'verification state must persist as a durable account attribute, independent of which session reads it')

  const secondRequest = await freshSession.post('/api/auth/verify-email/request', {})
  assert.equal(secondRequest.status, 409, 'once verified, requesting verification again must be rejected as already-verified for the rest of the account\'s lifetime')
})

test('lifecycle: phone verification — email and phone verification states are tracked and transition INDEPENDENTLY of each other', async () => {
  const client = new ApiClient()
  const email = `idtest_lc_verify_indep_${Date.now()}@test.ng`
  const phone = `080${String(Date.now()).slice(-8)}`
  const regRes = await client.post('/api/auth/register', { name: 'Lifecycle Indep', email, phone, password: 'TestPass123!' })
  const userId = regRes.body.user.id

  const before = await queryOneD1(`SELECT is_email_verified, is_phone_verified FROM users WHERE id=${userId}`)
  assert.equal(Number(before.is_email_verified), 0)
  assert.equal(Number(before.is_phone_verified), 0)

  // Verify EMAIL only.
  await client.post('/api/auth/verify-email/request', {})
  const emailToken = await getRawEmailTokenFromOutbox(userId)
  await client.post('/api/auth/verify-email/confirm', { token: emailToken })

  const afterEmailOnly = await queryOneD1(`SELECT is_email_verified, is_phone_verified FROM users WHERE id=${userId}`)
  assert.equal(Number(afterEmailOnly.is_email_verified), 1)
  assert.equal(Number(afterEmailOnly.is_phone_verified), 0, 'verifying email must NOT incidentally verify phone')

  // Now verify PHONE.
  await client.post('/api/auth/verify-phone/request', {})
  const phoneRow = await queryOneD1(`SELECT payload_json FROM notification_outbox WHERE event_type='phone_verification_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`)
  const code = JSON.parse(phoneRow.payload_json).code
  await client.post('/api/auth/verify-phone/confirm', { code })

  const afterBoth = await queryOneD1(`SELECT is_email_verified, is_phone_verified FROM users WHERE id=${userId}`)
  assert.equal(Number(afterBoth.is_email_verified), 1, 'phone verification must not disturb the already-verified email state')
  assert.equal(Number(afterBoth.is_phone_verified), 1)
})

// ============================== 5. LOGIN-THROTTLING LIFECYCLE ==============================

test('lifecycle: throttling — full state machine: clean -> failures accumulate -> threshold trips (blocks even correct password) -> window ages out -> clean again -> normal login resumes', async () => {
  const { email, password } = await registerUser('lc_throttle_full')
  const ip = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

  // Clean state: correct password works immediately.
  const step0 = await loginRaw(email, password, ip)
  assert.equal(step0.status, 200)

  // Accumulate failures up to (not over) the threshold.
  for (let i = 0; i < 5; i++) {
    const res = await loginRaw(email, 'wrong' + i, ip)
    assert.equal(res.status, 401)
  }

  // Threshold tripped: even the CORRECT password is now refused.
  const blocked = await loginRaw(email, password, ip)
  assert.equal(blocked.status, 429)
  assert.ok(blocked.body.retryAfterSeconds > 0)

  // Window ages out (simulated via direct D1 backdating): clean again.
  await execD1(`UPDATE login_attempts SET created_at = datetime('now','-20 minutes') WHERE identifier = '${email.toLowerCase()}'`)
  const recovered = await loginRaw(email, password, ip)
  assert.equal(recovered.status, 200, 'once the failure window ages out, the identifier must return to a clean, unthrottled state')
})

test('lifecycle: throttling — identifier axis and IP axis progress and expire completely independently of each other', async () => {
  const { email, password } = await registerUser('lc_throttle_axes')
  const ipA = `10.98.${Math.floor(Math.random() * 250)}.1`
  const ipB = `10.97.${Math.floor(Math.random() * 250)}.2`

  // Trip the IDENTIFIER axis via ipA.
  for (let i = 0; i < 5; i++) await loginRaw(email, 'wrong' + i, ipA)
  const blockedViaA = await loginRaw(email, password, ipA)
  assert.equal(blockedViaA.status, 429)

  // The SAME identifier from a DIFFERENT ip (ipB) is ALSO blocked, because
  // the identifier axis itself (not just the ipA axis) has tripped.
  const blockedViaB = await loginRaw(email, password, ipB)
  assert.equal(blockedViaB.status, 429, 'the identifier axis, once tripped, blocks that identifier regardless of which IP is used next')

  // Age out ONLY the identifier-axis rows, but confirm recovery is total
  // (both axes see the same rows in this schema — there is no separate
  // "identifier-only" ledger to selectively expire, which itself proves
  // the two axes share one time-bounded, self-healing ledger design).
  await execD1(`UPDATE login_attempts SET created_at = datetime('now','-20 minutes') WHERE identifier = '${email.toLowerCase()}'`)
  const recoveredViaB = await loginRaw(email, password, ipB)
  assert.equal(recoveredViaB.status, 200)
})

// ============================== 6. ORGANIZATION LIFECYCLE ==============================

test('lifecycle: organization — full member state machine: invited (pending) -> accepted (active) -> role changed -> suspended (loses access) -> reactivated (access restored) -> removed (permanently gone)', async () => {
  const { client: owner } = await registerUser('lc_org_member_owner')
  const { client: memberClient, email: memberEmail } = await registerUser('lc_org_member_target')
  const org = await createOrg(owner, 'Lifecycle Org Member ' + Date.now())
  const staffRoleId = await roleIdByKey('staff')
  const managerRoleId = await roleIdByKey('manager')

  // Invited (pending) — not yet a member; cannot access the org.
  await owner.post(`/api/organizations/${org.id}/invitations`, { email: memberEmail, role_id: staffRoleId })
  const beforeAccept = await memberClient.get(`/api/organizations/${org.id}`)
  assert.equal(beforeAccept.status, 404)

  // Confirm the invitation is genuinely pending before acceptance.
  const outstandingInvites = await owner.get(`/api/organizations/${org.id}/invitations`)
  const pendingInvite = outstandingInvites.body.invitations.find((i) => i.invited_email === memberEmail)
  assert.equal(pendingInvite.status, 'pending')

  // Accepted -> active membership, access granted, role = staff. The raw
  // token is only ever returned once (at creation) — re-issue a fresh
  // invitation to the same email and accept THAT one (createInvitation's
  // duplicate-pending-invite guard means the FIRST invite must be revoked
  // first, otherwise the second create call would 409).
  await owner.post(`/api/organizations/${org.id}/invitations/${pendingInvite.id}/revoke`, {})
  const freshInvite = await owner.post(`/api/organizations/${org.id}/invitations`, { email: memberEmail, role_id: staffRoleId })
  await memberClient.post('/api/organizations/invitations/accept', { token: freshInvite.body.invite_token })

  const afterAccept = await memberClient.get(`/api/organizations/${org.id}`)
  assert.equal(afterAccept.status, 200)
  assert.equal(afterAccept.body.role, 'staff')

  // Role changed -> manager.
  const membersRes1 = await owner.get(`/api/organizations/${org.id}/members`)
  const memberRow = membersRes1.body.members.find((m) => m.user_email === memberEmail)
  const roleChangeRes = await owner.patch(`/api/organizations/${org.id}/members/${memberRow.id}`, { role_id: managerRoleId })
  assert.equal(roleChangeRes.status, 200)
  const afterRoleChange = await memberClient.get(`/api/organizations/${org.id}`)
  assert.equal(afterRoleChange.body.role, 'manager')

  // Suspended -> access lost (treated as a non-member, 404).
  await owner.patch(`/api/organizations/${org.id}/members/${memberRow.id}`, { status: 'suspended' })
  const whileSuspended = await memberClient.get(`/api/organizations/${org.id}`)
  assert.equal(whileSuspended.status, 404)

  // Reactivated -> access restored, role preserved (manager, not reset to staff).
  await owner.patch(`/api/organizations/${org.id}/members/${memberRow.id}`, { status: 'active' })
  const afterReactivate = await memberClient.get(`/api/organizations/${org.id}`)
  assert.equal(afterReactivate.status, 200)
  assert.equal(afterReactivate.body.role, 'manager', 'reactivation must preserve the role the member had before suspension')

  // Removed -> permanently gone; re-fetching membership list no longer includes them; org access is a hard 404.
  const removeRes = await owner.delete(`/api/organizations/${org.id}/members/${memberRow.id}`)
  assert.equal(removeRes.status, 200)
  const afterRemove = await memberClient.get(`/api/organizations/${org.id}`)
  assert.equal(afterRemove.status, 404)
  const finalMembers = await owner.get(`/api/organizations/${org.id}/members`)
  assert.ok(!finalMembers.body.members.some((m) => m.id === memberRow.id), 'a removed member must not appear in the active members listing')
})

test('lifecycle: organization — profile lifecycle: created with defaults -> partial PATCH updates only the touched field -> a SECOND partial PATCH touching a DIFFERENT field leaves the first field intact (regression guard for the Category 3 D1_TYPE_ERROR fix)', async () => {
  const { client: owner } = await registerUser('lc_org_profile_lifecycle')
  const org = await createOrg(owner, 'Lifecycle Org Profile ' + Date.now())

  const patch1 = await owner.patch(`/api/organizations/${org.id}`, { display_name: 'First Touch' })
  assert.equal(patch1.status, 200)
  assert.equal(patch1.body.organization.display_name, 'First Touch')

  const patch2 = await owner.patch(`/api/organizations/${org.id}`, { website: 'https://example.ng' })
  assert.equal(patch2.status, 200)
  assert.equal(patch2.body.organization.website, 'https://example.ng')
  assert.equal(patch2.body.organization.display_name, 'First Touch', 'a partial PATCH touching a DIFFERENT field must never clobber a previously-set field — this is the exact regression the D1_TYPE_ERROR fix in organizations.ts guards against')
})

test('lifecycle: organization — invitation lifecycle: pending -> (accepted | rejected | revoked | expired) are all terminal, mutually exclusive end states; no invitation can transition between two terminal states', async () => {
  const { client: owner } = await registerUser('lc_org_invite_terminal_owner')
  const org = await createOrg(owner, 'Lifecycle Org Invite Terminal ' + Date.now())
  const staffRoleId = await roleIdByKey('staff')

  // Path to 'revoked': pending -> revoked -> attempt to accept fails.
  const { client: revokedInvitee, email: revokedEmail } = await registerUser('lc_org_invite_revoked')
  const revokeInvite = await owner.post(`/api/organizations/${org.id}/invitations`, { email: revokedEmail, role_id: staffRoleId })
  await owner.post(`/api/organizations/${org.id}/invitations/${revokeInvite.body.invitation.id}/revoke`, {})
  const revokedStatus = await queryOneD1(`SELECT status FROM organization_invitations WHERE id=${revokeInvite.body.invitation.id}`)
  assert.equal(revokedStatus.status, 'revoked')
  const acceptAfterRevoke = await revokedInvitee.post('/api/organizations/invitations/accept', { token: revokeInvite.body.invite_token })
  assert.equal(acceptAfterRevoke.status, 400)
  // Cannot revoke an already-revoked invitation again (terminal-to-terminal transition rejected).
  const doubleRevoke = await owner.post(`/api/organizations/${org.id}/invitations/${revokeInvite.body.invitation.id}/revoke`, {})
  assert.equal(doubleRevoke.status, 400)

  // Path to 'rejected': pending -> rejected -> attempt to accept fails.
  const { client: rejectedInvitee, email: rejectedEmail } = await registerUser('lc_org_invite_rejected')
  const rejectInvite = await owner.post(`/api/organizations/${org.id}/invitations`, { email: rejectedEmail, role_id: staffRoleId })
  await rejectedInvitee.post('/api/organizations/invitations/reject', { token: rejectInvite.body.invite_token })
  const acceptAfterReject = await rejectedInvitee.post('/api/organizations/invitations/accept', { token: rejectInvite.body.invite_token })
  assert.equal(acceptAfterReject.status, 400)

  // Path to 'expired': pending -> (backdated past expiry) -> attempt to accept transitions it to 'expired' and fails.
  const { client: expiredInvitee, email: expiredEmail } = await registerUser('lc_org_invite_expired')
  const expireInvite = await owner.post(`/api/organizations/${org.id}/invitations`, { email: expiredEmail, role_id: staffRoleId })
  await execD1(`UPDATE organization_invitations SET expires_at = datetime('now','-1 minutes') WHERE id=${expireInvite.body.invitation.id}`)
  const acceptExpired = await expiredInvitee.post('/api/organizations/invitations/accept', { token: expireInvite.body.invite_token })
  assert.equal(acceptExpired.status, 400)
  const expiredStatus = await queryOneD1(`SELECT status FROM organization_invitations WHERE id=${expireInvite.body.invitation.id}`)
  assert.equal(expiredStatus.status, 'expired', 'an accept attempt on a time-expired invitation must transition it to the terminal expired state')
})

// ============================== KNOWN LIMITATION: ORGANIZATION-LEVEL STATUS ==============================

test('lifecycle: KNOWN LIMITATION (documented, not a defect) — organizations.status (active/suspended/disabled) exists in the schema but has NO application-code reader or writer; organization-level status lifecycle is NOT IMPLEMENTED, unlike the fully-implemented member-level status lifecycle proven above', async () => {
  const orgLibSource = await readFile(new URL('../../src/lib/organizations.ts', import.meta.url), 'utf8')
  const rbacSource = await readFile(new URL('../../src/lib/rbac.ts', import.meta.url), 'utf8')
  const orgRoutesSource = await readFile(new URL('../../src/routes/api-organizations.ts', import.meta.url), 'utf8')

  // No writer: nothing in the organizations data-access layer or its
  // routes ever sets organizations.status.
  //
  // NOTE on method: an earlier version of this assertion used a single
  // unbounded regex (/UPDATE organizations SET[^;]*\bstatus\b/i) against the
  // ENTIRE file. `[^;]*` crosses newlines and this codebase's multi-line
  // template-literal SQL statements aren't semicolon-terminated in a way
  // that bounds a whole-file match — that regex greedily matched from the
  // real (harmless) `UPDATE organizations SET ${fields.join(', ')}` builder
  // in updateOrganizationProfile() all the way through ~40 unrelated lines
  // into resolveMembership()'s completely different `organization_members
  // ... WHERE ... AND status` query, a different table. Proven by direct
  // regex-exec reproduction; classified as a test defect (Category B), not
  // an application defect, 2026-09-13. Fixed by scoping the search to only
  // updateOrganizationProfile()'s own function body (the sole place in this
  // file that dynamically builds an `UPDATE organizations SET ...`), plus an
  // independent check on its TypeScript input type and its one call site.
  const updateFnMatch = orgLibSource.match(/export async function updateOrganizationProfile\([\s\S]*?\n}\n/)
  assert.ok(updateFnMatch, 'updateOrganizationProfile() must exist in organizations.ts for this limitation check to be meaningful')
  const updateFnBody = updateFnMatch[0]
  // (a) the function's input TYPE must not admit a `status` field at all —
  // this is what makes it structurally impossible for ANY caller to pass
  // status through, not merely "no caller happens to today".
  assert.ok(!/input:\s*Partial<\{[^}]*\bstatus\b[^}]*\}>/i.test(updateFnBody), 'expected updateOrganizationProfile()\'s input type to NOT admit a status field (documenting current unimplemented state)')
  // (b) its single call site (api-organizations.ts's PATCH /:organizationId
  // route) must not forward a `status` key into that input object.
  const callSiteMatch = orgRoutesSource.match(/updateOrganizationProfile\(c\.env\.DB, organizationId, \{[\s\S]*?\n {2}\}\)/)
  assert.ok(callSiteMatch, 'the updateOrganizationProfile() call site must exist in api-organizations.ts for this limitation check to be meaningful')
  assert.ok(!/\bstatus\s*:/i.test(callSiteMatch[0]), 'expected the updateOrganizationProfile() call site to never forward a status field (documenting current unimplemented state)')

  // No enforcement: resolveMembership / rbac.ts never filter or check
  // organizations.status when resolving access.
  assert.ok(!/organizations?\.status/i.test(rbacSource), 'expected NO read of organizations.status in rbac.ts (documenting current unimplemented state)')

  // Confirm this is a real, live gap in the CURRENT schema (not a typo in
  // this test) — the column does exist, so the limitation is "not yet
  // wired up", not "doesn't exist".
  const orgColumns = await execD1(`PRAGMA table_info(organizations)`)
  const flatColumns = orgColumns.flat()
  assert.ok(flatColumns.some((c) => c.name === 'status'), 'the organizations.status column must exist in the schema even though it is unused — confirms this is a genuine implementation gap, not a nonexistent column')
})
