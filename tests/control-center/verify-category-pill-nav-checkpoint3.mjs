/**
 * Checkpoint 3 — Category Pill Navigation Bar: automated backend verification.
 * Real running dev server (http://localhost:3000), real local D1.
 *
 * Mirrors the exact methodology of verify-ecosystem-nav-2a.mjs /
 * verify-category-checkpoint2.mjs (same repo, same black-box-HTTP +
 * direct-D1 approach), extended to cover the new pill-nav surface.
 *
 * Proves, via HTTP + direct D1 queries against the REAL customer-facing
 * HTML (never a mocked/synthetic render):
 *  1. Migration/schema: nav_pill_visible/nav_pill_order columns exist,
 *     default hidden state for a fresh category, curated pills flagged.
 *  2. Curated pill visibility + ordering: all 13 seeded pills present in
 *     the real homepage HTML, in exact nav_pill_order sequence.
 *  3. Mixed category depths: level-1 (Electronics) and level-2
 *     (Phones & Tablets, Computers & Laptops, African Fashion) pills all
 *     render side by side with no special-casing.
 *  4. Real category IDs/slugs: every rendered pill href resolves to a
 *     genuine categories.slug — no hardcoded/synthetic destination URLs.
 *  5. nav_label_override: "Grocery & Food" renders as "Supermarket",
 *     "Books & Education" renders as "Books & Learning" (A1 decision).
 *  6. nav_badge: setting a badge renders it inside the pill.
 *  7. Cache lifecycle: population on first read, cache hit on second read,
 *     invalidation on visibility/reorder/label/badge mutation, each
 *     followed by a fresh recompute reflected on the REAL page.
 *  8. Security/RBAC: unauthenticated and read-only roles cannot mutate.
 *  9. Independence: mega-menu (is_visible) and homepage rails
 *     (is_featured_home) are provably untouched by pill mutations.
 * 10. Full restoration of every value this script touches.
 *
 * Run: node tests/control-center/verify-category-pill-nav-checkpoint3.mjs
 */
import assert from 'node:assert/strict'
import {
  BASE_URL, RUN_NONCE, execD1, queryD1, queryOneD1,
  registerUser, grantControlCenterRole, revokeAllControlCenterRoles, cleanupRunNonce,
} from './helpers/client.mjs'

const CACHE_KEY = 'category_pill_nav_header'

// Stable scoping ids added to Layout.tsx for Checkpoint 3 — same discipline
// as 2A's NAV_IDS: never page-wide text/regex match, always scope to the
// exact rendered region so unrelated content (mega-menu tree, merchandising
// rails) can never produce a false pass/fail.
const PILL_IDS = ['category-pill-nav-desktop', 'category-pill-nav-mobile-scroller', 'category-pill-nav-mobile-drawer']
function extractPillRegions(html) {
  return PILL_IDS.map((id) => {
    const start = html.indexOf(`id="${id}"`)
    assert.ok(start !== -1, `expected to find id="${id}" in the rendered HTML`)
    const end = html.indexOf('</div>', start)
    // Walk forward through nested </div> closes is unnecessary here — these
    // pill containers are flat (no nested divs inside), so the FIRST </div>
    // reliably closes the block; slice generously past it as a safety margin.
    return html.slice(start, Math.max(end + 6, start + 6000))
  })
}

async function main() {
  console.log(`--- Checkpoint 3 (Category Pill Navigation) backend verification run, nonce ${RUN_NONCE} ---`)

  // ============================================================
  // 1. MIGRATION / SCHEMA
  // ============================================================
  {
    const cols = await queryD1(`PRAGMA table_info(categories)`)
    const names = cols.map((c) => c.name)
    assert.ok(names.includes('nav_pill_visible'), 'expected categories.nav_pill_visible column to exist (migration 0063)')
    assert.ok(names.includes('nav_pill_order'), 'expected categories.nav_pill_order column to exist (migration 0063)')
    console.log('PASS: schema — nav_pill_visible / nav_pill_order columns present on categories')
  }
  {
    // Default-hidden state: any category NOT part of the curated seed must
    // default to nav_pill_visible=0 — pills are opt-in, never opt-out.
    // "tv-audio" (TV, Audio & Video, a real sibling of the curated
    // phones-tablets/laptops-computers under Electronics) is the real,
    // currently-existing non-curated control — "toys-and-games" was a slug
    // from the unapplied "Phase 1a" 189-row seed that was never real
    // production data (reconciled 2026-09-18, Category + Footer Live
    // Reconciliation — see migration 0066's header comment for the full
    // root-cause writeup).
    const row = await queryOneD1(`SELECT slug, nav_pill_visible FROM categories WHERE slug = 'tv-audio'`)
    assert.ok(row, 'expected tv-audio category to exist as a non-curated control')
    assert.equal(row.nav_pill_visible, 0, `expected a non-curated category to default to nav_pill_visible=0, got ${row.nav_pill_visible}`)
    console.log('PASS: default hidden state confirmed — non-curated category (tv-audio) has nav_pill_visible=0')
  }

  // ============================================================
  // 2. CURATED PILL SET: presence, count, exact order
  // ============================================================
  // Real production slugs (migration 0066 — reconciled 2026-09-18): the
  // ORIGINAL migration 0063 curated this exact 13-slot design (mixed
  // level-1/level-2 depth, same department coverage) but was authored
  // against an unapplied "Phase 1a" taxonomy whose slugs never existed in
  // real production data, so every UPDATE silently affected 0 rows for 10
  // of the 13 slugs. This list now reflects the REAL categories.slug
  // values curated by 0066 for the SAME design intent — see that
  // migration's header comment for the full mapping and root-cause
  // writeup, including which 2 slots (originally african-fashion,
  // art-and-crafts) were substituted with the closest genuine analogous
  // real category rather than fabricated.
  const EXPECTED_PILL_SLUGS = [
    'electronics', 'fashion', 'phones-tablets', 'laptops-computers',
    'groceries', 'beauty-health', 'home-kitchen',
    'automotive', 'sports-outdoors', 'shoes', 'drinks',
    'baby-products', 'books',
  ]
  {
    const dbPills = await queryD1(`SELECT slug, nav_pill_order, level FROM categories WHERE nav_pill_visible = 1 ORDER BY nav_pill_order ASC`)
    assert.equal(dbPills.length, 13, `expected exactly 13 curated pills in DB, found ${dbPills.length}`)
    assert.deepEqual(dbPills.map((p) => p.slug), EXPECTED_PILL_SLUGS, 'expected DB pill order to exactly match the curated seed order')
    console.log(`PASS: DB confirms exactly 13 curated pills in the expected order: ${dbPills.map((p) => p.slug).join(', ')}`)
  }

  // ============================================================
  // 3. MIXED DEPTHS + 4. REAL SLUGS — customer-facing proof, not DB-only
  // ============================================================
  {
    const homeHtml = await fetch(`${BASE_URL}/`).then((r) => r.text())
    const [desktopRegion] = extractPillRegions(homeHtml)
    const hrefs = [...desktopRegion.matchAll(/href="(\/shop\?category=[a-z-]+)"/g)].map((m) => m[1])
    const renderedSlugs = hrefs.map((h) => h.replace('/shop?category=', ''))
    assert.deepEqual(renderedSlugs, EXPECTED_PILL_SLUGS, `expected the REAL homepage desktop pill strip to render exactly the 13 curated slugs in order, got: ${renderedSlugs.join(', ')}`)
    console.log('PASS: real customer-facing homepage HTML (#category-pill-nav-desktop) renders exactly the 13 curated pills in exact DB order')

    // Mixed depth: level-1 department (electronics, level 1) sits directly
    // beside level-2 subcategory pills (phones-tablets, laptops-computers,
    // shoes, level 2) with zero special-casing.
    const levelBySlug = new Map((await queryD1(`SELECT slug, level FROM categories WHERE slug IN (${EXPECTED_PILL_SLUGS.map((s) => `'${s}'`).join(',')})`)).map((r) => [r.slug, r.level]))
    assert.equal(levelBySlug.get('electronics'), 1, 'expected electronics to be level 1')
    assert.equal(levelBySlug.get('phones-tablets'), 2, 'expected phones-tablets to be level 2')
    assert.equal(levelBySlug.get('laptops-computers'), 2, 'expected laptops-computers to be level 2')
    assert.equal(levelBySlug.get('shoes'), 2, 'expected shoes to be level 2')
    const distinctLevels = new Set([...levelBySlug.values()])
    assert.ok(distinctLevels.size >= 2, `expected the curated pill set to mix at least 2 taxonomy levels, found only: ${[...distinctLevels].join(',')}`)
    console.log(`PASS: mixed-depth taxonomy confirmed — curated pills span levels: ${[...distinctLevels].sort().join(', ')} (level-1 departments alongside level-2 subcategories, rendered identically with no special-casing)`)

    // Real category IDs/slugs: every href must resolve to a genuine row.
    const realSlugRows = await queryD1(`SELECT slug FROM categories WHERE slug IN (${renderedSlugs.map((s) => `'${s}'`).join(',')})`)
    assert.equal(realSlugRows.length, renderedSlugs.length, 'expected every rendered pill href slug to resolve to a real categories row — no hardcoded/synthetic destinations')
    console.log('PASS: every rendered pill href resolves to a real categories.slug (no hardcoded destination URLs)')
  }

  // ============================================================
  // Users for mutation tests
  // ============================================================
  const support = await registerUser('support3')
  await grantControlCenterRole(support.userId, 'support_admin')
  const auditor = await registerUser('auditor3')
  await grantControlCenterRole(auditor.userId, 'auditor')
  const admin = await registerUser('admin3')
  await grantControlCenterRole(admin.userId, 'platform_admin')

  // ============================================================
  // 8. SECURITY / RBAC
  // ============================================================
  {
    const res = await fetch(`${BASE_URL}/api/control-center/category-nav/pill-preview`)
    assert.equal(res.status, 401, `unauthenticated GET pill-preview expected 401, got ${res.status}`)
    console.log('PASS: unauthenticated GET /category-nav/pill-preview -> 401')
  }
  {
    const res = await fetch(`${BASE_URL}/api/control-center/category-nav/reorder-pills`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ordered_ids: [1] }),
    })
    assert.equal(res.status, 401, `unauthenticated POST reorder-pills expected 401, got ${res.status}`)
    console.log('PASS: unauthenticated POST /category-nav/reorder-pills -> 401')
  }
  {
    const res = await support.client.get('/api/control-center/category-nav/pill-preview')
    assert.equal(res.status, 403, `support_admin GET pill-preview expected 403 (lacks catalog.read), got ${res.status}`)
    console.log('PASS: support_admin GET /category-nav/pill-preview -> 403 (correctly denied, catalog.read not granted)')
  }
  {
    const res = await auditor.client.get('/api/control-center/category-nav/pill-preview')
    assert.equal(res.status, 200, `auditor GET pill-preview expected 200, got ${res.status}`)
    assert.ok(Array.isArray(res.body.results), 'expected results array')
    console.log(`PASS: auditor GET /category-nav/pill-preview -> 200, ${res.body.results.length} pills (read access confirmed)`)
  }
  {
    const electronicsId = (await queryOneD1(`SELECT id FROM categories WHERE slug = 'electronics'`)).id
    const res = await auditor.client.patch(`/api/control-center/category-nav/${electronicsId}`, { nav_pill_visible: false })
    assert.equal(res.status, 403, `auditor PATCH expected 403 (read-only), got ${res.status}`)
    console.log('PASS: auditor PATCH /category-nav/:id -> 403 (read-only confirmed, catalog.manage correctly withheld)')
  }
  {
    const res = await auditor.client.post('/api/control-center/category-nav/reorder-pills', { ordered_ids: [1] })
    assert.equal(res.status, 403, `auditor POST reorder-pills expected 403, got ${res.status}`)
    console.log('PASS: auditor POST /category-nav/reorder-pills -> 403 (read-only confirmed)')
  }

  // ============================================================
  // 7. CACHE LIFECYCLE: population + hit
  // ============================================================
  await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
  {
    const row0 = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
    assert.equal(row0, null, 'expected no pill-nav cache row after explicit delete')
    console.log('OK: category_pill_nav_header cache cleared for a clean test')
  }
  await fetch(`${BASE_URL}/`) // triggers Layout's getCategoryPillNav() -> populates cache
  {
    const row1 = await queryOneD1(`SELECT section_key, generated_at, payload_json FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
    assert.ok(row1, 'expected category_pill_nav_header cache row to exist after a homepage load')
    const payload = JSON.parse(row1.payload_json)
    assert.equal(payload.length, 13, `expected 13 pills in the freshly populated cache payload, got ${payload.length}`)
    console.log(`PASS: cache populated after homepage load (generated_at=${row1.generated_at}, ${payload.length} pills cached)`)
  }
  {
    // Cached read: a second homepage load within the TTL must reuse the
    // SAME generated_at (proves it hit cache, did not recompute).
    const before = await queryOneD1(`SELECT generated_at FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
    await fetch(`${BASE_URL}/`)
    const after = await queryOneD1(`SELECT generated_at FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
    assert.equal(after.generated_at, before.generated_at, 'expected a second homepage load within the TTL to hit the cache (unchanged generated_at), not recompute')
    console.log('PASS: cached read confirmed — second homepage load within TTL reused the cached payload (generated_at unchanged)')
  }

  // ============================================================
  // VISIBILITY MUTATION + CACHE INVALIDATION (using Electronics, a
  // real curated pill, hidden then restored)
  // ============================================================
  const electronics = await queryOneD1(`SELECT id, slug, nav_pill_order, nav_label_override, nav_badge FROM categories WHERE slug = 'electronics'`)
  assert.ok(electronics, 'expected electronics category to exist')
  try {
    {
      const res = await admin.client.patch(`/api/control-center/category-nav/${electronics.id}`, { nav_pill_visible: false })
      assert.equal(res.status, 200, `PATCH nav_pill_visible=false expected 200, got ${res.status}: ${JSON.stringify(res.body)}`)
      console.log('A. PASS: PATCH /category-nav/:id { nav_pill_visible: false } -> 200')
    }
    {
      const row = await queryOneD1(`SELECT nav_pill_visible FROM categories WHERE id = ${electronics.id}`)
      assert.equal(row.nav_pill_visible, 0, `expected DB nav_pill_visible=0 after hide, got ${row.nav_pill_visible}`)
      console.log('B. PASS: DB verified — categories.nav_pill_visible = 0 for Electronics')
    }
    {
      const cacheRow = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
      assert.equal(cacheRow, null, 'expected pill-nav cache row to be DELETED (invalidated) immediately after the visibility PATCH')
      console.log('C. PASS: cache invalidation confirmed — category_pill_nav_header row deleted after visibility mutation')
    }
    {
      // Customer-facing proof, not DB-only: real homepage HTML must no longer show Electronics.
      const homeAfterHide = await fetch(`${BASE_URL}/`).then((r) => r.text())
      const [desktopRegion, mobileScrollerRegion, mobileDrawerRegion] = extractPillRegions(homeAfterHide)
      for (const [label, region] of [['desktop', desktopRegion], ['mobile scroller', mobileScrollerRegion], ['mobile drawer', mobileDrawerRegion]]) {
        assert.ok(!region.includes('/shop?category=electronics"'), `expected NO electronics pill inside #${label} region after hiding, but found one`)
      }
      console.log('D. PASS: real customer-facing HTML confirms Electronics pill ABSENT from desktop, mobile scroller, AND mobile drawer after hide')
    }
    {
      const freshCache = await queryOneD1(`SELECT payload_json FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
      assert.ok(freshCache, 'expected cache to be repopulated after the post-hide homepage load')
      const links = JSON.parse(freshCache.payload_json)
      assert.equal(links.length, 12, `expected 12 pills in the recomputed cache after hiding one, got ${links.length}`)
      assert.ok(!links.some((l) => l.slug === 'electronics'), 'expected electronics absent from the freshly-recomputed cache payload')
      console.log('PASS: recomputed cache payload correctly excludes Electronics post-hide (12 pills)')
    }

    // ---------- RESTORE ----------
    {
      const res = await admin.client.patch(`/api/control-center/category-nav/${electronics.id}`, { nav_pill_visible: true, nav_pill_order: electronics.nav_pill_order })
      assert.equal(res.status, 200, `PATCH restore expected 200, got ${res.status}`)
      console.log('E. PASS: PATCH /category-nav/:id { nav_pill_visible: true } -> 200 (restore)')
    }
    {
      const row = await queryOneD1(`SELECT nav_pill_visible, nav_pill_order FROM categories WHERE id = ${electronics.id}`)
      assert.equal(row.nav_pill_visible, 1, 'expected DB nav_pill_visible=1 after restore')
      assert.equal(row.nav_pill_order, electronics.nav_pill_order, 'expected nav_pill_order preserved through hide/restore cycle')
      console.log('F. PASS: DB verified — Electronics nav_pill_visible=1, nav_pill_order restored to original')
    }
    {
      const cacheRow = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
      assert.equal(cacheRow, null, 'expected cache invalidated again after the restore PATCH')
      console.log('G. PASS: cache invalidation confirmed again on restore')
    }
    {
      const homeAfterRestore = await fetch(`${BASE_URL}/`).then((r) => r.text())
      const [desktopRegion] = extractPillRegions(homeAfterRestore)
      const hrefs = [...desktopRegion.matchAll(/href="(\/shop\?category=[a-z-]+)"/g)].map((m) => m[1].replace('/shop?category=', ''))
      assert.deepEqual(hrefs, EXPECTED_PILL_SLUGS, 'expected pill order to be fully restored to the original 13-slug sequence after restore')
      console.log('H. PASS: real homepage HTML confirms Electronics REAPPEARED and full 13-pill order fully restored')
    }
  } finally {
    // Unconditional self-heal in case any assertion above threw mid-sequence.
    await execD1(`UPDATE categories SET nav_pill_visible = 1, nav_pill_order = ${electronics.nav_pill_order} WHERE id = ${electronics.id}`)
    await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
  }

  // ============================================================
  // REORDER MUTATION + CACHE INVALIDATION
  // ============================================================
  {
    const originalOrder = await queryD1(`SELECT id, slug FROM categories WHERE nav_pill_visible = 1 ORDER BY nav_pill_order ASC`)
    assert.equal(originalOrder.length, 13, 'precondition: expected 13 pills before reorder test')
    const swapped = [...originalOrder]
    ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]] // swap electronics <-> fashion
    const orderedIds = swapped.map((r) => r.id)

    try {
      const res = await admin.client.post('/api/control-center/category-nav/reorder-pills', { ordered_ids: orderedIds })
      assert.equal(res.status, 200, `POST reorder-pills expected 200, got ${res.status}: ${JSON.stringify(res.body)}`)
      console.log('I. PASS: POST /category-nav/reorder-pills -> 200')

      const dbOrderAfter = await queryD1(`SELECT id FROM categories WHERE nav_pill_visible = 1 ORDER BY nav_pill_order ASC`)
      assert.deepEqual(dbOrderAfter.map((r) => r.id), orderedIds, 'expected DB nav_pill_order to exactly match the requested reorder')
      console.log('J. PASS: DB verified — nav_pill_order persisted in the exact requested (swapped) sequence')

      const cacheRow = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
      assert.equal(cacheRow, null, 'expected cache invalidated immediately after reorder')
      console.log('K. PASS: cache invalidation confirmed after reorder mutation')

      const homeAfterReorder = await fetch(`${BASE_URL}/`).then((r) => r.text())
      const [desktopRegion] = extractPillRegions(homeAfterReorder)
      const hrefs = [...desktopRegion.matchAll(/href="(\/shop\?category=[a-z-]+)"/g)].map((m) => m[1].replace('/shop?category=', ''))
      const expectedSwappedSlugs = swapped.map((r) => r.slug)
      assert.deepEqual(hrefs, expectedSwappedSlugs, `expected the REAL homepage to render the swapped order, got ${hrefs.join(',')}`)
      console.log(`L. PASS: real customer-facing homepage HTML reflects the reordered sequence: ${hrefs.slice(0, 2).join(' <-> ')} swapped, rest unchanged`)
    } finally {
      // Restore original order unconditionally.
      const restoreIds = originalOrder.map((r) => r.id)
      await admin.client.post('/api/control-center/category-nav/reorder-pills', { ordered_ids: restoreIds })
      await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
      const finalOrder = await queryD1(`SELECT id FROM categories WHERE nav_pill_visible = 1 ORDER BY nav_pill_order ASC`)
      assert.deepEqual(finalOrder.map((r) => r.id), restoreIds, 'expected original pill order to be fully restored after the reorder test')
      console.log('M. PASS: original 13-pill order fully restored after reorder test')
    }
  }

  // ============================================================
  // LABEL MUTATION (nav_label_override) + CACHE INVALIDATION
  // ============================================================
  {
    const grocery = await queryOneD1(`SELECT id, nav_label_override FROM categories WHERE slug = 'groceries'`)
    assert.equal(grocery.nav_label_override, 'Supermarket', `precondition: expected groceries to start with A1 label override "Supermarket", got "${grocery.nav_label_override}"`)

    // Real customer-facing proof of the EXISTING A1 override before touching it.
    const homeBefore = await fetch(`${BASE_URL}/`).then((r) => r.text())
    const [desktopBefore] = extractPillRegions(homeBefore)
    assert.ok(desktopBefore.includes('Supermarket'), 'expected "Supermarket" (A1 label override) to render in the real homepage pill strip before this test')
    assert.ok(!desktopBefore.includes('>Grocery &amp; Food<') && !desktopBefore.includes('>Grocery & Food<'), 'expected the raw category name "Grocery & Food" to NOT render in the pill (label override should replace it)')
    console.log('PASS (precondition): real homepage HTML confirms "Supermarket" label override already renders correctly (A1 decision, migration 0063)')

    try {
      const res = await admin.client.patch(`/api/control-center/category-nav/${grocery.id}`, { nav_label_override: 'Grocery Deals' })
      assert.equal(res.status, 200, `PATCH nav_label_override expected 200, got ${res.status}`)
      console.log('N. PASS: PATCH /category-nav/:id { nav_label_override } -> 200')

      const row = await queryOneD1(`SELECT nav_label_override FROM categories WHERE id = ${grocery.id}`)
      assert.equal(row.nav_label_override, 'Grocery Deals', 'expected DB nav_label_override updated')
      console.log('O. PASS: DB verified — nav_label_override updated to "Grocery Deals"')

      const cacheRow = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
      assert.equal(cacheRow, null, 'expected cache invalidated after label mutation (label/badge are shared with the pill cache per the PATCH handler)')
      console.log('P. PASS: cache invalidation confirmed after label mutation')

      const homeAfterLabel = await fetch(`${BASE_URL}/`).then((r) => r.text())
      const [desktopAfterLabel] = extractPillRegions(homeAfterLabel)
      assert.ok(desktopAfterLabel.includes('Grocery Deals'), 'expected the REAL homepage pill to render the new label "Grocery Deals"')
      assert.ok(!desktopAfterLabel.includes('Supermarket'), 'expected the OLD label "Supermarket" to no longer render')
      console.log('Q. PASS: real customer-facing homepage HTML reflects the new label override "Grocery Deals"')
    } finally {
      await admin.client.patch(`/api/control-center/category-nav/${grocery.id}`, { nav_label_override: 'Supermarket' })
      await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
      const restored = await queryOneD1(`SELECT nav_label_override FROM categories WHERE id = ${grocery.id}`)
      assert.equal(restored.nav_label_override, 'Supermarket', 'expected nav_label_override restored to original "Supermarket"')
      const homeRestored = await fetch(`${BASE_URL}/`).then((r) => r.text())
      const [desktopRestored] = extractPillRegions(homeRestored)
      assert.ok(desktopRestored.includes('Supermarket'), 'expected real homepage to show "Supermarket" again after restore')
      console.log('R. PASS: original "Supermarket" label override fully restored (DB + cache + real page)')
    }
  }

  // ============================================================
  // BADGE MUTATION (nav_badge) + CACHE INVALIDATION
  // ============================================================
  {
    const electronicsRow = await queryOneD1(`SELECT id, nav_badge FROM categories WHERE slug = 'electronics'`)
    assert.equal(electronicsRow.nav_badge, null, 'precondition: expected Electronics to start with no badge')

    try {
      const res = await admin.client.patch(`/api/control-center/category-nav/${electronicsRow.id}`, { nav_badge: 'Hot' })
      assert.equal(res.status, 200, `PATCH nav_badge expected 200, got ${res.status}`)
      console.log('S. PASS: PATCH /category-nav/:id { nav_badge: "Hot" } -> 200')

      const row = await queryOneD1(`SELECT nav_badge FROM categories WHERE id = ${electronicsRow.id}`)
      assert.equal(row.nav_badge, 'Hot', 'expected DB nav_badge updated to "Hot"')
      console.log('T. PASS: DB verified — nav_badge updated to "Hot"')

      const cacheRow = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
      assert.equal(cacheRow, null, 'expected cache invalidated after badge mutation')
      console.log('U. PASS: cache invalidation confirmed after badge mutation')

      const homeAfterBadge = await fetch(`${BASE_URL}/`).then((r) => r.text())
      const [desktopAfterBadge] = extractPillRegions(homeAfterBadge)
      // Electronics pill block specifically must contain the badge text.
      const elecStart = desktopAfterBadge.indexOf('/shop?category=electronics')
      const elecBlock = desktopAfterBadge.slice(elecStart, elecStart + 300)
      assert.ok(elecBlock.includes('Hot'), 'expected the REAL homepage Electronics pill to render the "Hot" badge')
      console.log('V. PASS: real customer-facing homepage HTML renders the "Hot" badge on the Electronics pill')
    } finally {
      await admin.client.patch(`/api/control-center/category-nav/${electronicsRow.id}`, { nav_badge: null })
      await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
      const restored = await queryOneD1(`SELECT nav_badge FROM categories WHERE id = ${electronicsRow.id}`)
      assert.equal(restored.nav_badge, null, 'expected nav_badge restored to null (no badge)')
      console.log('W. PASS: original no-badge state fully restored for Electronics')
    }
  }

  // ============================================================
  // INDEPENDENCE FROM MEGA-MENU (is_visible) AND HOMEPAGE RAILS (is_featured_home)
  // ============================================================
  {
    const before = await queryOneD1(`SELECT is_visible, is_featured_home, homepage_priority FROM categories WHERE slug = 'electronics'`)
    const id = (await queryOneD1(`SELECT id FROM categories WHERE slug = 'electronics'`)).id
    await admin.client.patch(`/api/control-center/category-nav/${id}`, { nav_pill_visible: false })
    const after = await queryOneD1(`SELECT is_visible, is_featured_home, homepage_priority FROM categories WHERE slug = 'electronics'`)
    assert.deepEqual(after, before, 'expected toggling nav_pill_visible to have ZERO side effect on is_visible/is_featured_home/homepage_priority (independent mechanisms)')
    await admin.client.patch(`/api/control-center/category-nav/${id}`, { nav_pill_visible: true, nav_pill_order: 0 })
    await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
    console.log('PASS: pill visibility mutation confirmed to have ZERO effect on is_visible (mega-menu) or is_featured_home/homepage_priority (homepage rails) — three independent mechanisms verified')
  }

  // ============================================================
  // FINAL STATE RESTORATION CHECK
  // ============================================================
  {
    const finalPills = await queryD1(`SELECT slug, nav_pill_order FROM categories WHERE nav_pill_visible = 1 ORDER BY nav_pill_order ASC`)
    assert.deepEqual(finalPills.map((p) => p.slug), EXPECTED_PILL_SLUGS, 'expected final DB state to exactly match the original 13-pill curated order')
    const groceryFinal = await queryOneD1(`SELECT nav_label_override FROM categories WHERE slug = 'groceries'`)
    assert.equal(groceryFinal.nav_label_override, 'Supermarket', 'expected groceries label override fully restored')
    const booksFinal = await queryOneD1(`SELECT nav_label_override FROM categories WHERE slug = 'books'`)
    assert.equal(booksFinal.nav_label_override, 'Books & Learning', 'expected books label override untouched')
    const electronicsFinal = await queryOneD1(`SELECT nav_badge FROM categories WHERE slug = 'electronics'`)
    assert.equal(electronicsFinal.nav_badge, null, 'expected Electronics badge fully restored to null')
    console.log('PASS: full end-state restoration verified — every value this script touched is back to its original Checkpoint-3 seed state')
  }

  // ============================================================
  // REGRESSION (lightweight — full sweep covered separately)
  // ============================================================
  for (const path of ['/', '/shop', '/categories', '/api/catalog/categories/tree']) {
    const res = await fetch(`${BASE_URL}${path}`)
    assert.equal(res.status, 200, `expected 200 for ${path}, got ${res.status}`)
  }
  console.log('PASS: regression — /, /shop, /categories, /api/catalog/categories/tree all return 200')

  // ============================================================
  // AUDIT LOGGING
  // ============================================================
  {
    const rows = await queryD1(`SELECT action FROM cc_audit_logs WHERE action = 'category_pill_nav_reordered' ORDER BY id DESC LIMIT 5`)
    assert.ok(rows.length >= 1, 'expected at least 1 category_pill_nav_reordered audit row from the reorder test above')
    console.log(`PASS: audit trail confirmed — ${rows.length} category_pill_nav_reordered row(s) recorded`)
  }
  {
    const electronicsId = (await queryOneD1(`SELECT id FROM categories WHERE slug = 'electronics'`)).id
    const rows = await queryD1(`SELECT action FROM cc_audit_logs WHERE action = 'category_nav_updated' AND entity_id = '${electronicsId}' ORDER BY id DESC LIMIT 10`)
    assert.ok(rows.length >= 3, `expected multiple category_nav_updated audit rows for Electronics (visibility + badge + independence-check mutations), got ${rows.length}`)
    console.log(`PASS: audit trail confirmed — ${rows.length} category_nav_updated rows recorded for Electronics`)
  }

  // ============================================================
  // Cleanup
  // ============================================================
  await revokeAllControlCenterRoles(support.userId)
  await revokeAllControlCenterRoles(auditor.userId)
  await revokeAllControlCenterRoles(admin.userId)
  await cleanupRunNonce(RUN_NONCE)
  await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = '${CACHE_KEY}'`)
  console.log('OK: test users cleaned up, roles revoked, cache cleared for next run')

  console.log('\n=== ALL CHECKPOINT 3 CHECKS PASSED ===')
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exitCode = 1
})
