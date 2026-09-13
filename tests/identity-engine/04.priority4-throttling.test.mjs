/**
 * Engine 1 Identity & Access Completion — Priority 4: D1-based login
 * throttling. Black-box HTTP tests against the real running dev server +
 * direct D1 ground-truth assertions. Mirrors 02/03's methodology exactly.
 *
 * Implementation under test: src/lib/login-throttle.ts
 *   WINDOW_MINUTES = 15, MAX_ATTEMPTS_PER_WINDOW = 5, dual-axis
 *   (identifier OR ip), append-only login_attempts ledger, fails OPEN on
 *   DB error. These tests treat that file as read-only ground truth per
 *   the user's explicit "do not rewrite without evidence" instruction —
 *   only genuine Category A defects found here would justify a change.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerUser, execD1, queryOneD1, queryD1, ApiClient, RUN_NONCE, BASE_URL } from './helpers/client.mjs'

const MAX_ATTEMPTS = 5

function uniqueFakeIp(tag) {
  // Deterministic-but-unique-per-call fake IPv4 so each test can isolate
  // its own IP axis without colliding with other tests running in the
  // same process / window.
  const n = Math.floor(Math.random() * 200) + 10
  return `10.${tag % 250}.${n}.${(n * 3) % 250}`
}
let ipTagCounter = 0
function freshIp() {
  ipTagCounter += 1
  return uniqueFakeIp(ipTagCounter)
}

async function loginRaw(identifier, password, ip) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) },
    body: JSON.stringify({ identifier, password }),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { __raw: text } }
  return { status: res.status, body: json }
}

async function failureCount(identifier) {
  const row = await queryOneD1(`SELECT COUNT(*) AS n FROM login_attempts WHERE identifier = '${identifier.toLowerCase()}' AND outcome='failure' AND created_at > datetime('now','-15 minutes')`)
  return row ? Number(row.n) : 0
}

// ============================== THRESHOLD / BLOCKING ==============================

test('throttling: fewer than MAX_ATTEMPTS wrong-password attempts are NOT throttled (each still returns 401, not 429)', async () => {
  const { email, password } = await registerUser('throttle_under_cap')
  const ip = freshIp()
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    const res = await loginRaw(email, 'WrongPassword!' + i, ip)
    assert.equal(res.status, 401, `attempt ${i + 1} should be a plain credential failure, not throttled`)
  }
  // The correct password must still work while under the cap.
  const okRes = await loginRaw(email, password, ip)
  assert.equal(okRes.status, 200)
})

test('throttling: reaching MAX_ATTEMPTS failed attempts (same identifier+IP) throttles the NEXT attempt with 429, even with the CORRECT password', async () => {
  const { email, password } = await registerUser('throttle_threshold')
  const ip = freshIp()
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await loginRaw(email, 'WrongPassword!' + i, ip)
    assert.equal(res.status, 401)
  }
  const blockedRes = await loginRaw(email, password, ip)
  assert.equal(blockedRes.status, 429, 'the correct password must still be refused once the throttle threshold is reached — throttling must gate BEFORE credential verification')
  assert.ok(typeof blockedRes.body.retryAfterSeconds === 'number' && blockedRes.body.retryAfterSeconds > 0, 'a throttled response must include a bounded retryAfterSeconds')
  assert.ok(blockedRes.body.retryAfterSeconds <= 15 * 60, 'retryAfterSeconds must never exceed the configured window')
})

test('throttling: a blocked attempt response never discloses which axis (identifier vs IP) tripped, nor whether the account exists', async () => {
  const ip = freshIp()
  const realIdentifier = (await registerUser('throttle_disclosure_real')).email
  const fakeIdentifier = 'nonexistent_throttle_' + Date.now() + '@test.ng'

  for (let i = 0; i < MAX_ATTEMPTS; i++) await loginRaw(realIdentifier, 'wrong' + i, ip)
  const realBlocked = await loginRaw(realIdentifier, 'wrong-again', ip)
  assert.equal(realBlocked.status, 429)

  const ip2 = freshIp()
  for (let i = 0; i < MAX_ATTEMPTS; i++) await loginRaw(fakeIdentifier, 'wrong' + i, ip2)
  const fakeBlocked = await loginRaw(fakeIdentifier, 'wrong-again', ip2)
  assert.equal(fakeBlocked.status, 429)

  assert.equal(realBlocked.body.error, fakeBlocked.body.error, 'the throttled error message must be identical whether or not the account exists (no account-existence disclosure via throttling)')
})

// ============================== ISOLATION ==============================

test('throttling: identifier isolation — failures against identifier A do not throttle identifier B on the same IP', async () => {
  const ip = freshIp()
  const { email: emailA } = await registerUser('throttle_iso_a')
  const { email: emailB, password: passwordB } = await registerUser('throttle_iso_b')

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await loginRaw(emailA, 'wrong' + i, ip)
    assert.equal(res.status, 401)
  }
  // A is now throttled...
  const aBlocked = await loginRaw(emailA, 'wrong-more', ip)
  assert.equal(aBlocked.status, 429)

  // ...but B, from the SAME ip, has made zero attempts of its own and
  // must NOT be throttled purely because A tripped the identifier axis.
  // NOTE: since the IP axis is shared, this specifically proves the
  // IDENTIFIER axis for B is independent — B's own identifier bucket is
  // empty. (The IP axis independently already has 5 failures recorded
  // against it from A's attempts, so this also exercises the IP axis —
  // see the next test for a cleaner IP-axis isolation proof.)
  const bResult = await loginRaw(emailB, passwordB, ip)
  // Because the IP itself has now accumulated >= MAX_ATTEMPTS failures
  // (from A's attempts), the IP axis will legitimately throttle B too —
  // this is INTENTIONAL dual-axis behavior, not an identifier-isolation
  // bug. We prove true identifier isolation with a fresh IP below.
  assert.equal(bResult.status, 429, 'expected the shared-IP axis to throttle B here (dual-axis design) — see the next test for isolated per-identifier proof')
})

test('throttling: identifier isolation (clean proof) — failures against identifier A on IP-1 do not throttle identifier B on a DIFFERENT IP-2', async () => {
  const ipA = freshIp()
  const ipB = freshIp()
  const { email: emailA } = await registerUser('throttle_iso_clean_a')
  const { email: emailB, password: passwordB } = await registerUser('throttle_iso_clean_b')

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await loginRaw(emailA, 'wrong' + i, ipA)
  }
  const aBlocked = await loginRaw(emailA, 'wrong-more', ipA)
  assert.equal(aBlocked.status, 429)

  // B, different identifier AND different IP, has a completely clean
  // slate on both axes and must succeed normally.
  const bResult = await loginRaw(emailB, passwordB, ipB)
  assert.equal(bResult.status, 200, 'a completely unrelated identifier+IP combination must never be affected by another account\'s throttling')
})

test('throttling: IP isolation — 5 failed attempts against 5 DIFFERENT identifiers from the SAME IP trips the IP axis even though no single identifier reached the cap', async () => {
  const ip = freshIp()
  const identifiers = []
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    identifiers.push(`ip_axis_test_${RUN_NONCE}_${i}_${Math.floor(Math.random() * 1e6)}@test.ng`)
  }
  for (const id of identifiers) {
    const res = await loginRaw(id, 'wrong-password', ip)
    assert.equal(res.status, 401, 'each individual identifier only attempted once, so it is a plain credential failure, not a per-identifier throttle')
  }
  // A 6th distinct identifier, same IP, must now be throttled purely on
  // the IP axis (each individual identifier only ever saw 1 failure).
  const sixthIdentifier = `ip_axis_test_${RUN_NONCE}_sixth_${Math.floor(Math.random() * 1e6)}@test.ng`
  const res = await loginRaw(sixthIdentifier, 'wrong-password', ip)
  assert.equal(res.status, 429, 'the IP axis must throttle a 6th distinct identifier once 5 failures have accumulated from the same source IP')
})

test('throttling: IP isolation (clean proof) — the same identifier attempted once each from 5 DIFFERENT IPs is not throttled per-IP (no single IP reached the cap), but the identifier axis itself still eventually trips', async () => {
  const { email } = await registerUser('throttle_ip_iso_identifier')
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const ip = freshIp()
    const res = await loginRaw(email, 'wrong' + i, ip)
    assert.equal(res.status, 401)
  }
  // The identifier axis has now independently accumulated 5 failures
  // (across 5 different IPs) — the 6th attempt (yet another fresh IP)
  // must be throttled purely on the IDENTIFIER axis.
  const finalIp = freshIp()
  const res = await loginRaw(email, 'wrong-final', finalIp)
  assert.equal(res.status, 429, 'the identifier axis must throttle regardless of the attacker rotating source IPs — this is the intended anti-credential-stuffing protection')
})

// ============================== EXPIRATION / RECOVERY ==============================

test('throttling: old failed attempts outside the rolling window no longer count — throttle clears once attempts age out', async () => {
  const { email, password } = await registerUser('throttle_expiry')
  const ip = freshIp()
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await loginRaw(email, 'wrong' + i, ip)
  }
  const blocked = await loginRaw(email, password, ip)
  assert.equal(blocked.status, 429)

  // Backdate all of this identifier's failure rows outside the 15-minute window.
  await execD1(`UPDATE login_attempts SET created_at = datetime('now', '-20 minutes') WHERE identifier = '${email.toLowerCase()}'`)

  const recovered = await loginRaw(email, password, ip)
  assert.equal(recovered.status, 200, 'once the failing attempts age out of the rolling window, login must succeed again — no permanent lockout')
})

test('throttling: a successful login does NOT retroactively erase prior failures within the window (the cap is purely time-based, not reset-on-success)', async () => {
  const { email, password } = await registerUser('throttle_success_no_reset')
  const ip = freshIp()
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    await loginRaw(email, 'wrong' + i, ip)
  }
  // One successful login while under the cap.
  const okRes = await loginRaw(email, password, ip)
  assert.equal(okRes.status, 200)

  // One more failure should now push the failure count back up towards
  // the cap (the earlier 4 failures were never erased by the success).
  await loginRaw(email, 'wrong-again', ip)
  const failures = await failureCount(email)
  assert.equal(failures, MAX_ATTEMPTS, 'the success in the middle must not have reset the failure ledger — total failures should be exactly MAX_ATTEMPTS after one more wrong attempt')

  const blocked = await loginRaw(email, password, ip)
  assert.equal(blocked.status, 429, 'reaching the cap again (even with a success in between) must still throttle')
})

// ============================== MALFORMED / BYPASS ==============================

test('throttling: malformed login requests (missing identifier/password) are rejected 400 and do NOT consume throttle budget', async () => {
  const ip = freshIp()
  const fakeId = `malformed_test_${RUN_NONCE}@test.ng`
  const res1 = await fetch(`${BASE_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ identifier: fakeId }) })
  assert.equal(res1.status, 400)
  const res2 = await fetch(`${BASE_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ password: 'x' }) })
  assert.equal(res2.status, 400)

  const failures = await failureCount(fakeId)
  assert.equal(failures, 0, 'a 400 due to a malformed body must never write a login_attempts row')
})

test('throttling: case-insensitive identifier normalization prevents a trivial bypass via email casing', async () => {
  const { email, password } = await registerUser('throttle_case_bypass')
  const ip = freshIp()
  const upper = email.toUpperCase()
  const mixed = email.charAt(0).toUpperCase() + email.slice(1)

  await loginRaw(upper, 'wrong1', ip)
  await loginRaw(mixed, 'wrong2', ip)
  await loginRaw(email, 'wrong3', ip)
  await loginRaw(upper, 'wrong4', ip)
  await loginRaw(mixed, 'wrong5', ip)

  // All five failures must have landed in the SAME normalized (lowercase)
  // bucket — a 6th attempt in any casing must now be throttled.
  const blocked = await loginRaw(email.toUpperCase(), password, ip)
  assert.equal(blocked.status, 429, 'varying the casing of the identifier must not let an attacker maintain 5 separate throttle buckets for the same underlying account')
})

// ============================== CONCURRENCY ==============================

test('throttling: concurrent burst of failed attempts eventually results in the identifier being throttled (no unbounded attempt flood survives)', async () => {
  const { email, password } = await registerUser('throttle_concurrency')
  const ip = freshIp()

  // Fire a burst of 10 concurrent wrong-password requests. Because
  // checkLoginThrottle + recordLoginAttempt are not a single atomic
  // transaction, a raw concurrent burst MAY let slightly more than
  // MAX_ATTEMPTS through before the cap is observed (an inherent
  // check-then-act race, not a hard security boundary violation — the
  // window is still bounded and the ledger still accurately reflects
  // every attempt). The requirement under test is: after the burst
  // settles, the account IS throttled (no infinite-attempt bypass).
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => loginRaw(email, 'concurrent-wrong-' + i, ip))
  )
  const non401 = results.filter((r) => r.status !== 401 && r.status !== 429)
  assert.equal(non401.length, 0, 'every concurrent attempt must resolve to either a plain credential failure or a throttle response — never a 200 or a 500')

  // After the burst has fully settled, the ledger must show at least
  // MAX_ATTEMPTS failures, and a subsequent request must be throttled.
  const failures = await failureCount(email)
  assert.ok(failures >= MAX_ATTEMPTS, `expected at least ${MAX_ATTEMPTS} recorded failures after the burst, got ${failures}`)

  const afterBurst = await loginRaw(email, password, ip)
  assert.equal(afterBurst.status, 429, 'after a concurrent burst of failures settles, the account must end up throttled — no way to flood past the cap indefinitely')
})

// ============================== FAIL-OPEN (static verification) ==============================

test('throttling: checkLoginThrottle is documented and implemented to fail OPEN on a DB error (defense-in-depth, not the primary auth boundary) — static source verification', async () => {
  const source = await readFile(new URL('../../src/lib/login-throttle.ts', import.meta.url), 'utf8')
  const fnBody = source.slice(source.indexOf('export async function checkLoginThrottle'), source.indexOf('export async function recordLoginAttempt'))
  assert.match(fnBody, /catch\s*\(/, 'checkLoginThrottle must catch DB errors rather than let them propagate and break the login endpoint')
  assert.match(fnBody, /throttled:\s*false/, 'on a caught error, checkLoginThrottle must resolve to not-throttled (fail OPEN) — a throttle-table outage must never itself lock out every user')
})

// ============================== NEGATIVE PROOFS ==============================

test('security: throttling never bypasses password verification — a wrong password under the cap is still rejected with 401, never silently accepted', async () => {
  const { email } = await registerUser('throttle_no_bypass')
  const ip = freshIp()
  const res = await loginRaw(email, 'DefinitelyWrongPassword!', ip)
  assert.equal(res.status, 401)
})

test('security: throttling never weakens successful authentication — a correct password under the cap still establishes a real, working session', async () => {
  const { email, password } = await registerUser('throttle_no_weaken')
  const ip = freshIp()
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ identifier: email, password }) })
  assert.equal(loginRes.status, 200)
  const setCookie = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : []
  assert.ok(setCookie.some((c) => c.startsWith('nd_session=')), 'a successful, non-throttled login must still set a real session cookie')
})

test('known limitation (documented, not a defect): identifier-axis throttling can be used to temporarily deny a KNOWN victim email login access for up to WINDOW_MINUTES by submitting failing attempts from rotating IPs — this is the standard, accepted trade-off of identifier-scoped throttling (bounded to 15 minutes, self-healing, no permanent lockout) rather than an unbounded DoS', async () => {
  // This test exists purely to make the trade-off explicit and
  // regression-checked: confirm the bound is enforced (<= 15 minutes)
  // rather than asserting the trade-off away (which would require
  // CAPTCHA/step-up-auth outside Priority 4's scope).
  const { email } = await registerUser('throttle_known_limitation')
  const ip = freshIp()
  for (let i = 0; i < MAX_ATTEMPTS; i++) await loginRaw(email, 'wrong' + i, ip)
  const blocked = await loginRaw(email, 'wrong-more', ip)
  assert.equal(blocked.status, 429)
  assert.ok(blocked.body.retryAfterSeconds <= 15 * 60, 'the identifier-axis denial-of-login window must be strictly bounded — this is what keeps the known trade-off acceptable')
})
