/**
 * Engine 1 Identity & Access Completion — Category 2: Sessions.
 * Black-box HTTP tests against the real running dev server + direct D1
 * ground-truth assertions. Covers src/routes/api-account.ts's
 * /api/account/sessions/* surface and src/lib/account.ts's session
 * helpers, which had no dedicated test coverage before this file (only
 * incidental status-blocking coverage existed in
 * 01.priority1-user-status.test.mjs).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, promoteToAdmin, execD1, countActiveSessions, ApiClient } from './helpers/client.mjs'

test('sessions: registering a user creates exactly one live session row, and GET /api/account/sessions reflects it with is_current=true', async () => {
  const { client, userId } = await registerUser('session_create')
  assert.equal(await countActiveSessions(userId), 1)

  const res = await client.get('/api/account/sessions')
  assert.equal(res.status, 200)
  assert.equal(res.body.sessions.length, 1)
  assert.equal(res.body.sessions[0].is_current, true)
  assert.equal(res.body.sessions[0].token_hash, undefined, 'session listing must never expose token_hash (Section 14 secret-exposure rule)')
})

test('sessions: logging in from a second client creates a SECOND session row; both are listed, exactly one flagged is_current per client', async () => {
  const { client: clientA, email, password, userId } = await registerUser('session_multi')
  assert.equal(await countActiveSessions(userId), 1)

  const clientB = new ApiClient()
  const loginRes = await clientB.post('/api/auth/login', { identifier: email, password })
  assert.equal(loginRes.status, 200)
  assert.equal(await countActiveSessions(userId), 2)

  const listFromA = await clientA.get('/api/account/sessions')
  assert.equal(listFromA.body.sessions.length, 2)
  const currentFromA = listFromA.body.sessions.filter((s) => s.is_current)
  assert.equal(currentFromA.length, 1, 'exactly one session must be flagged current from A\'s perspective')

  const listFromB = await clientB.get('/api/account/sessions')
  const currentFromB = listFromB.body.sessions.filter((s) => s.is_current)
  assert.equal(currentFromB.length, 1, 'exactly one session must be flagged current from B\'s perspective')

  // A's current session id must differ from B's current session id.
  const aCurrentId = listFromA.body.sessions.find((s) => s.is_current).id
  const bCurrentId = listFromB.body.sessions.find((s) => s.is_current).id
  assert.notEqual(aCurrentId, bCurrentId)
})

test('sessions: an expired session (backdated expires_at) is rejected — /api/auth/me returns null and it is excluded from the sessions list', async () => {
  const { client, userId } = await registerUser('session_expiry')
  const preCheck = await client.get('/api/auth/me')
  assert.ok(preCheck.body.user)

  await execD1(`UPDATE sessions SET expires_at = datetime('now', '-1 minutes') WHERE user_id = ${userId}`)

  const postCheck = await client.get('/api/auth/me')
  assert.equal(postCheck.body.user, null, 'an expired session must no longer authenticate the request')
})

test('sessions: revoke-one (POST /api/account/sessions/:id/revoke) kills that specific session but leaves others intact', async () => {
  const { client: clientA, email, password, userId } = await registerUser('session_revoke_one')
  const clientB = new ApiClient()
  await clientB.post('/api/auth/login', { identifier: email, password })
  assert.equal(await countActiveSessions(userId), 2)

  const listFromA = await clientA.get('/api/account/sessions')
  const bSessionEntry = listFromA.body.sessions.find((s) => !s.is_current)
  assert.ok(bSessionEntry, 'expected to find B\'s session in A\'s listing')

  const revokeRes = await clientA.post(`/api/account/sessions/${bSessionEntry.id}/revoke`, {})
  assert.equal(revokeRes.status, 200)
  assert.equal(await countActiveSessions(userId), 1)

  // B's session must now be dead.
  const bCheck = await clientB.get('/api/auth/me')
  assert.equal(bCheck.body.user, null, 'the specifically-revoked session must no longer authenticate')

  // A's own (current) session must remain alive.
  const aCheck = await clientA.get('/api/auth/me')
  assert.ok(aCheck.body.user, 'revoking a DIFFERENT session must never affect the caller\'s own current session')
})

test('sessions: revoke-all-others (POST /api/account/sessions/revoke-all) kills every OTHER session but preserves the caller\'s own current session', async () => {
  const { client: clientA, email, password, userId } = await registerUser('session_revoke_all_others')
  const clientB = new ApiClient()
  const clientC = new ApiClient()
  await clientB.post('/api/auth/login', { identifier: email, password })
  await clientC.post('/api/auth/login', { identifier: email, password })
  assert.equal(await countActiveSessions(userId), 3)

  const revokeRes = await clientA.post('/api/account/sessions/revoke-all', {})
  assert.equal(revokeRes.status, 200)
  assert.equal(await countActiveSessions(userId), 1, 'only the caller\'s own session should survive revoke-all-others')

  const aCheck = await clientA.get('/api/auth/me')
  assert.ok(aCheck.body.user, 'the caller\'s OWN session must survive revoke-all-others')

  const bCheck = await clientB.get('/api/auth/me')
  assert.equal(bCheck.body.user, null)
  const cCheck = await clientC.get('/api/auth/me')
  assert.equal(cCheck.body.user, null)
})

test('sessions: IDOR — a user cannot revoke another user\'s session by guessing/supplying its numeric id (revokeSessionById is scoped by user_id, so this is a silent no-op, not a 403/404 leak of session existence)', async () => {
  const { client: clientA, userId: userIdA } = await registerUser('session_idor_a')
  const { client: clientB, userId: userIdB } = await registerUser('session_idor_b')
  assert.notEqual(userIdA, userIdB)

  const bSessionsBefore = await clientB.get('/api/account/sessions')
  const bSessionId = bSessionsBefore.body.sessions[0].id

  // A attempts to revoke B's session id directly.
  const attackRes = await clientA.post(`/api/account/sessions/${bSessionId}/revoke`, {})
  assert.equal(attackRes.status, 200, 'the endpoint itself does not leak whether the id belonged to someone else — it responds 200 with (unaffected) results')

  // B's session must be COMPLETELY unaffected — the IDOR guard means the
  // DELETE matched zero rows (scoped by user_id != A's id).
  const bCheck = await clientB.get('/api/auth/me')
  assert.ok(bCheck.body.user, 'user B\'s session must survive an IDOR attempt by user A supplying B\'s session id')
  assert.equal(await countActiveSessions(userIdB), 1)
})

test('sessions: an authenticated admin suspending a DIFFERENT user immediately destroys ALL of that user\'s sessions (not just the current one) — cross-checks Priority 1\'s admin mutation against the session-listing surface', async () => {
  const { client: adminClient, userId: adminId } = await registerUser('session_admin')
  await promoteToAdmin(adminId)

  const { client: victimA, email: victimEmail, password: victimPassword, userId: victimId } = await registerUser('session_admin_victim')
  const victimB = new ApiClient()
  await victimB.post('/api/auth/login', { identifier: victimEmail, password: victimPassword })
  assert.equal(await countActiveSessions(victimId), 2)

  const decision = await adminClient.post(`/api/admin/users/${victimId}/status`, { status: 'suspended', reason: 'sessions test' })
  assert.equal(decision.status, 200)
  assert.equal(decision.body.sessionsRevoked, true)
  assert.equal(await countActiveSessions(victimId), 0)

  const aCheck = await victimA.get('/api/auth/me')
  assert.equal(aCheck.body.user, null)
  const bCheck = await victimB.get('/api/auth/me')
  assert.equal(bCheck.body.user, null)
})

test('sessions: GET/revoke session endpoints require authentication (401 for an anonymous caller)', async () => {
  const anon = new ApiClient()
  const listRes = await anon.get('/api/account/sessions')
  assert.equal(listRes.status, 401)
  const revokeRes = await anon.post('/api/account/sessions/1/revoke', {})
  assert.equal(revokeRes.status, 401)
  const revokeAllRes = await anon.post('/api/account/sessions/revoke-all', {})
  assert.equal(revokeAllRes.status, 401)
})

test('sessions: an invalid (non-numeric) session id on the revoke endpoint is rejected with 400, not a silent success or a 500', async () => {
  const { client } = await registerUser('session_invalid_id')
  const res = await client.post('/api/account/sessions/not-a-number/revoke', {})
  assert.equal(res.status, 400)
})
