/**
 * Engine 1 FINAL ACCEPTANCE — browser-journey D1 helper. Mirrors
 * tests/identity-engine/helpers/client.mjs's execD1/queryD1/queryOneD1
 * exactly (same wrangler d1 execute --local --json technique) — reused
 * here rather than reinvented, since the browser-journey suite still
 * needs ground-truth DB reads (e.g. pulling a raw reset token out of
 * notification_outbox, since there is no real email delivery in this
 * environment) and DB writes (e.g. flipping users.status to 'suspended'
 * to test enforcement) alongside real Playwright browser actions.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DB_BINDING = process.env.IDENTITY_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.IDENTITY_TEST_PROJECT_DIR ?? new URL('../../../../', import.meta.url).pathname

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
