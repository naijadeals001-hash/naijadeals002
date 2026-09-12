/**
 * Notification Engine — direct-library D1 access helper. Mirrors
 * tests/payment-engine/helpers/db.mjs EXACTLY (same rationale): the
 * internal outbox/idempotency/CAS behavior in src/lib/notifications.ts
 * has no dedicated HTTP endpoint that exposes it directly (enqueueNotifi
 * cationEvent/processOutboxEvent/retryFailedDeliveries are called from
 * OTHER library functions, not routed 1:1 to a route) — calling them
 * in-process via wrangler's own getPlatformProxy() is the correct layer
 * to prove these CAS races are actually closed at the database boundary.
 *
 * CRITICAL: any test file that imports this helper must be run with the
 * PM2 dev server STOPPED. Running getPlatformProxy()'s own D1 connection
 * ALONGSIDE the live `wrangler pages dev` process against the SAME local
 * SQLite file is what produced the SQLITE_BUSY contention diagnosed
 * during this session's Phase 1 investigation (two independent
 * long-lived connections to one file). Files using
 * tests/notification-engine/helpers/client.mjs (HTTP mode) require the
 * server RUNNING; files using THIS helper (direct-lib mode) require it
 * STOPPED. Never mix both helpers in the same test file.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getPlatformProxy } from 'wrangler'

const execFileAsync = promisify(execFile)

const DB_BINDING = process.env.NOTIF_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.NOTIF_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

export const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

let proxyPromise = null
function getTestProxy() {
  if (!proxyPromise) {
    proxyPromise = getPlatformProxy({ configPath: new URL('../../../wrangler.jsonc', import.meta.url).pathname })
  }
  return proxyPromise
}

export async function getTestDb() {
  const proxy = await getTestProxy()
  return proxy.env.DB
}

export async function disposeTestDb() {
  if (proxyPromise) {
    const proxy = await proxyPromise
    await proxy.dispose()
    proxyPromise = null
  }
}

/** Creates a bare test user row directly (no HTTP, no password hashing needed for these tests — recipient_user_id only needs to satisfy the FK and be a distinct id per test). */
export async function createTestUser(label) {
  const db = await getTestDb()
  const email = `nftest_direct_${label}_${RUN_NONCE}_${Math.floor(Math.random() * 1e6)}@test.ng`
  const result = await db
    .prepare('INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .bind(email, `NotifDirectHarness ${label}`, 'test-hash', 'test-salt')
    .run()
  return Number(result.meta.last_row_id)
}

export async function execD1(sql) {
  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_BINDING, '--local', '--json', `--command=${sql}`],
    { cwd: PROJECT_DIR, maxBuffer: 10 * 1024 * 1024 }
  )
  const parsed = JSON.parse(stdout)
  return parsed.map((stmt) => stmt.results)
}

export async function queryD1(sql) {
  const results = await execD1(sql)
  return results[results.length - 1]
}

export async function queryOneD1(sql) {
  const rows = await queryD1(sql)
  return rows[0] ?? null
}
