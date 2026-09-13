/**
 * Search Engine (Engine 11) — direct-library D1 access helper. Mirrors
 * tests/notification-engine/helpers/direct-db.mjs and
 * tests/payment-engine/helpers/db.mjs EXACTLY (same rationale):
 * enqueueSearchIndexEvent() has no dedicated HTTP endpoint that exposes
 * it directly — it is called inline from OTHER library functions
 * (createProduct/updateProduct/createServiceListing/etc.), not routed
 * 1:1 to a route — so calling it in-process via wrangler's own
 * getPlatformProxy() is the correct layer to prove the CAS/idempotency
 * behavior is actually closed at the database boundary.
 *
 * CRITICAL: any test file that imports this helper must be run with the
 * PM2 dev server STOPPED (same SQLITE_BUSY contention risk documented in
 * the notification-engine helper — two independent long-lived
 * connections to the same local SQLite file).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getPlatformProxy } from 'wrangler'

const execFileAsync = promisify(execFile)

const DB_BINDING = process.env.SEARCH_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.SEARCH_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

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

/**
 * Creates a bare test vendor+product pair via a direct INSERT, so tests
 * that need a real entity_id for the CHECK (entity_type IN (...)) FK-by-
 * convention have something to point at. No HTTP call, no seller-auth
 * flow needed for these lower-level idempotency/CAS tests.
 *
 * Column shapes confirmed directly against sqlite_master (this session):
 * vendors requires slug+name NOT NULL (business_name/user_id/
 * verification_status/store_status are additive columns from migration
 * 0009); products requires slug+category_id+title+image_url NOT NULL.
 */
export async function createTestVendor(label) {
  const db = await getTestDb()
  const slug = `search-test-vendor-${label}-${RUN_NONCE}`
  const email = `search_test_${label}_${RUN_NONCE}@test.ng`
  const user = await db
    .prepare('INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .bind(email, `SearchTest ${label}`, 'test-hash', 'test-salt')
    .run()
  const userId = Number(user.meta.last_row_id)
  const vendor = await db
    .prepare(
      `INSERT INTO vendors (slug, name, user_id, business_name, verification_status, store_status)
       VALUES (?, ?, ?, ?, 'verified', 'active')`
    )
    .bind(slug, `SearchTestVendor ${label}`, userId, `SearchTestVendor_${label}_${RUN_NONCE}`)
    .run()
  return { userId, vendorId: Number(vendor.meta.last_row_id) }
}

/** category_id=1 is a seeded reference row (categories is CONFIG data, always present). */
export async function createTestProduct(vendorId, label) {
  const db = await getTestDb()
  const slug = `search-test-product-${label}-${RUN_NONCE}`
  const result = await db
    .prepare(
      `INSERT INTO products (slug, category_id, title, image_url, is_active, moderation_status)
       VALUES (?, 1, ?, 'https://example.test/placeholder.jpg', 1, 'active')`
    )
    .bind(slug, `SearchTest Product ${label}`)
    .run()
  return Number(result.meta.last_row_id)
}

export async function createTestProductListing(productId, vendorId, priceKobo = 100000) {
  const db = await getTestDb()
  const result = await db
    .prepare(
      `INSERT INTO product_listings (product_id, vendor_id, price_kobo, stock, is_active, moderation_status)
       VALUES (?, ?, ?, 10, 1, 'active')`
    )
    .bind(productId, vendorId, priceKobo)
    .run()
  return Number(result.meta.last_row_id)
}
