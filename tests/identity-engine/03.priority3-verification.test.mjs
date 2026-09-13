/**
 * Engine 1 Identity & Access Completion — Priority 3: email/phone verification.
 * Black-box HTTP tests against the real running dev server + direct D1
 * ground-truth assertions. Mirrors 02.priority2-password-reset.test.mjs's
 * methodology exactly.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerUser, execD1, queryOneD1, ApiClient, RUN_NONCE } from './helpers/client.mjs'

// registerUser() (from the shared harness) only supplies an email at
// registration. Phone verification tests need a user that also has a
// phone on file, so we register directly here with both fields — same
// real HTTP /api/auth/register endpoint, just with an extra field.
let phoneCounter = 0
function nextNigerianPhone() {
  phoneCounter += 1
  const base = (Date.now() + phoneCounter) % 100000000
  return `080${String(base).padStart(8, '0')}`
}

async function registerUserWithPhone(label) {
  const client = new ApiClient()
  const email = `idtest_${label}_${RUN_NONCE}_${Math.floor(Math.random() * 1e6)}@test.ng`
  const phone = nextNigerianPhone()
  const password = 'TestPass123!'
  const res = await client.post('/api/auth/register', { name: `IdentityHarness ${label}`, email, phone, password })
  assert.equal(res.status, 200, `registerUserWithPhone(${label}) failed: ${JSON.stringify(res.body)}`)
  return { client, userId: res.body.user.id, email, phone, password }
}

async function getRawEmailTokenFromOutbox(userId) {
  const row = await queryOneD1(
    `SELECT payload_json FROM notification_outbox WHERE event_type='email_verification_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`
  )
  assert.ok(row, 'expected an email_verification_requested outbox row for this user')
  const payload = JSON.parse(row.payload_json)
  const match = payload.verify_url.match(/token=([a-f0-9]+)/)
  assert.ok(match, `verify_url did not contain a token: ${payload.verify_url}`)
  return match[1]
}

async function getRawPhoneCodeFromOutbox(userId) {
  const row = await queryOneD1(
    `SELECT payload_json FROM notification_outbox WHERE event_type='phone_verification_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`
  )
  assert.ok(row, 'expected a phone_verification_requested outbox row for this user')
  const payload = JSON.parse(row.payload_json)
  assert.ok(payload.code, `payload did not contain a code: ${row.payload_json}`)
  return payload.code
}

async function getEmailVerified(userId) {
  const row = await queryOneD1(`SELECT is_email_verified FROM users WHERE id=${userId}`)
  return row ? Number(row.is_email_verified) : null
}
async function getPhoneVerified(userId) {
  const row = await queryOneD1(`SELECT is_phone_verified FROM users WHERE id=${userId}`)
  return row ? Number(row.is_phone_verified) : null
}

// ============================== EMAIL ==============================

test('email verification: unauthenticated request is rejected (401)', async () => {
  const anon = new ApiClient()
  const res = await anon.post('/api/auth/verify-email/request', {})
  assert.equal(res.status, 401)
})

test('email verification: request enqueues an Engine 9 outbox event, category=security', async () => {
  const { client, userId } = await registerUser('everify_enqueue')
  const res = await client.post('/api/auth/verify-email/request', {})
  assert.equal(res.status, 200)

  const row = await queryOneD1(`SELECT category FROM notification_outbox WHERE event_type='email_verification_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`)
  assert.ok(row, 'email verification must go through notification_outbox — the shared Engine 9 outbox, not a second mechanism')
  assert.equal(row.category, 'security')
})

test('email verification: correct token confirms successfully and flips is_email_verified 0 -> 1', async () => {
  const { client, userId } = await registerUser('everify_success')
  assert.equal(await getEmailVerified(userId), 0)

  await client.post('/api/auth/verify-email/request', {})
  const rawToken = await getRawEmailTokenFromOutbox(userId)

  const confirmRes = await client.post('/api/auth/verify-email/confirm', { token: rawToken })
  assert.equal(confirmRes.status, 200)
  assert.equal(await getEmailVerified(userId), 1)
})

test('email verification: wrong token is rejected with 400 and does not verify the account', async () => {
  const { client, userId } = await registerUser('everify_wrong')
  await client.post('/api/auth/verify-email/request', {})

  const res = await client.post('/api/auth/verify-email/confirm', { token: 'deadbeef'.repeat(8) })
  assert.equal(res.status, 400)
  assert.equal(await getEmailVerified(userId), 0)
})

test('email verification: expired token is rejected (simulated via direct D1 backdating)', async () => {
  const { client, userId } = await registerUser('everify_expired')
  await client.post('/api/auth/verify-email/request', {})
  const rawToken = await getRawEmailTokenFromOutbox(userId)

  await execD1(`UPDATE identity_verification_tokens SET expires_at = datetime('now', '-1 minutes') WHERE user_id = ${userId} AND channel = 'email'`)

  const res = await client.post('/api/auth/verify-email/confirm', { token: rawToken })
  assert.equal(res.status, 400)
  assert.equal(await getEmailVerified(userId), 0)
})

test('email verification: a consumed token cannot be replayed', async () => {
  const { client, userId } = await registerUser('everify_replay')
  await client.post('/api/auth/verify-email/request', {})
  const rawToken = await getRawEmailTokenFromOutbox(userId)

  const first = await client.post('/api/auth/verify-email/confirm', { token: rawToken })
  assert.equal(first.status, 200)

  const replay = await client.post('/api/auth/verify-email/confirm', { token: rawToken })
  assert.equal(replay.status, 400, 'a consumed verification token must be rejected on replay')
})

test('email verification: malformed confirm request body is rejected with 400', async () => {
  const { client } = await registerUser('everify_malformed')
  const res1 = await client.post('/api/auth/verify-email/confirm', {})
  assert.equal(res1.status, 400)
  const res2 = await client.post('/api/auth/verify-email/confirm', { token: '' })
  assert.equal(res2.status, 400)
})

test('email verification: another authenticated user cannot confirm using this user\'s token (server-resolved ownership, cross-user impossible)', async () => {
  const { client: clientA, userId: userIdA } = await registerUser('everify_owner_a')
  const { client: clientB, userId: userIdB } = await registerUser('everify_owner_b')
  assert.notEqual(userIdA, userIdB)

  await clientA.post('/api/auth/verify-email/request', {})
  const rawTokenA = await getRawEmailTokenFromOutbox(userIdA)

  // User B tries to confirm using A's raw token, authenticated as B.
  const crossRes = await clientB.post('/api/auth/verify-email/confirm', { token: rawTokenA })
  assert.equal(crossRes.status, 400, 'a token issued to user A must not be confirmable by an authenticated user B')
  assert.equal(await getEmailVerified(userIdA), 0, 'user A must remain unverified after the cross-user attempt')
  assert.equal(await getEmailVerified(userIdB), 0)

  // The legitimate owner can still use it afterward — the cross-user
  // attempt must not have consumed or corrupted the token.
  const ownerConfirm = await clientA.post('/api/auth/verify-email/confirm', { token: rawTokenA })
  assert.equal(ownerConfirm.status, 200)
  assert.equal(await getEmailVerified(userIdA), 1)
})

test('email verification: resend issues a new token; the OLDER still-valid token remains usable (no accidental invalidation)', async () => {
  const { client, userId } = await registerUser('everify_resend')
  await client.post('/api/auth/verify-email/request', {})
  const tokenA = await getRawEmailTokenFromOutbox(userId)

  await client.post('/api/auth/verify-email/request', {})
  const tokenB = await getRawEmailTokenFromOutbox(userId)
  assert.notEqual(tokenA, tokenB)

  const res = await client.post('/api/auth/verify-email/confirm', { token: tokenA })
  assert.equal(res.status, 200, 'an earlier still-valid token must remain usable even after a resend')
  assert.equal(await getEmailVerified(userId), 1)
})

test('email verification: requesting verification again after already verified is rejected with 409 (already-verified behavior)', async () => {
  const { client, userId } = await registerUser('everify_already')
  await client.post('/api/auth/verify-email/request', {})
  const rawToken = await getRawEmailTokenFromOutbox(userId)
  await client.post('/api/auth/verify-email/confirm', { token: rawToken })
  assert.equal(await getEmailVerified(userId), 1)

  const res = await client.post('/api/auth/verify-email/request', {})
  assert.equal(res.status, 409)
})

// ============================== PHONE ==============================

test('phone verification: request is rejected with 400 when the account has no phone on file', async () => {
  const { client } = await registerUser('pverify_no_phone')
  const res = await client.post('/api/auth/verify-phone/request', {})
  assert.equal(res.status, 400)
})

test('phone verification: unauthenticated request is rejected (401)', async () => {
  const anon = new ApiClient()
  const res = await anon.post('/api/auth/verify-phone/request', {})
  assert.equal(res.status, 401)
})

test('phone verification: request enqueues an Engine 9 outbox event with a 6-digit numeric code, category=security', async () => {
  const { client, userId } = await registerUserWithPhone('pverify_enqueue')
  const res = await client.post('/api/auth/verify-phone/request', {})
  assert.equal(res.status, 200)

  const row = await queryOneD1(`SELECT category FROM notification_outbox WHERE event_type='phone_verification_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`)
  assert.ok(row, 'phone verification must go through notification_outbox — the shared Engine 9 outbox, not a second mechanism')
  assert.equal(row.category, 'security')

  const code = await getRawPhoneCodeFromOutbox(userId)
  assert.match(code, /^\d{6}$/, 'expected a 6-digit numeric code')
})

test('phone verification: correct code confirms successfully and flips is_phone_verified 0 -> 1', async () => {
  const { client, userId } = await registerUserWithPhone('pverify_success')
  assert.equal(await getPhoneVerified(userId), 0)

  await client.post('/api/auth/verify-phone/request', {})
  const code = await getRawPhoneCodeFromOutbox(userId)

  const confirmRes = await client.post('/api/auth/verify-phone/confirm', { code })
  assert.equal(confirmRes.status, 200)
  assert.equal(await getPhoneVerified(userId), 1)
})

test('phone verification: wrong code is rejected with 400 and does not verify the account', async () => {
  const { client, userId } = await registerUserWithPhone('pverify_wrong')
  await client.post('/api/auth/verify-phone/request', {})

  const res = await client.post('/api/auth/verify-phone/confirm', { code: '000000' })
  assert.equal(res.status, 400)
  assert.equal(await getPhoneVerified(userId), 0)
})

test('phone verification: expired code is rejected (simulated via direct D1 backdating)', async () => {
  const { client, userId } = await registerUserWithPhone('pverify_expired')
  await client.post('/api/auth/verify-phone/request', {})
  const code = await getRawPhoneCodeFromOutbox(userId)

  await execD1(`UPDATE identity_verification_tokens SET expires_at = datetime('now', '-1 minutes') WHERE user_id = ${userId} AND channel = 'phone'`)

  const res = await client.post('/api/auth/verify-phone/confirm', { code })
  assert.equal(res.status, 400)
  assert.equal(await getPhoneVerified(userId), 0)
})

test('phone verification: a consumed code cannot be replayed', async () => {
  const { client, userId } = await registerUserWithPhone('pverify_replay')
  await client.post('/api/auth/verify-phone/request', {})
  const code = await getRawPhoneCodeFromOutbox(userId)

  const first = await client.post('/api/auth/verify-phone/confirm', { code })
  assert.equal(first.status, 200)

  const replay = await client.post('/api/auth/verify-phone/confirm', { code })
  assert.equal(replay.status, 400, 'a consumed verification code must be rejected on replay')
})

test('phone verification: malformed confirm request body is rejected with 400', async () => {
  const { client } = await registerUserWithPhone('pverify_malformed')
  const res1 = await client.post('/api/auth/verify-phone/confirm', {})
  assert.equal(res1.status, 400)
  const res2 = await client.post('/api/auth/verify-phone/confirm', { code: '' })
  assert.equal(res2.status, 400)
})

test('phone verification: another authenticated user cannot confirm using this user\'s code (server-resolved ownership, cross-user impossible)', async () => {
  const { client: clientA, userId: userIdA } = await registerUserWithPhone('pverify_owner_a')
  const { client: clientB, userId: userIdB } = await registerUserWithPhone('pverify_owner_b')
  assert.notEqual(userIdA, userIdB)

  await clientA.post('/api/auth/verify-phone/request', {})
  const codeA = await getRawPhoneCodeFromOutbox(userIdA)

  const crossRes = await clientB.post('/api/auth/verify-phone/confirm', { code: codeA })
  assert.equal(crossRes.status, 400, 'a code issued to user A must not be confirmable by an authenticated user B')
  assert.equal(await getPhoneVerified(userIdA), 0)
  assert.equal(await getPhoneVerified(userIdB), 0)

  const ownerConfirm = await clientA.post('/api/auth/verify-phone/confirm', { code: codeA })
  assert.equal(ownerConfirm.status, 200)
  assert.equal(await getPhoneVerified(userIdA), 1)
})

test('phone verification: resend issues a new code; the OLDER still-valid code remains usable', async () => {
  const { client, userId } = await registerUserWithPhone('pverify_resend')
  await client.post('/api/auth/verify-phone/request', {})
  const codeA = await getRawPhoneCodeFromOutbox(userId)

  await client.post('/api/auth/verify-phone/request', {})
  const codeB = await getRawPhoneCodeFromOutbox(userId)
  // Two independently-generated 6-digit codes could theoretically
  // collide by chance (1 in a million) — not asserting inequality to
  // avoid a flaky test, but asserting the OLDER one is still honored.
  void codeB

  const res = await client.post('/api/auth/verify-phone/confirm', { code: codeA })
  assert.equal(res.status, 200, 'an earlier still-valid code must remain usable even after a resend')
  assert.equal(await getPhoneVerified(userId), 1)
})

test('phone verification: requesting verification again after already verified is rejected with 409 (already-verified behavior)', async () => {
  const { client, userId } = await registerUserWithPhone('pverify_already')
  await client.post('/api/auth/verify-phone/request', {})
  const code = await getRawPhoneCodeFromOutbox(userId)
  await client.post('/api/auth/verify-phone/confirm', { code })
  assert.equal(await getPhoneVerified(userId), 1)

  const res = await client.post('/api/auth/verify-phone/request', {})
  assert.equal(res.status, 409)
})

// ============================== SECURITY ==============================

test('security: identity_verification_tokens stores only a SHA-256 hash, never the raw token/code, for BOTH channels', async () => {
  const { client: emailClient, userId: emailUserId } = await registerUser('everify_hash_check')
  await emailClient.post('/api/auth/verify-email/request', {})
  const rawToken = await getRawEmailTokenFromOutbox(emailUserId)
  const emailTokenRow = await queryOneD1(`SELECT token_hash FROM identity_verification_tokens WHERE user_id=${emailUserId} AND channel='email' ORDER BY id DESC LIMIT 1`)
  assert.ok(emailTokenRow)
  assert.notEqual(emailTokenRow.token_hash, rawToken, 'the raw email token must never be stored verbatim')
  assert.equal(emailTokenRow.token_hash.length, 64, 'expected a SHA-256 hex digest (64 chars)')

  const { client: phoneClient, userId: phoneUserId } = await registerUserWithPhone('pverify_hash_check')
  await phoneClient.post('/api/auth/verify-phone/request', {})
  const rawCode = await getRawPhoneCodeFromOutbox(phoneUserId)
  const phoneTokenRow = await queryOneD1(`SELECT token_hash FROM identity_verification_tokens WHERE user_id=${phoneUserId} AND channel='phone' ORDER BY id DESC LIMIT 1`)
  assert.ok(phoneTokenRow)
  assert.notEqual(phoneTokenRow.token_hash, rawCode, 'the raw phone code must never be stored verbatim')
  assert.equal(phoneTokenRow.token_hash.length, 64, 'expected a SHA-256 hex digest (64 chars)')
})

test('security: raw verification token/code does not leak into application logs', async () => {
  const { client, userId } = await registerUser('everify_log_leak')
  await client.post('/api/auth/verify-email/request', {})
  const rawToken = await getRawEmailTokenFromOutbox(userId)
  await client.post('/api/auth/verify-email/confirm', { token: rawToken })

  let outLog = ''
  let errLog = ''
  try {
    outLog = await readFile('/home/user/.pm2/logs/naijadeals-out-0.log', 'utf8')
  } catch { /* log file may not exist in some environments — non-fatal */ }
  try {
    errLog = await readFile('/home/user/.pm2/logs/naijadeals-error-0.log', 'utf8')
  } catch { /* non-fatal */ }

  assert.ok(!outLog.includes(rawToken), 'raw verification token must never appear in stdout logs')
  assert.ok(!errLog.includes(rawToken), 'raw verification token must never appear in stderr/error logs')
})

test('security: delivery failure cannot falsely mark an account verified — is_*_verified is only ever set inside confirmVerification\'s CAS-claim path, never inside the request functions (static source check)', async () => {
  const source = await readFile(new URL('../../src/lib/identity-verification.ts', import.meta.url), 'utf8')

  // Split the file into per-function bodies via simple markers so we can
  // assert the UPDATE ... is_*_verified statement is ABSENT from both
  // request functions and PRESENT only in confirmVerification.
  const requestEmailFn = source.slice(source.indexOf('export async function requestEmailVerification'), source.indexOf('export async function requestPhoneVerification'))
  const requestPhoneFn = source.slice(source.indexOf('export async function requestPhoneVerification'), source.indexOf('export async function confirmVerification'))
  const confirmFn = source.slice(source.indexOf('export async function confirmVerification'))

  assert.ok(!/is_email_verified\s*=\s*1|is_phone_verified\s*=\s*1/.test(requestEmailFn), 'requestEmailVerification must never itself set a verified column — only confirmVerification may, after a real CAS-claimed token')
  assert.ok(!/is_email_verified\s*=\s*1|is_phone_verified\s*=\s*1/.test(requestPhoneFn), 'requestPhoneVerification must never itself set a verified column')
  assert.match(confirmFn, /UPDATE users SET \$\{column\}/, 'confirmVerification must contain the verified-column UPDATE, gated behind the CAS-claim')

  // Both request functions must wrap their notification enqueue in a
  // try/catch that swallows the error (delivery failure never propagates
  // and never happens after/instead-of the verified-column UPDATE, since
  // that UPDATE does not exist in these functions at all).
  assert.match(requestEmailFn, /try\s*{[\s\S]*enqueueAndProcessNow[\s\S]*}\s*catch/, 'requestEmailVerification must swallow notification delivery failures')
  assert.match(requestPhoneFn, /try\s*{[\s\S]*enqueueAndProcessNow[\s\S]*}\s*catch/, 'requestPhoneVerification must swallow notification delivery failures')
})

// ============================== ENGINE 9 ==============================

test('Engine 9: identity-verification.ts uses ONLY enqueueAndProcessNow (the shared outbox) for delivery — no second/parallel notification mechanism', async () => {
  const source = await readFile(new URL('../../src/lib/identity-verification.ts', import.meta.url), 'utf8')

  // identity-verification.ts uses dynamic import('./notifications') (same
  // pattern as password-reset.ts and api-auth.ts's registration handler)
  // rather than a static top-level import — match either form.
  assert.match(source, /import\(['"]\.\/notifications['"]\)|from ['"]\.\/notifications['"]/, 'must import from the shared Engine 9 notifications module')
  assert.match(source, /enqueueAndProcessNow/, 'must call the shared enqueueAndProcessNow entrypoint')

  const forbiddenPatterns = [/nodemailer/i, /twilio/i, /sendgrid/i, /\bfetch\(['"]https?:\/\//, /mailgun/i]
  for (const pattern of forbiddenPatterns) {
    assert.ok(!pattern.test(source), `identity-verification.ts must not contain a second notification mechanism matching ${pattern}`)
  }
})

test('Engine 9: email and phone verification outbox rows carry idempotency keys scoped to the specific token hash (repeat requests do not collide)', async () => {
  const { client, userId } = await registerUser('everify_idempotency')
  await client.post('/api/auth/verify-email/request', {})
  const row1 = await queryOneD1(`SELECT idempotency_key FROM notification_outbox WHERE event_type='email_verification_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`)
  assert.ok(row1.idempotency_key.startsWith('email_verification_requested:'))

  await client.post('/api/auth/verify-email/request', {})
  const row2 = await queryOneD1(`SELECT idempotency_key FROM notification_outbox WHERE event_type='email_verification_requested' AND recipient_user_id=${userId} ORDER BY id DESC LIMIT 1`)
  assert.notEqual(row1.idempotency_key, row2.idempotency_key, 'each distinct token must produce a distinct idempotency key')
})
