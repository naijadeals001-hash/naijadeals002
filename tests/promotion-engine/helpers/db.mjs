/**
 * Promotion Engine (Engine 12 Legacy Remediation) — permanent regression harness,
 * D1 access helper.
 *
 * Mirrors tests/payment-engine/helpers/db.mjs EXACTLY (same rationale: coupon
 * claim/validate logic lives in src/lib/coupons.ts with no dedicated public HTTP
 * endpoint of its own — it's called FROM inside createPendingOrder(), which itself
 * is reachable only through the checkout flow's cart/session/shipping-address
 * plumbing. Exercising the concurrency invariant through that full HTTP stack
 * would pull in irrelevant setup and make the race itself harder to isolate and
 * prove. So this harness calls validateCoupon()/claimCouponUsage() DIRECTLY,
 * in-process, against the SAME local D1 SQLite file the dev server and
 * `wrangler d1 execute --local` both read/write — via wrangler's own
 * `getPlatformProxy()`, which returns a real `D1Database` binding backed by the
 * exact same `.wrangler/state/v3/d1` store used everywhere else in this project's
 * test suite. This is the same wrangler-owned local D1 engine the whole project
 * already runs on, not a new testing paradigm, no mocked D1, no in-memory
 * substitute — genuine concurrency via real Promise.all against the real engine.
 *
 * Brand merchandising tests in this same directory also use this helper for its
 * execD1/queryD1 ground-truth read path (independent of the getTestDb() proxy
 * binding, for the same "a bug in the proxy binding itself couldn't hide a real
 * problem" reason established in payment-engine's own helper).
 *
 * PRECONDITION: none beyond the project's own .wrangler/state/v3/d1 local
 * database existing (created automatically the first time `wrangler pages dev
 * --local` or `wrangler d1 execute --local` runs). The dev server does NOT need
 * to be running for this file's helpers — they open their own direct D1 binding
 * via getPlatformProxy(), independent of the HTTP server.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getPlatformProxy } from 'wrangler'

const execFileAsync = promisify(execFile)

const DB_BINDING = process.env.PROMOTION_TEST_D1_NAME ?? 'naijadeals-production'
const PROJECT_DIR = process.env.PROMOTION_TEST_PROJECT_DIR ?? new URL('../../../', import.meta.url).pathname

/** Unique-per-process suffix so repeated suite runs never collide on UNIQUE(code)/UNIQUE(email)/UNIQUE(slug). */
export const RUN_NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

let proxyPromise = null

/** Returns a shared, lazily-created `D1Database` binding for the local dev database. */
export async function getTestDb() {
  const proxy = await getTestProxy()
  return proxy.env.DB
}

function getTestProxy() {
  if (!proxyPromise) {
    proxyPromise = getPlatformProxy({ configPath: new URL('../../../wrangler.jsonc', import.meta.url).pathname })
  }
  return proxyPromise
}

/**
 * Executes one or more `;`-separated SQL statements against the local D1 database
 * via `wrangler d1 execute --local --json` (an INDEPENDENT read/write path from
 * getTestDb()'s in-process binding). Returns the parsed `results` array of each
 * statement in order.
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
 * Creates a brand-new `coupons` row for test isolation and returns its id.
 * Every test-created coupon uses a RUN_NONCE-suffixed code so repeated suite
 * runs never collide on UNIQUE(code), and so cleanup can reliably target only
 * rows this suite created (never touching WELCOME10/NAIJA5000/FREESHIP or any
 * other pre-existing coupon).
 */
export async function createTestCoupon(db, label, overrides = {}) {
  const code = `PROMOTEST_${label}_${RUN_NONCE}_${Math.floor(Math.random() * 1e6)}`.toUpperCase()
  const opts = {
    discount_type: 'fixed',
    discount_value: 100000,
    min_order_kobo: 0,
    max_discount_kobo: null,
    expires_at: null,
    is_active: 1,
    usage_limit: null,
    usage_count: 0,
    ...overrides
  }
  const result = await db
    .prepare(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_order_kobo, max_discount_kobo, expires_at, is_active, usage_limit, usage_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      code,
      `Promotion engine test coupon (${label})`,
      opts.discount_type,
      opts.discount_value,
      opts.min_order_kobo,
      opts.max_discount_kobo,
      opts.expires_at,
      opts.is_active,
      opts.usage_limit,
      opts.usage_count
    )
    .run()
  return { id: Number(result.meta.last_row_id), code }
}

/** Deletes every coupon this suite created (code LIKE 'PROMOTEST_%') — never touches pre-existing seed coupons. */
export async function cleanupTestCoupons() {
  await execD1(`DELETE FROM coupons WHERE code LIKE 'PROMOTEST_%'`)
}

/**
 * Creates a brand-new `brands` row for test isolation and returns its id + slug.
 * Every test-created brand uses a 'promotest-' slug prefix so repeated suite runs
 * never collide on UNIQUE(slug), and so cleanup can reliably target only rows
 * this suite created (never touching apple/samsung/nike/... or any other
 * pre-existing curated brand).
 */
export async function createTestBrand(db, label, overrides = {}) {
  const slug = `promotest-${label}-${RUN_NONCE}-${Math.floor(Math.random() * 1e6)}`.toLowerCase()
  const opts = {
    name: `Promotest Brand (${label})`,
    logo_url: null,
    is_nigerian: 0,
    is_featured: 0,
    display_order: null,
    status: 'active',
    ...overrides
  }
  const result = await db
    .prepare(
      `INSERT INTO brands (slug, name, logo_url, is_nigerian, is_featured, display_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(slug, opts.name, opts.logo_url, opts.is_nigerian, opts.is_featured, opts.display_order, opts.status)
    .run()
  return { id: Number(result.meta.last_row_id), slug }
}

/** Deletes every brand this suite created (slug LIKE 'promotest-%') — never touches pre-existing seed brands. */
export async function cleanupTestBrands() {
  await execD1(`DELETE FROM brands WHERE slug LIKE 'promotest-%'`)
}

/**
 * Creates a brand-new `hero_campaigns` row for test isolation and returns its
 * id + slug. Every test-created campaign uses a 'promotest-' slug prefix so
 * repeated suite runs never collide on UNIQUE(slug), and so cleanup can
 * reliably target only rows this suite created (never touching the 5 real
 * seeded campaigns from migration 0008).
 */
export async function createTestHeroCampaign(db, label, overrides = {}) {
  const slug = `promotest-hero-${label}-${RUN_NONCE}-${Math.floor(Math.random() * 1e6)}`.toLowerCase()
  const opts = {
    title: `Promotest Hero Campaign (${label})`,
    subtitle: null,
    image_desktop_url: '/static/hero/promotest-fixture-desktop.jpg',
    image_mobile_url: '/static/hero/promotest-fixture-mobile.jpg',
    cta_label: 'Shop now',
    cta_href: '/shop',
    vertical: 'shop',
    theme: 'dark',
    display_order: 100,
    status: 'active',
    starts_at: null,
    ends_at: null,
    ...overrides
  }
  const result = await db
    .prepare(
      `INSERT INTO hero_campaigns
         (slug, title, subtitle, image_desktop_url, image_mobile_url, cta_label, cta_href, vertical, theme, display_order, status, starts_at, ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      slug, opts.title, opts.subtitle, opts.image_desktop_url, opts.image_mobile_url,
      opts.cta_label, opts.cta_href, opts.vertical, opts.theme, opts.display_order,
      opts.status, opts.starts_at, opts.ends_at
    )
    .run()
  return { id: Number(result.meta.last_row_id), slug }
}

/** Deletes every hero campaign this suite created (slug LIKE 'promotest-hero-%') — never touches the 5 real seeded campaigns. */
export async function cleanupTestHeroCampaigns() {
  await execD1(`DELETE FROM hero_campaigns WHERE slug LIKE 'promotest-hero-%'`)
}

/**
 * Closes the shared platform proxy. MUST be called once via a `test.after()`
 * hook in every test file that imports this helper, or the `node --test`
 * process will hang after all tests pass (Miniflare keeps an internal
 * socket/timer alive otherwise). Safe to call even if getTestDb() was never used.
 */
export async function disposeTestDb() {
  if (proxyPromise) {
    const proxy = await proxyPromise
    await proxy.dispose()
    proxyPromise = null
  }
}
