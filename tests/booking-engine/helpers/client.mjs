/**
 * Booking Engine 2.0 — permanent regression harness, HTTP test client.
 *
 * WHY THIS EXISTS: the "Booking Engine 2.0 — 57-Check Verification Gate"
 * (see docs/... final report / conversation history) live-verified every
 * invariant below by hand with ad-hoc curl + bash scripts against the local
 * dev server. That proved the engine works ONCE, but left zero permanent
 * coverage — the report's own "single most important follow-up" flag. This
 * harness re-implements that exact methodology (black-box HTTP calls against
 * the real running route layer, real local D1, genuine concurrent races via
 * Promise.all — not sequential simulation) as a runnable, repeatable Node
 * test suite using ONLY Node's built-in `node:test` + `node:assert/strict`
 * (Node 22+, zero new npm dependencies — per the gate directive's "minimum
 * maintainable harness, not a giant framework" instruction).
 *
 * PRECONDITION: the app must already be running locally with a local D1
 * binding (the project's standard `pm2 start ecosystem.config.cjs` dev
 * workflow — `wrangler pages dev dist --d1=... --local`). This harness does
 * NOT start the server itself (starting/stopping wrangler reliably from a
 * test runner is its own can of worms not worth the complexity for an
 * internal dev-time regression suite) — see README.md in this directory for
 * the run instructions.
 *
 * ISOLATION STRATEGY: D1 has no HTTP-accessible transactional rollback for
 * this black-box approach, and the suite runs against the same persistent
 * local D1 file every time. So every test file creates its OWN fresh users/
 * listings/resources (unique per run via a shared per-process nonce) and
 * NEVER asserts absolute row counts or relies on any other test's fixtures —
 * only facts scoped to its own freshly-created rows. This mirrors exactly
 * how the manual proof-gate testing was done and keeps repeated runs safe.
 */
import assert from 'node:assert/strict'

export const BASE_URL = process.env.BOOKING_TEST_BASE_URL ?? 'http://localhost:3000'

/** Unique-per-process suffix so repeated suite runs never collide on UNIQUE(email). */
export const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

/**
 * A minimal in-memory cookie jar + fetch wrapper standing in for `curl -c/-b`.
 * Hono's session cookie (`nd_session`) is httpOnly+secure — fetch() over
 * plain http://localhost still receives Set-Cookie headers fine locally
 * (Node's fetch does not enforce the `secure` attribute against the
 * connection scheme), so a hand-rolled jar is sufficient without needing a
 * browser or a cookie-jar npm package.
 */
export class ApiClient {
  constructor() {
    this.cookies = new Map()
  }

  _cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  _captureCookies(res) {
    // Node's fetch exposes multiple Set-Cookie headers via getSetCookie().
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    for (const raw of setCookies) {
      const [pair] = raw.split(';')
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      this.cookies.set(name, value)
    }
  }

  async request(method, path, { body, headers = {} } = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookies.size > 0 ? { Cookie: this._cookieHeader() } : {}),
        ...headers,
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    })
    this._captureCookies(res)
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // Non-JSON response (shouldn't happen for this API) — surface raw text for debugging.
      json = { __nonJsonBody: text }
    }
    return { status: res.status, body: json, raw: text }
  }

  get(path, opts) {
    return this.request('GET', path, opts)
  }
  post(path, body, opts = {}) {
    return this.request('POST', path, { ...opts, body })
  }
  patch(path, body, opts = {}) {
    return this.request('PATCH', path, { ...opts, body })
  }
  delete(path, opts) {
    return this.request('DELETE', path, opts)
  }
}

/**
 * Registers a brand-new user and returns a ready-to-use, already-authenticated
 * ApiClient plus the created user id. `label` becomes part of the email so
 * failures are easy to trace back to which fixture caused them.
 */
export async function registerUser(label) {
  const client = new ApiClient()
  const email = `bhtest_${label}_${RUN_NONCE}_${Math.floor(Math.random() * 1e6)}@test.ng`
  const res = await client.post('/api/auth/register', {
    name: `BookingHarness ${label}`,
    email,
    password: 'TestPass123!',
  })
  assert.equal(res.status, 200, `registerUser(${label}) failed: ${JSON.stringify(res.body)}`)
  assert.ok(res.body?.user?.id, `registerUser(${label}) did not return a user id`)
  return { client, userId: res.body.user.id, email }
}

/** Credits a user's wallet directly via D1 for payment-path tests (mirrors the manual gate's approach — there is no public "top up wallet" endpoint by design, wallet funding normally comes from Marketplace order payouts / Paystack top-ups). */
export async function creditWalletDirect(userId, amountKobo) {
  const { execD1 } = await import('./d1.mjs')
  await execD1(
    `INSERT OR IGNORE INTO wallet_accounts (user_id, cached_balance_kobo) VALUES (${userId}, 0);` +
    `INSERT INTO wallet_ledger (user_id, entry_type, amount_kobo, balance_after_kobo, reference_type, reference_id, description) VALUES (${userId}, 'credit', ${amountKobo}, ${amountKobo}, 'test_funding', 'harness', 'Booking harness test funding');` +
    `UPDATE wallet_accounts SET cached_balance_kobo = COALESCE((SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id = ${userId}), 0) + ${amountKobo} WHERE user_id = ${userId};`
  )
}

/** Creates a fresh single-capacity gig_service listing owned by `client`, returning {listingId, resourceId}. Used as the common fixture root for most test files. `cancellationPolicyId`, when provided, is forwarded as-is (used by invariant 6's cancellation/refund tests to attach a custom policy). */
export async function createTestListing(client, { title, bookingMode = 'instant', capacityUnits = 1, basePriceKobo = 500000, cancellationPolicyId } = {}) {
  const res = await client.post('/api/booking-providers/me/bookable-listings', {
    listingType: 'gig_service',
    title: title ?? `Harness Listing ${RUN_NONCE}-${Math.floor(Math.random() * 1e6)}`,
    countryIso: 'NG',
    basePriceKobo,
    bookingMode,
    capacityModel: capacityUnits > 1 ? 'multiple' : 'single',
    resources: [{ name: 'Resource 1', capacityUnits }],
    ...(cancellationPolicyId !== undefined ? { cancellationPolicyId } : {}),
  })
  assert.equal(res.status, 201, `createTestListing failed: ${JSON.stringify(res.body)}`)
  const detail = await client.get(`/api/bookable-listings/${res.body.id}`)
  assert.equal(detail.status, 200)
  return { listingId: res.body.id, resourceId: detail.body.resources[0].id, listing: detail.body.listing }
}

/** Returns a fresh, collision-free ISO window `hoursFromNow` to `hoursFromNow+durationHours` — every test that touches availability/holds should use its own window to stay independent of other tests/runs. */
export function freshWindow(hoursFromNow, durationHours = 1) {
  const start = new Date(Date.now() + hoursFromNow * 3600_000)
  const end = new Date(start.getTime() + durationHours * 3600_000)
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

/**
 * Distinct-window generator for tests that need a collision-free window
 * without caring about the exact date (most do — each test normally
 * operates on its own freshly-created listing/resource anyway, so windows
 * only need to avoid colliding with OTHER calls against the SAME resource
 * within one test). Picks a pseudo-random slot 30-395 days out so repeated
 * suite runs and parallel test files never land on the same instant.
 */
export function nextFreshWindow(durationHours = 1) {
  const hoursFromNow = 24 * 30 + Math.floor(Math.random() * 24 * 365)
  return freshWindow(hoursFromNow, durationHours)
}
