/**
 * Booking Engine 2.0 regression harness — direct local-D1 access for the
 * handful of assertions that genuinely need ground truth the API doesn't
 * expose (e.g. "did the wallet ledger actually get a refund row", "is there
 * really only ONE booking row for this hold after a concurrent race").
 * Shells out to the same `wrangler d1 execute --local --json` the manual
 * proof-gate testing used — no new dependency, and it talks to the exact
 * same .wrangler/state/v3/d1 SQLite file the running dev server reads/writes.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DB_BINDING = process.env.BOOKING_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.BOOKING_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

/**
 * Executes one or more `;`-separated SQL statements against the local D1
 * database and returns the parsed `results` array of the LAST statement
 * (matching wrangler's own multi-statement --json output shape: an array of
 * per-statement result objects).
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
