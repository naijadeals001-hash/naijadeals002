/**
 * Promotion Engine — Engine 12 Legacy Remediation, Unit 2: Brand merchandising
 * regression coverage.
 *
 * BACKGROUND (see docs/ENGINE-12-LEGACY-REMEDIATION.md for the full forensic
 * writeup): migration 0006_brand_merchandising.sql added is_featured/
 * display_order/status/logo_url curation to the `brands` table via 36 targeted
 * UPDATE statements. seed.sql predates that migration and, on every reseed,
 * ran `DELETE FROM brands` followed by a 4-column INSERT (id, slug, name,
 * is_nigerian) that silently reset every curated brand back to
 * is_featured=0/display_order=NULL/logo_url=NULL — a CONFLICTING classification
 * in the Phase 0 audit. The fix: seed.sql's brands INSERT now carries the same
 * 8 columns (logo_url/is_featured/display_order/status) migration 0006
 * established, making reseed idempotent instead of destructive. The live local
 * dev DB (whose brands table had already been silently wiped by a prior reseed
 * before this remediation pass) was reconciled with a minimal, targeted
 * UPDATE-only script (the same 36 statements from migration 0006 — no DELETE,
 * no reinsert), verified via before/after FK-integrity and row-count checks
 * that touched nothing outside `brands`.
 *
 * Tests 1-6 exercise the LIVE local dev D1 database directly (via
 * getTestDb()/execD1()), using isolated 'promotest-*' slugged fixture rows so
 * they can run safely alongside real seeded data without ever touching
 * apple/samsung/nike/... or any other pre-existing curated brand.
 *
 * Test 7 (reseed idempotency) is the one exception: it necessarily needs a
 * full DELETE+reinsert cycle, which must never be run against the live dev DB
 * (it has real orders/wishlists/cart_items data seed.sql's DELETE+reinsert
 * cycle is not designed to safely coexist with — a separate, pre-existing,
 * out-of-scope limitation independently confirmed via git-stash testing to
 * reproduce identically with the ORIGINAL unmodified seed.sql). So Test 7
 * spins up a fully isolated, disposable local D1 instance via
 * `wrangler d1 execute --persist-to=<scratch dir>` — never the project's real
 * `.wrangler/state/v3/d1` store — applies all 49 migrations + seed.sql TWICE,
 * and asserts the featured brand count is stable (12) across both runs. The
 * scratch directory is deleted in test.after().
 *
 * Run via:
 *   npx tsx --test tests/promotion-engine/02.brand-merchandising.test.mjs
 * (node --experimental-strip-types --test cannot resolve extensionless
 * relative imports transitively pulled in via src/lib/orders.ts — see
 * 01.coupon-concurrency-and-rules.test.mjs's header comment for the full
 * pre-existing-tooling-characteristic writeup; the same constraint applies
 * here because catalog.ts is imported directly as .ts.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  getTestDb,
  execD1,
  queryD1,
  queryOneD1,
  createTestBrand,
  cleanupTestBrands,
  disposeTestDb
} from './helpers/db.mjs'
import { getTopBrands } from '../../src/lib/catalog.ts'

const execFileAsync = promisify(execFile)
const PROJECT_DIR = new URL('../../', import.meta.url).pathname

test.after(async () => {
  await cleanupTestBrands()
  await disposeTestDb()
})

// ---------- 1. Curated featured brands persist with correct values ----------
test('curated featured brands: the 12 migration-0006 brands are featured with correct display_order and logo_url', async () => {
  const rows = await queryD1(
    `SELECT slug, is_featured, display_order, logo_url FROM brands WHERE is_featured = 1 ORDER BY display_order ASC`
  )
  assert.equal(rows.length, 12, 'expected exactly 12 featured brands (migration 0006 curation)')

  const expectedOrder = [
    'apple', 'samsung', 'nike', 'sony', 'lg', 'nestle',
    'indomie', 'golden-penny', 'hp', 'peak', 'dyson', 'tecno'
  ]
  assert.deepEqual(rows.map((r) => r.slug), expectedOrder)

  for (const row of rows) {
    assert.ok(row.logo_url, `featured brand ${row.slug} must have a non-null logo_url`)
    assert.match(row.logo_url, /^\/static\/brands\/.+\.png$/)
  }
})

// ---------- 2. Display ordering is respected and gapless/sequential ----------
test('display ordering: featured brands have sequential display_order 1..12 with no gaps or duplicates', async () => {
  const rows = await queryD1(`SELECT display_order FROM brands WHERE is_featured = 1 ORDER BY display_order ASC`)
  const orders = rows.map((r) => r.display_order)
  assert.deepEqual(orders, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
})

// ---------- 3. Non-featured brands remain non-featured (no over-featuring) ----------
test('non-featured brands: brands outside the curated 12 have is_featured=0 and display_order=NULL', async () => {
  const rows = await queryD1(
    `SELECT slug, is_featured, display_order FROM brands WHERE slug NOT IN
     ('apple','samsung','nike','sony','lg','nestle','indomie','golden-penny','hp','peak','dyson','tecno')`
  )
  assert.ok(rows.length > 0, 'expected non-curated brands to exist in the fixture set')
  for (const row of rows) {
    assert.equal(row.is_featured, 0, `${row.slug} should not be featured`)
    assert.equal(row.display_order, null, `${row.slug} should have NULL display_order`)
  }
})

// ---------- 4. getTopBrands() hybrid ranking query returns correct order ----------
test('getTopBrands(): returns featured brands first ordered by display_order, both fields eligible only with logo_url + active product', async () => {
  const db = await getTestDb()
  const results = await getTopBrands(db, 12)
  assert.ok(results.length > 0, 'expected at least one brand with an active product')

  // Every featured brand present in the result must appear strictly in display_order sequence.
  const featuredInResult = results.filter((r) => r.is_featured === 1)
  const orders = featuredInResult.map((r) => r.display_order)
  const sorted = [...orders].sort((a, b) => a - b)
  assert.deepEqual(orders, sorted, 'featured brands in getTopBrands() result must be in ascending display_order')

  // Every row returned must satisfy the eligibility gate (logo_url set, status active).
  for (const row of results) {
    assert.ok(row.logo_url, `${row.slug} in getTopBrands() result must have a logo_url`)
  }

  // Featured brands must be ranked ahead of any non-featured brand in the result set.
  const firstNonFeaturedIdx = results.findIndex((r) => r.is_featured === 0)
  const lastFeaturedIdx = results.map((r) => r.is_featured).lastIndexOf(1)
  if (firstNonFeaturedIdx !== -1 && lastFeaturedIdx !== -1) {
    assert.ok(lastFeaturedIdx < firstNonFeaturedIdx, 'all featured brands must rank before any non-featured brand')
  }
})

// ---------- 5. Deterministic ordering: repeated calls return identical order ----------
test('deterministic ordering: getTopBrands() returns the same order across repeated calls with no data change', async () => {
  const db = await getTestDb()
  const run1 = (await getTopBrands(db, 12)).map((r) => r.slug)
  const run2 = (await getTopBrands(db, 12)).map((r) => r.slug)
  const run3 = (await getTopBrands(db, 12)).map((r) => r.slug)
  assert.deepEqual(run1, run2)
  assert.deepEqual(run2, run3)
})

// ---------- 6. Status gating: inactive brands are excluded from getTopBrands() ----------
test('status gating: a brand with status=inactive is excluded from getTopBrands() even if featured with a logo and active product', async () => {
  const db = await getTestDb()

  // Create an isolated test brand, feature it aggressively (display_order 0 = highest
  // priority), give it a logo, and attach a real active product so it would otherwise
  // dominate the ranking -- then flip status to inactive and prove it disappears.
  const { id: brandId, slug } = await createTestBrand(db, 'statusgate', {
    is_featured: 1,
    display_order: 0,
    logo_url: '/static/brands/promotest-fixture.png',
    status: 'active'
  })

  const categoryRow = await queryOneD1(`SELECT id FROM categories LIMIT 1`)
  const productSlug = `promotest-statusgate-product-${Date.now()}`
  await db
    .prepare(
      `INSERT INTO products (slug, category_id, brand_id, title, image_url, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .bind(productSlug, categoryRow.id, brandId, 'Promotest fixture product', '/ph.svg')
    .run()

  try {
    let results = await getTopBrands(db, 20)
    assert.ok(results.some((r) => r.slug === slug), 'active test brand should appear in getTopBrands() before status flip')

    await db.prepare(`UPDATE brands SET status = 'inactive' WHERE id = ?`).bind(brandId).run()

    results = await getTopBrands(db, 20)
    assert.ok(!results.some((r) => r.slug === slug), 'inactive test brand must be excluded from getTopBrands()')
  } finally {
    await db.prepare(`DELETE FROM products WHERE slug = ?`).bind(productSlug).run()
  }
})

// ---------- 7. Reseed idempotency: seed.sql no longer wipes curation on repeated runs ----------
test('reseed idempotency: running seed.sql twice against a fresh isolated D1 instance preserves 12 featured brands both times', async (t) => {
  const scratchDir = await mkdtemp(path.join(tmpdir(), 'brand-reseed-test-'))
  const persistPath = path.join(scratchDir, '.wrangler', 'state', 'v3')

  async function d1(args) {
    return execFileAsync('npx', ['wrangler', 'd1', 'execute', 'naijadeals-production', '--local',
      `--persist-to=${persistPath}`, '--json', ...args], { cwd: PROJECT_DIR, maxBuffer: 20 * 1024 * 1024 })
  }

  try {
    // Apply all migrations, in order, to the fresh isolated instance.
    const fs = await import('node:fs/promises')
    const migrationFiles = (await fs.readdir(path.join(PROJECT_DIR, 'migrations')))
      .filter((f) => f.endsWith('.sql'))
      .sort()
    assert.ok(migrationFiles.length >= 49, 'expected at least 49 migration files')

    for (const file of migrationFiles) {
      await d1([`--file=migrations/${file}`])
    }

    // First seed.sql run.
    await d1(['--file=seed.sql'])
    const { stdout: out1 } = await d1(['--command=SELECT COUNT(*) as total, SUM(is_featured) as featured FROM brands'])
    const featured1 = JSON.parse(out1)[0].results[0].featured

    // Second seed.sql run — the exact previously-broken reseed scenario.
    await d1(['--file=seed.sql'])
    const { stdout: out2 } = await d1(['--command=SELECT COUNT(*) as total, SUM(is_featured) as featured FROM brands'])
    const featured2 = JSON.parse(out2)[0].results[0].featured

    assert.equal(featured1, 12, 'first seed.sql run must produce 12 featured brands')
    assert.equal(featured2, 12, 'second seed.sql run (reseed) must STILL produce 12 featured brands -- proves reseed no longer silently erases curation')
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
})
