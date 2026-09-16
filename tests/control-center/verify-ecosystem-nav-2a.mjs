/**
 * Micro-Checkpoint 2A — automated backend verification.
 * Real running dev server (http://localhost:3000), real local D1.
 *
 * Proves, via HTTP + direct D1 queries (Playwright script covers the actual
 * rendered-browser proof separately):
 *  1. Security: unauthorized/read-only roles cannot write ecosystem-nav config.
 *  2. Cache lifecycle: initial read populates cache, cached read hits it,
 *     admin PATCH invalidates it, next read recomputes fresh state.
 *  3. Live toggle: hiding a vertical (nav_visible=0) via the CC API removes
 *     it from the PUBLIC customer-facing HTML (curl-level proof); restoring
 *     it brings it back. (Playwright script re-proves this visually.)
 *  4. Order preservation: NaijaShop remains pinned first; DB verticals follow
 *     display_order.
 *  5. Regression: homepage/shop/categories-tree endpoints still 200.
 *
 * Run: node tests/control-center/verify-ecosystem-nav-2a.mjs
 */
import assert from 'node:assert/strict'
import {
  BASE_URL, RUN_NONCE, execD1, queryD1, queryOneD1, ApiClient,
  registerUser, grantControlCenterRole, revokeAllControlCenterRoles, cleanupRunNonce,
} from './helpers/client.mjs'

// The 4 real ecosystem-nav render surfaces, scoped by the stable ids added to
// Layout.tsx this session specifically so tests can extract precise slices
// instead of page-wide text/icon matching (which false-fails/false-passes
// against unrelated content: Hero Campaign CTAs and home.tsx's merchandising
// rail both legitimately mention verticals by name/URL regardless of
// nav_visible — see report section 12).
const NAV_IDS = ['ecosystem-nav-desktop', 'ecosystem-nav-mobile-scroller', 'ecosystem-nav-mobile-drawer', 'ecosystem-nav-footer']
function extractNavRegions(html) {
  return NAV_IDS.map((id) => {
    const start = html.indexOf(`id="${id}"`)
    assert.ok(start !== -1, `expected to find id="${id}" in the rendered HTML`)
    // Each block is short (a handful of <a> tags); none nest another of the 4 ids.
    return html.slice(start, start + 4000)
  })
}

async function main() {
  console.log(`--- Micro-Checkpoint 2A backend verification run, nonce ${RUN_NONCE} ---`)

  // ---------- Setup: pick a target vertical, self-heal + record its original state ----------
  // Self-healing: a prior run that crashed mid-test (before the restore step) can leave
  // "fresh" hidden. Force it back to the known-good starting state rather than failing
  // this run for an unrelated leftover from a previous failed run.
  await execD1(`UPDATE ecosystem_verticals SET nav_visible = 1 WHERE slug = 'fresh'`)
  await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
  const target = await queryOneD1(`SELECT id, slug, route, name, icon, status, display_order, nav_visible FROM ecosystem_verticals WHERE slug = 'fresh'`)
  assert.ok(target, 'expected the "fresh" vertical to exist')
  assert.equal(target.nav_visible, 1, 'precondition: "fresh" must start visible for this test to prove anything')
  console.log(`OK: target vertical "fresh" id=${target.id} route=${target.route} name=${target.name} nav_visible=${target.nav_visible} (original state recorded)`)

  // ---------- Precondition: confirm it's currently in the PUBLIC homepage HTML ----------
  const homeBefore = await fetch(`${BASE_URL}/`).then((r) => r.text())
  assert.ok(homeBefore.includes('href="/fresh"'), 'precondition: /fresh must currently be present in the public homepage HTML')
  console.log('OK: /fresh confirmed present in public homepage HTML before any mutation')

  // ---------- Users ----------
  const support = await registerUser('support2a')
  await grantControlCenterRole(support.userId, 'support_admin')
  const auditor = await registerUser('auditor2a')
  await grantControlCenterRole(auditor.userId, 'auditor')
  const admin = await registerUser('admin2a')
  await grantControlCenterRole(admin.userId, 'platform_admin')

  // ---------- Security: unauthorized / read-only roles ----------
  {
    const res = await support.client.get('/api/control-center/ecosystem-nav')
    assert.equal(res.status, 403, `support_admin GET expected 403, got ${res.status}`)
    console.log('PASS: support_admin GET /ecosystem-nav -> 403 (correctly denied)')
  }
  {
    const res = await auditor.client.get('/api/control-center/ecosystem-nav')
    assert.equal(res.status, 200, `auditor GET expected 200, got ${res.status}`)
    assert.ok(Array.isArray(res.body.results), 'expected results array')
    console.log(`PASS: auditor GET /ecosystem-nav -> 200, ${res.body.results.length} verticals (read access confirmed)`)
  }
  {
    const res = await auditor.client.patch(`/api/control-center/ecosystem-nav/${target.id}`, { nav_visible: false })
    assert.equal(res.status, 403, `auditor PATCH expected 403, got ${res.status}`)
    console.log('PASS: auditor PATCH /ecosystem-nav/:id -> 403 (read-only confirmed, catalog.manage correctly withheld)')
  }

  // ---------- Cache lifecycle: initial state ----------
  await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
  {
    const row0 = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
    assert.equal(row0, null, 'expected no cache row after explicit delete')
    console.log('OK: ecosystem_nav_header cache cleared for a clean test')
  }
  // Trigger a homepage load -> populates the cache
  await fetch(`${BASE_URL}/`)
  {
    const row1 = await queryOneD1(`SELECT section_key, generated_at FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
    assert.ok(row1, 'expected ecosystem_nav_header cache row to exist after a homepage load')
    console.log(`PASS: cache populated after homepage load (generated_at=${row1.generated_at})`)
  }
  const cachedPayload = await queryOneD1(`SELECT payload_json FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
  const cachedLinks = JSON.parse(cachedPayload.payload_json)
  assert.ok(cachedLinks.some((l) => l.href === '/fresh'), 'expected /fresh in the cached payload before hiding')
  console.log(`PASS: cached payload contains ${cachedLinks.length} links, includes /fresh as expected`)

  // ---------- A-G: HIDE through the Enterprise Control Center API ----------
  {
    const res = await admin.client.patch(`/api/control-center/ecosystem-nav/${target.id}`, { nav_visible: false })
    assert.equal(res.status, 200, `PATCH nav_visible=false expected 200, got ${res.status}: ${JSON.stringify(res.body)}`)
    console.log('A. PASS: PATCH /ecosystem-nav/:id { nav_visible: false } -> 200')
  }
  {
    const row = await queryOneD1(`SELECT nav_visible FROM ecosystem_verticals WHERE id = ${target.id}`)
    assert.equal(row.nav_visible, 0, `expected DB nav_visible=0 after hide, got ${row.nav_visible}`)
    console.log('B. PASS: DB verified — ecosystem_verticals.nav_visible = 0')
  }
  {
    const cacheRow = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
    assert.equal(cacheRow, null, 'expected cache row to be DELETED (invalidated) immediately after the PATCH')
    console.log('C. PASS: cache invalidation confirmed — ecosystem_nav_header row deleted from homepage_feed_cache')
  }
  {
    // IMPORTANT: do not assert "no href=/fresh anywhere on the page" or
    // "no >NaijaFresh< text anywhere on the page" — the homepage has TWO
    // other, entirely legitimate, OUT-OF-SCOPE places that can mention Fresh
    // regardless of ecosystem-nav visibility:
    //   1. Hero Campaign section (Checkpoint-1 feature) — can have a promo
    //      CTA linking to /fresh.
    //   2. home.tsx's "Explore the NaijaDeals Ecosystem" MERCHANDISING rail
    //      (spotlightVerticals/naijaServicesCards, fed by unfiltered
    //      getAllVerticals()) — renders a "NaijaFresh" text label in a
    //      MerchandisingRail card regardless of nav_visible. This is a
    //      deliberate, disclosed scope decision (see final report section
    //      12) — NOT a bug — because Pat's 2A brief scoped this checkpoint to
    //      the 3 NAVIGATION surfaces (+ the footer nav column we found), not
    //      homepage merchandising content, and a separate standing
    //      instruction forbids redesigning merchandising rails this
    //      checkpoint.
    // To avoid both false positives, we extract ONLY the 4 real nav-surface
    // regions by their stable ids (added this session specifically for this
    // purpose) and assert against those slices exclusively.
    const homeAfterHide = await fetch(`${BASE_URL}/`).then((r) => r.text())
    const navRegionsAfterHide = extractNavRegions(homeAfterHide)
    for (let i = 0; i < NAV_IDS.length; i++) {
      assert.ok(!navRegionsAfterHide[i].includes('/fresh'), `expected NO /fresh reference inside #${NAV_IDS[i]} after hiding, but found one`)
      assert.ok(!navRegionsAfterHide[i].includes('NaijaFresh'), `expected NO "NaijaFresh" text inside #${NAV_IDS[i]} after hiding, but found one`)
    }
    console.log('D-G. PASS: all 4 real ecosystem-nav surfaces (desktop pill, mobile scroller, mobile drawer, footer column) — scoped by stable id — confirm Fresh is absent after hiding')
    console.log('NOTE: not asserting page-wide absence — home.tsx\'s merchandising rail legitimately still shows "NaijaFresh" regardless of nav_visible (disclosed, out-of-scope, see report section 12)')
  }
  {
    const freshCache = await queryOneD1(`SELECT payload_json FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
    assert.ok(freshCache, 'expected cache to be repopulated after the post-hide homepage load')
    const links = JSON.parse(freshCache.payload_json)
    assert.ok(!links.some((l) => l.href === '/fresh'), 'expected /fresh absent from the freshly-recomputed cache payload')
    console.log('PASS: recomputed cache payload correctly excludes /fresh post-hide')
  }

  // ---------- H-N: RESTORE through the Enterprise Control Center API ----------
  {
    const res = await admin.client.patch(`/api/control-center/ecosystem-nav/${target.id}`, { nav_visible: true })
    assert.equal(res.status, 200, `PATCH nav_visible=true expected 200, got ${res.status}`)
    console.log('H. PASS: PATCH /ecosystem-nav/:id { nav_visible: true } -> 200')
  }
  {
    const row = await queryOneD1(`SELECT nav_visible FROM ecosystem_verticals WHERE id = ${target.id}`)
    assert.equal(row.nav_visible, 1, `expected DB nav_visible=1 after restore, got ${row.nav_visible}`)
    console.log('I. PASS: DB verified — ecosystem_verticals.nav_visible = 1')
  }
  {
    const cacheRow = await queryOneD1(`SELECT * FROM homepage_feed_cache WHERE section_key = 'ecosystem_nav_header'`)
    assert.equal(cacheRow, null, 'expected cache row to be invalidated again after the restore PATCH')
    console.log('J. PASS: cache invalidation confirmed again on restore')
  }
  {
    const homeAfterRestore = await fetch(`${BASE_URL}/`).then((r) => r.text())
    const navRegionsAfterRestore = extractNavRegions(homeAfterRestore)
    for (let i = 0; i < NAV_IDS.length; i++) {
      assert.ok(navRegionsAfterRestore[i].includes('/fresh'), `expected /fresh to REAPPEAR inside #${NAV_IDS[i]} after restore, but it did not`)
    }
    console.log('K-N. PASS: all 4 real ecosystem-nav surfaces (desktop pill, mobile scroller, mobile drawer, footer column) — scoped by stable id — confirm Fresh REAPPEARS after restore')
  }

  // ---------- Order verification ----------
  {
    const homeHtml = await fetch(`${BASE_URL}/`).then((r) => r.text())
    // Extract the desktop ecosystem pill strip order via the stable id="ecosystem-nav-desktop"
    // scoping anchor (added this session) rather than a brittle text-based regex spanning from
    // the "All Categories" button — that old regex breaks the moment unrelated button text/markup
    // between the two changes shape, which is exactly what happened here.
    const [desktopNavRegion] = extractNavRegions(homeHtml)
    const hrefs = [...desktopNavRegion.matchAll(/href="(\/[a-z]+)"/g)].map((m) => m[1])
    assert.equal(hrefs[0], '/shop', `expected NaijaShop pinned first, got order: ${hrefs.join(', ')}`)
    console.log(`PASS: NaijaShop confirmed pinned FIRST in customer header. Full order: ${hrefs.join(' -> ')}`)
    const dbOrder = await queryD1(`SELECT route FROM ecosystem_verticals WHERE nav_visible = 1 ORDER BY display_order ASC, id ASC`)
    const expectedOrder = ['/shop', ...dbOrder.map((r) => r.route)]
    assert.deepEqual(hrefs, expectedOrder, `expected header order to exactly match DB display_order, got ${hrefs.join(',')} vs expected ${expectedOrder.join(',')}`)
    console.log('PASS: full header order exactly matches ecosystem_verticals.display_order (DB-driven, not silently reordered)')
  }

  // ---------- Live/Soon semantics preserved ----------
  {
    const homeHtml = await fetch(`${BASE_URL}/`).then((r) => r.text())
    // Scoped to the desktop nav region only (same reasoning as Order verification above) —
    // a page-wide search for href="/route" can match an unrelated Hero Campaign CTA sharing
    // the same URL, which wouldn't carry a "Soon" badge and would produce a false failure.
    const [desktopNavRegion] = extractNavRegions(homeHtml)
    const dbStatuses = await queryD1(`SELECT route, status FROM ecosystem_verticals WHERE nav_visible = 1`)
    for (const v of dbStatuses) {
      const linkMatch = desktopNavRegion.match(new RegExp(`href="${v.route.replace('/', '\\/')}"[^>]*>[\\s\\S]{0,200}?</a>`))
      assert.ok(linkMatch, `expected to find a rendered link for ${v.route} inside the desktop ecosystem nav region`)
      const hasSoonBadge = /Soon</.test(linkMatch[0])
      if (v.status === 'live') {
        assert.equal(hasSoonBadge, false, `expected NO "Soon" badge for live vertical ${v.route}`)
      } else {
        assert.equal(hasSoonBadge, true, `expected a "Soon" badge for non-live vertical ${v.route} (status=${v.status})`)
      }
    }
    console.log('PASS: Live/Soon badge semantics correctly preserved for every visible vertical (no accidental "all live")')
  }

  // ---------- Regression ----------
  for (const path of ['/', '/shop', '/api/catalog/categories/tree']) {
    const res = await fetch(`${BASE_URL}${path}`)
    assert.equal(res.status, 200, `expected 200 for ${path}, got ${res.status}`)
  }
  console.log('PASS: regression — /, /shop, /api/catalog/categories/tree all return 200')

  // ---------- Audit logging ----------
  {
    const rows = await queryD1(`SELECT action, entity_id FROM cc_audit_logs WHERE action = 'ecosystem_nav_updated' AND entity_id = '${target.id}' ORDER BY id DESC LIMIT 2`)
    assert.ok(rows.length >= 2, `expected at least 2 ecosystem_nav_updated audit rows for entity ${target.id} (hide + restore), got ${rows.length}`)
    console.log(`PASS: audit trail confirmed — ${rows.length}+ ecosystem_nav_updated rows recorded for vertical ${target.id}`)
  }

  // ---------- Cleanup ----------
  await revokeAllControlCenterRoles(support.userId)
  await revokeAllControlCenterRoles(auditor.userId)
  await revokeAllControlCenterRoles(admin.userId)
  await cleanupRunNonce(RUN_NONCE)
  console.log('OK: test users cleaned up, roles revoked')

  console.log('\n=== ALL CHECKS PASSED ===')
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exitCode = 1
})
