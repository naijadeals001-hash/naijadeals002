/**
 * Payment Engine — permanent regression harness, D1 access helper.
 *
 * WHY THIS EXISTS / WHY IT DIFFERS FROM tests/booking-engine/helpers/d1.mjs:
 * booking-engine's harness is deliberately black-box HTTP (it drives the
 * real running dev server via fetch()) because every invariant it verifies
 * is reachable through a public route. Unit 2's scope is narrower and more
 * internal: creditWallet()/debitWallet() in src/lib/wallet.ts have NO
 * dedicated public HTTP endpoint of their own (they're called FROM inside
 * booking payments, order payments, refunds, and the Paystack webhook —
 * exercising them through those routes would immediately violate Unit 2's
 * explicit "no premature changes to / dependence on Paystack, orders,
 * refunds, payouts, or escrow" scope boundary). So this harness calls
 * creditWallet()/debitWallet() DIRECTLY, in-process, against the SAME
 * local D1 SQLite file the dev server and `wrangler d1 execute --local`
 * both read/write — via wrangler's own `getPlatformProxy()`, which returns
 * a real `D1Database` binding backed by the exact same
 * `.wrangler/state/v3/d1` store. This is not a new testing paradigm bolted
 * on top of the app (no Miniflare-construction-from-scratch, no mocked D1,
 * no in-memory better-sqlite3 substitute) — it's the same wrangler-owned
 * local D1 engine the whole project already runs on, accessed one layer
 * lower than HTTP because that is the correct layer for THIS unit's scope.
 *
 * Ground-truth cross-checks (raw SQL assertions on ledger rows, balance
 * values, etc.) still shell out to `wrangler d1 execute --local --json`,
 * exactly like booking-engine's d1.mjs, for full parity with the
 * established convention and because a completely independent read path
 * is a stronger proof than reading back through the same proxy connection
 * that did the writing.
 *
 * PRECONDITION: none beyond the project's own .wrangler/state/v3/d1 local
 * database existing (created automatically the first time `wrangler pages
 * dev --local` or `wrangler d1 execute --local` runs). The dev server does
 * NOT need to be running for this file's helpers — they open their own
 * direct D1 binding via getPlatformProxy(), independent of the HTTP server.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getPlatformProxy } from 'wrangler'

const execFileAsync = promisify(execFile)

const DB_BINDING = process.env.PAYMENT_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.PAYMENT_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

/** Unique-per-process suffix so repeated suite runs never collide on UNIQUE(email). */
export const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

let proxyPromise = null

/**
 * Returns a shared, lazily-created `D1Database` binding for the local dev
 * database (same file wrangler pages dev / wrangler d1 execute use). Reused
 * across every test in the process — getPlatformProxy() is not free to set
 * up, and every call in this suite legitimately wants the SAME connection
 * a real Worker request would get (one binding per isolate, not one per call).
 */
export async function getTestDb() {
  const proxy = await getTestProxy()
  return proxy.env.DB
}

/**
 * Returns the shared, lazily-created platform proxy itself (not just its
 * `env.DB`). Needed by disposeTestDb() — `proxy.dispose()` is what actually
 * stops the underlying Miniflare instance wrangler spins up for
 * getPlatformProxy(); without calling it, that instance keeps an internal
 * timer/socket alive and the test process never exits on its own.
 */
function getTestProxy() {
  if (!proxyPromise) {
    proxyPromise = getPlatformProxy({ configPath: new URL('../../../wrangler.jsonc', import.meta.url).pathname })
  }
  return proxyPromise
}

/**
 * Executes one or more `;`-separated SQL statements against the local D1
 * database via `wrangler d1 execute --local --json` (an INDEPENDENT read/
 * write path from getTestDb()'s in-process binding — used for ground-truth
 * assertions so a bug in the proxy binding itself couldn't hide a real
 * problem). Returns the parsed `results` array of each statement in order.
 */
export async function execD1(sql) {
  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_BINDING, '--local', '--json', `--command=${sql}`],
    { cwd: PROJECT_DIR, maxBuffer: 10 * 1024 * 1024 }
  )
  const parsed = JSON.parse(stdout)
  return parsed.map((stmt) => stmt.results)
}

/** Convenience: runs a single SELECT and returns its `results` array directly. */
export async function queryD1(sql) {
  const results = await execD1(sql)
  return results[results.length - 1]
}

/** Convenience: runs a single SELECT expected to return exactly one row and returns it (or null). */
export async function queryOneD1(sql) {
  const rows = await queryD1(sql)
  return rows[0] ?? null
}

/**
 * Creates a brand-new `users` row (the minimum columns wallet_accounts'
 * FOREIGN KEY requires) and returns its id. Mirrors the exact column set
 * src/routes/api-auth.ts's registration insert uses, with a throwaway
 * bcrypt-shaped placeholder hash/salt (never validated by anything this
 * test touches — no login happens through this harness).
 */
export async function createTestUser(label) {
  const db = await getTestDb()
  const email = `paytest_${label}_${RUN_NONCE}_${Math.floor(Math.random() * 1e6)}@test.ng`
  const result = await db
    .prepare('INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .bind(email, `PaymentHarness ${label}`, 'test-hash', 'test-salt')
    .run()
  return Number(result.meta.last_row_id)
}

/**
 * Closes the shared platform proxy (stops the underlying local Miniflare
 * instance getPlatformProxy() started). MUST be called once via a
 * `test.after()` hook in every test file that imports this helper, or the
 * `node --test` process will hang after all tests pass instead of exiting
 * (Miniflare keeps an internal socket/timer alive otherwise). Safe to call
 * even if getTestDb()/getTestProxy() was never used in a given file (no-op).
 */
export async function disposeTestDb() {
  if (proxyPromise) {
    const proxy = await proxyPromise
    await proxy.dispose()
    proxyPromise = null
  }
}
