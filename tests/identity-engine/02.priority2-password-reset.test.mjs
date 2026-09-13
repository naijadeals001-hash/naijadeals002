/**
 * Engine 1 Identity & Access Completion — Priority 2: password reset.
 * Black-box HTTP tests against the real running dev server.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, execD1, queryOneD1, ApiClient } from './helpers/client.mjs'

async function getRawResetTokenFromOutbox(userId) {
  const row = await queryOneD1(
    `SELECT payload_json FROM notification_outbox WHERE event_type='password_reset_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`
  )
  assert.ok(row, 'expected a password_reset_requested outbox row for this user')
  const payload = JSON.parse(row.payload_json)
  const match = payload.reset_url.match(/token=([a-f0-9]+)/)
  assert.ok(match, `reset_url did not contain a token: ${payload.reset_url}`)
  return match[1]
}

test('password reset: request always returns 200 regardless of whether the identifier matches a real account (account-enumeration protection)', async () => {
  const anon = new ApiClient()
  const resReal = await anon.post('/api/auth/password-reset/request', { identifier: 'nonexistent_' + Date.now() + '@test.ng' })
  assert.equal(resReal.status, 200)
  assert.ok(resReal.body.success)
})

test('password reset: request for a real account enqueues an Engine 9 outbox event via enqueueAndProcessNow — no second notification mechanism', async () => {
  const { email, userId } = await registerUser('reset_enqueue')
  const anon = new ApiClient()
  const res = await anon.post('/api/auth/password-reset/request', { identifier: email })
  assert.equal(res.status, 200)

  const outboxRow = await queryOneD1(`SELECT id, category FROM notification_outbox WHERE event_type='password_reset_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`)
  assert.ok(outboxRow, 'password reset must go through notification_outbox — the shared Engine 9 outbox table, not a second mechanism')
  assert.equal(outboxRow.category, 'security')
})

test('password reset: token row stores only a hash, never the raw token, in password_reset_tokens', async () => {
  const { email, userId } = await registerUser('reset_hash_check')
  const anon = new ApiClient()
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const rawToken = await getRawResetTokenFromOutbox(userId)

  const tokenRow = await queryOneD1(`SELECT token_hash FROM password_reset_tokens WHERE user_id=${userId} ORDER BY id DESC LIMIT 1`)
  assert.ok(tokenRow)
  assert.notEqual(tokenRow.token_hash, rawToken, 'the raw token must never be stored verbatim')
  assert.equal(tokenRow.token_hash.length, 64, 'expected a SHA-256 hex digest (64 chars)')
})

test('password reset: a garbage/wrong token is rejected with 400', async () => {
  const anon = new ApiClient()
  const res = await anon.post('/api/auth/password-reset/confirm', { token: 'deadbeef'.repeat(8), new_password: 'ValidPass123!' })
  assert.equal(res.status, 400)
})

test('password reset: a weak new password is rejected even with a valid token', async () => {
  const { email, userId } = await registerUser('reset_weak_pw')
  const anon = new ApiClient()
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const rawToken = await getRawResetTokenFromOutbox(userId)

  const res = await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'short' })
  assert.equal(res.status, 400)

  // Token must remain USABLE after a rejected weak-password attempt (the
  // rejection happened before the token was consumed) — confirmed by a
  // follow-up successful confirm with a strong password.
  const res2 = await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'StrongPass456!' })
  assert.equal(res2.status, 200)
})

test('password reset: full lifecycle — valid token succeeds, old password rejected after, new password accepted, ALL sessions revoked', async () => {
  const { client: loggedInClient, email, userId, password: oldPassword } = await registerUser('reset_lifecycle')

  // Confirm the pre-reset session works
  const preCheck = await loggedInClient.get('/api/auth/me')
  assert.ok(preCheck.body.user)

  const anon = new ApiClient()
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const rawToken = await getRawResetTokenFromOutbox(userId)

  const confirmRes = await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'BrandNewPass789!' })
  assert.equal(confirmRes.status, 200)

  // The pre-existing session (created before reset) must now be dead.
  const postCheck = await loggedInClient.get('/api/auth/me')
  assert.equal(postCheck.body.user, null, 'password reset must revoke ALL existing sessions, including ones from before the reset request')

  // Old password must be rejected.
  const oldLoginRes = await (new ApiClient()).post('/api/auth/login', { identifier: email, password: oldPassword })
  assert.equal(oldLoginRes.status, 401)

  // New password must work.
  const newLoginRes = await (new ApiClient()).post('/api/auth/login', { identifier: email, password: 'BrandNewPass789!' })
  assert.equal(newLoginRes.status, 200)
})

test('password reset: a consumed (already-used) token cannot be replayed', async () => {
  const { email, userId } = await registerUser('reset_replay')
  const anon = new ApiClient()
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const rawToken = await getRawResetTokenFromOutbox(userId)

  const first = await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'FirstPass123!' })
  assert.equal(first.status, 200)

  const replay = await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'SecondPass456!' })
  assert.equal(replay.status, 400, 'a consumed token must be rejected on replay, not silently accepted or double-applied')

  // Confirm the SECOND attempted password did NOT take effect.
  const loginWithReplayed = await (new ApiClient()).post('/api/auth/login', { identifier: email, password: 'SecondPass456!' })
  assert.equal(loginWithReplayed.status, 401)
  const loginWithFirst = await (new ApiClient()).post('/api/auth/login', { identifier: email, password: 'FirstPass123!' })
  assert.equal(loginWithFirst.status, 200)
})

test('password reset: an expired token is rejected (simulated via direct D1 backdating, since a real 30-minute wait is impractical for a test)', async () => {
  const { email, userId } = await registerUser('reset_expired')
  const anon = new ApiClient()
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const rawToken = await getRawResetTokenFromOutbox(userId)

  await execD1(`UPDATE password_reset_tokens SET expires_at = datetime('now', '-1 minutes') WHERE user_id = ${userId}`)

  const res = await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'ShouldNotWork123!' })
  assert.equal(res.status, 400)
})

test('password reset: requesting a reset for the same account twice creates TWO distinct tokens, and the FIRST (older) token is still honored (no accidental invalidation of an earlier request)', async () => {
  const { email, userId } = await registerUser('reset_double_request')
  const anon = new ApiClient()
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const tokenA = await getRawResetTokenFromOutbox(userId)
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const tokenB = await getRawResetTokenFromOutbox(userId)
  assert.notEqual(tokenA, tokenB)

  const res = await anon.post('/api/auth/password-reset/confirm', { token: tokenA, new_password: 'FirstTokenWorks123!' })
  assert.equal(res.status, 200, 'an earlier still-valid token must remain usable even after a second request was made')
})

test('password reset: malformed confirm request body is rejected with 400', async () => {
  const anon = new ApiClient()
  const res1 = await anon.post('/api/auth/password-reset/confirm', {})
  assert.equal(res1.status, 400)
  const res2 = await anon.post('/api/auth/password-reset/confirm', { token: 'abc' })
  assert.equal(res2.status, 400)
})

test('password reset: a completion notification (password_reset_completed) is enqueued on successful reset', async () => {
  const { email, userId } = await registerUser('reset_completion_notice')
  const anon = new ApiClient()
  await anon.post('/api/auth/password-reset/request', { identifier: email })
  const rawToken = await getRawResetTokenFromOutbox(userId)
  await anon.post('/api/auth/password-reset/confirm', { token: rawToken, new_password: 'CompletionTest123!' })

  const completionRow = await queryOneD1(`SELECT id FROM notification_outbox WHERE event_type='password_reset_completed' AND recipient_user_id=${userId}`)
  assert.ok(completionRow, 'expected a password_reset_completed notification to have been enqueued')
})
