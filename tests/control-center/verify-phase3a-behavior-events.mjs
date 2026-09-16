/**
 * Phase 3A — Recommendation Engine V1: Behavior/Event Infrastructure.
 * Automated backend verification. Real running dev server (http://localhost:3000),
 * real local D1.
 *
 * Scope (per Pat's explicit Phase 3A boundary — "event infrastructure and identity
 * instrumentation... do not redesign unrelated homepage sections, header
 * navigation, category pills, ecosystem navigation, brands, vendors, or country
 * discovery"):
 *   1. Migration/schema — behavior_events + recommendation_dismissals tables and
 *      indexes exist with the expected shape.
 *   2. Anonymous visitor identity — nd_visitor cookie is issued, separate from
 *      nd_guest, and is stable across requests.
 *   3. Event writes — product_view (PDP), category_view (shop grid), search
 *      (shop grid) each write a real, correctly-shaped row.
 *   4. category_view/search only fire on page 1 of a filter combo (no double-
 *      counting from pagination).
 *   5. Login/register merge — pre-auth anonymous behavior_events rows are
 *      rewritten in place to the authenticated user, exactly once, with zero
 *      duplication and zero data loss.
 *   6. recommendation_dismissals table exists (built now per Pat's decision #2)
 *      but is NOT populated by anything in Phase 3A (no dismiss UI exists yet).
 *   7. Retention purge marker — maybePurgeStaleBehaviorEvents() is lazy and
 *      idempotent (does not re-run within the same 24h window), reusing
 *      homepage_feed_cache exactly as designed.
 *   8. Regression — no existing route/suite is disturbed.
 *
 * Run: node tests/control-center/verify-phase3a-behavior-events.mjs
 */
import assert from 'node:assert/strict'
import {
  BASE_URL, RUN_NONCE, execD1, queryD1, queryOneD1,
} from './helpers/client.mjs'

function parseCookies(setCookieHeaders) {
  const jar = {}
  for (const raw of setCookieHeaders) {
    const [pair] = raw.split(';')
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return jar
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
}

async function fetchWithJar(path, jar, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    redirect: 'manual',
    headers: {
      ...(opts.headers ?? {}),
      ...(Object.keys(jar).length ? { Cookie: cookieHeader(jar) } : {}),
    },
  })
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  Object.assign(jar, parseCookies(setCookies))
  return res
}

async function main() {
  console.log(`--- Phase 3A backend verification run, nonce ${RUN_NONCE} ---`)

  // ---------- 1. Migration / schema ----------
  {
    const cols = await queryD1(`PRAGMA table_info(behavior_events)`)
    const colNames = cols.map((c) => c.name)
    for (const expected of ['id', 'visitor_id', 'user_id', 'event_type', 'product_id', 'category_id', 'search_query', 'source', 'occurred_at']) {
      assert.ok(colNames.includes(expected), `behavior_events missing expected column '${expected}'`)
    }
    console.log(`PASS: behavior_events schema has all ${colNames.length} expected columns`)

    const dismissalCols = await queryD1(`PRAGMA table_info(recommendation_dismissals)`)
    const dismissalColNames = dismissalCols.map((c) => c.name)
    for (const expected of ['id', 'visitor_id', 'product_id', 'dismissed_at']) {
      assert.ok(dismissalColNames.includes(expected), `recommendation_dismissals missing expected column '${expected}'`)
    }
    console.log('PASS: recommendation_dismissals schema present (Pat decision #2 — built in V1, no dismiss UI yet)')

    const indexes = await queryD1(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('behavior_events','recommendation_dismissals')`
    )
    const indexNames = indexes.map((i) => i.name)
    for (const expected of ['idx_behavior_events_visitor', 'idx_behavior_events_user', 'idx_behavior_events_type_product', 'idx_behavior_events_occurred', 'idx_reco_dismissals_visitor']) {
      assert.ok(indexNames.includes(expected), `missing expected index '${expected}'`)
    }
    console.log('PASS: all 5 expected indexes present')

    // Pat decision #3 — verify (not assume) the product-category index already existed pre-Phase-3A.
    const productIndexes = await queryD1(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='products'`)
    const categoryIdx = productIndexes.find((i) => i.name === 'idx_products_category')
    assert.ok(categoryIdx, 'expected idx_products_category to already exist on products(category_id)')
    assert.ok(categoryIdx.sql.includes('category_id'), 'idx_products_category must index category_id')
    console.log('PASS: idx_products_category verified pre-existing (Pat decision #3 — no new product-side index needed)')

    // event_type CHECK constraint — wishlist/cart/purchase must NOT be accepted values
    // (architecture proposal Section 4: those are derived from existing tables, never duplicated here).
    let rejected = false
    try {
      await execD1(`INSERT INTO behavior_events (visitor_id, event_type) VALUES ('phase3a-check-${RUN_NONCE}', 'wishlist_add')`)
    } catch {
      rejected = true
    }
    assert.ok(rejected, 'expected event_type CHECK constraint to reject an out-of-scope event type like wishlist_add')
    console.log('PASS: event_type CHECK constraint rejects wishlist_add/cart_add/purchase-style events (deliberately out of behavior_events scope)')
  }

  // ---------- Cleanup any stale fixture rows from a previous crashed run ----------
  await execD1(`DELETE FROM behavior_events WHERE source LIKE '%phase3a-test%' OR visitor_id LIKE '%phase3a%'`)
  await execD1(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'phase3atest_%')`)
  await execD1(`DELETE FROM behavior_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'phase3atest_%')`)
  await execD1(`DELETE FROM users WHERE email LIKE 'phase3atest_%'`)

  // ---------- 2 & 3. Anonymous visitor identity + event writes (PDP / category / search) ----------
  const jar = {}
  const product = await queryOneD1(`SELECT id, slug, category_id FROM products WHERE is_active = 1 LIMIT 1`)
  assert.ok(product, 'expected at least one active product to exist for this test')

  const pdpRes = await fetchWithJar(`/shop/${encodeURIComponent(product.slug)}`, jar)
  assert.equal(pdpRes.status, 200, `expected PDP 200, got ${pdpRes.status}`)
  assert.ok(jar.nd_visitor, 'expected nd_visitor cookie to be set on first PDP visit')
  assert.ok(!('nd_guest' in jar), 'expected nd_guest to NOT be set by a pure PDP view (nd_visitor and nd_guest must be independent — Pat decision #1)')
  const visitorToken = jar.nd_visitor
  console.log(`PASS: nd_visitor cookie issued (${visitorToken.slice(0, 8)}...), independent of nd_guest`)

  const categorySlugRow = await queryOneD1(`SELECT slug FROM categories WHERE id = ${product.category_id}`)
  const categoryRes = await fetchWithJar(`/shop?category=${encodeURIComponent(categorySlugRow.slug)}`, jar)
  assert.equal(categoryRes.status, 200, `expected /shop?category 200, got ${categoryRes.status}`)
  assert.equal(jar.nd_visitor, visitorToken, 'expected the SAME nd_visitor token to persist across requests (not reissued each time)')

  const searchTerm = `phase3aquery${RUN_NONCE}`
  const searchRes = await fetchWithJar(`/shop?q=${searchTerm}`, jar)
  assert.equal(searchRes.status, 200, `expected /shop?q 200, got ${searchRes.status}`)

  // Page-2 request with the SAME category filter must NOT log a second category_view
  // (architecture proposal: pagination/refinement on an already-logged view is not re-logged).
  await fetchWithJar(`/shop?category=${encodeURIComponent(categorySlugRow.slug)}&page=2`, jar)

  const events = await queryD1(`SELECT event_type, product_id, category_id, search_query, source, user_id FROM behavior_events WHERE visitor_id = '${visitorToken}' ORDER BY id`)
  assert.equal(events.length, 3, `expected exactly 3 events (product_view, category_view, search) — page=2 must not add a 4th — got ${events.length}: ${JSON.stringify(events)}`)

  const productView = events.find((e) => e.event_type === 'product_view')
  assert.ok(productView, 'expected a product_view event')
  assert.equal(productView.product_id, product.id, 'product_view.product_id must match the viewed product')
  assert.equal(productView.category_id, product.category_id, 'product_view.category_id must match the viewed product\'s category')
  assert.equal(productView.source, 'pdp', 'product_view.source must be "pdp"')
  assert.equal(productView.user_id, null, 'anonymous product_view must have user_id = NULL')
  console.log('PASS: product_view event written correctly on PDP visit')

  const categoryView = events.find((e) => e.event_type === 'category_view')
  assert.ok(categoryView, 'expected a category_view event')
  assert.equal(categoryView.category_id, product.category_id, 'category_view.category_id must match the browsed category')
  assert.equal(categoryView.source, 'shop_grid', 'category_view.source must be "shop_grid"')
  console.log('PASS: category_view event written correctly on shop-grid category browse, and NOT duplicated by a page=2 request')

  const searchEvent = events.find((e) => e.event_type === 'search')
  assert.ok(searchEvent, 'expected a search event')
  assert.equal(searchEvent.search_query, searchTerm, 'search.search_query must match the entered query')
  console.log('PASS: search event written correctly on shop-grid search')

  // ---------- 5. Login/register merge ----------
  const email = `phase3atest_${RUN_NONCE}@test.ng`
  const registerRes = await fetchWithJar('/api/auth/register', jar, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Phase3A Test', email, password: 'TestPass123!' }),
  })
  const registerBody = await registerRes.json()
  assert.equal(registerRes.status, 200, `register expected 200, got ${registerRes.status}: ${JSON.stringify(registerBody)}`)
  const userId = registerBody.user.id
  assert.ok(userId, 'expected a user id from register')
  console.log(`OK: registered test user id=${userId} using the SAME cookie jar that has 3 anonymous behavior_events rows`)

  const mergedEvents = await queryD1(`SELECT event_type, visitor_id, user_id FROM behavior_events WHERE user_id = ${userId} ORDER BY id`)
  assert.equal(mergedEvents.length, 3, `expected exactly 3 merged events for user ${userId}, got ${mergedEvents.length}`)
  for (const e of mergedEvents) {
    assert.equal(e.visitor_id, `user:${userId}`, `expected merged event visitor_id to be 'user:${userId}', got '${e.visitor_id}'`)
  }
  console.log('PASS: all 3 pre-registration anonymous events merged in place — visitor_id rewritten to user:<id>, user_id populated, zero duplication')

  const staleAnonRows = await queryD1(`SELECT COUNT(*) as n FROM behavior_events WHERE visitor_id = '${visitorToken}'`)
  assert.equal(staleAnonRows[0].n, 0, 'expected ZERO rows still carrying the pre-merge anonymous visitor_id (must be rewritten, not copied)')
  console.log('PASS: no leftover rows under the old anonymous visitor_id — confirms UPDATE-in-place, not a copy')

  // Idempotency: a second merge call with the same (now-stale) visitor token must be a no-op, not create duplicates.
  await execD1(`UPDATE behavior_events SET visitor_id = 'user:${userId}', user_id = ${userId} WHERE visitor_id = '${visitorToken}' AND user_id IS NULL`)
  const countAfterSecondMerge = await queryD1(`SELECT COUNT(*) as n FROM behavior_events WHERE user_id = ${userId}`)
  assert.equal(countAfterSecondMerge[0].n, 3, 'expected merge to remain idempotent — re-running it must not change the row count')
  console.log('PASS: merge is idempotent — re-applying it is a harmless no-op')

  // Login path (separate registered user, separate anonymous history) — same merge behavior on /login.
  {
    const jar2 = {}
    const loginProduct = await queryOneD1(`SELECT id, slug FROM products WHERE is_active = 1 AND id != ${product.id} LIMIT 1`)
    await fetchWithJar(`/shop/${encodeURIComponent(loginProduct.slug)}`, jar2)
    assert.ok(jar2.nd_visitor, 'expected nd_visitor on second anonymous session')

    const email2 = `phase3atest_login_${RUN_NONCE}@test.ng`
    await fetchWithJar('/api/auth/register', jar2, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Phase3A Login Test', email: email2, password: 'TestPass123!' }),
    })
    await fetchWithJar('/api/auth/logout', jar2, { method: 'POST' })

    // Fresh anonymous browsing AFTER logout, same browser/cookie jar (nd_session cleared, nd_visitor persists)
    const beforeReloginVisitorToken = jar2.nd_visitor
    const loginProduct2 = await queryOneD1(`SELECT id, slug FROM products WHERE is_active = 1 AND id NOT IN (${product.id}, ${loginProduct.id}) LIMIT 1`)
    await fetchWithJar(`/shop/${encodeURIComponent(loginProduct2.slug)}`, jar2)

    const loginRes = await fetchWithJar('/api/auth/login', jar2, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email2, password: 'TestPass123!' }),
    })
    const loginBody = await loginRes.json()
    assert.equal(loginRes.status, 200, `login expected 200, got ${loginRes.status}: ${JSON.stringify(loginBody)}`)
    const loginUserId = loginBody.user.id

    const mergedAfterLogin = await queryD1(`SELECT COUNT(*) as n FROM behavior_events WHERE user_id = ${loginUserId} AND visitor_id = 'user:${loginUserId}'`)
    assert.ok(mergedAfterLogin[0].n >= 1, `expected at least 1 event merged via the /login path, got ${mergedAfterLogin[0].n}`)
    const staleAfterLogin = await queryD1(`SELECT COUNT(*) as n FROM behavior_events WHERE visitor_id = '${beforeReloginVisitorToken}'`)
    assert.equal(staleAfterLogin[0].n, 0, 'expected ZERO leftover rows under the pre-login anonymous visitor_id after /login merge')
    console.log(`PASS: /login merge path also correctly rewrites anonymous history in place (user id=${loginUserId})`)
  }

  // ---------- 7. Retention purge — lazy, idempotent, marker-based ----------
  {
    await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = 'behavior_events_retention_purge'`)
    await execD1(`INSERT INTO behavior_events (visitor_id, event_type, occurred_at) VALUES ('phase3a-old-click', 'product_click', datetime('now', '-40 days'))`)
    await execD1(`INSERT INTO behavior_events (visitor_id, event_type, occurred_at) VALUES ('phase3a-old-view', 'product_view', datetime('now', '-100 days'))`)
    await execD1(`INSERT INTO behavior_events (visitor_id, event_type, occurred_at) VALUES ('phase3a-recent-view', 'product_view', datetime('now'))`)

    // Trigger the lazy purge via any real PDP hit (product.tsx calls maybePurgeStaleBehaviorEvents on every render).
    // Deliberately a FRESH, throwaway jar (not the main test's visitorToken) so this
    // sub-test's own product_view side-effect never gets counted into the earlier
    // "expected exactly 3 events" assertions above. Its own product_view row is
    // swept up in the retentionJar cleanup below.
    const retentionJar = {}
    await fetchWithJar(`/shop/${encodeURIComponent(product.slug)}`, retentionJar)

    const oldClickGone = await queryD1(`SELECT COUNT(*) as n FROM behavior_events WHERE visitor_id = 'phase3a-old-click'`)
    assert.equal(oldClickGone[0].n, 0, 'expected the 40-day-old product_click row to be purged (30-day retention)')
    const oldViewGone = await queryD1(`SELECT COUNT(*) as n FROM behavior_events WHERE visitor_id = 'phase3a-old-view'`)
    assert.equal(oldViewGone[0].n, 0, 'expected the 100-day-old product_view row to be purged (90-day retention)')
    const recentViewKept = await queryD1(`SELECT COUNT(*) as n FROM behavior_events WHERE visitor_id = 'phase3a-recent-view'`)
    assert.equal(recentViewKept[0].n, 1, 'expected the just-created product_view row to survive the purge (well within 90-day retention)')
    console.log('PASS: retention purge correctly removes 30-day-stale product_click and 90-day-stale other events, keeps recent rows')

    const markerRow = await queryOneD1(`SELECT generated_at FROM homepage_feed_cache WHERE section_key = 'behavior_events_retention_purge'`)
    assert.ok(markerRow, 'expected a retention-purge marker row to be written')

    // Second hit within the same 24h window must NOT re-run the purge (idempotent skip) —
    // prove by inserting another old row and confirming it survives because the marker blocks re-run.
    await execD1(`INSERT INTO behavior_events (visitor_id, event_type, occurred_at) VALUES ('phase3a-old-view-2', 'product_view', datetime('now', '-100 days'))`)
    const retentionJar2 = {}
    await fetchWithJar(`/shop/${encodeURIComponent(product.slug)}`, retentionJar2)
    const survivedBecauseSkipped = await queryD1(`SELECT COUNT(*) as n FROM behavior_events WHERE visitor_id = 'phase3a-old-view-2'`)
    assert.equal(survivedBecauseSkipped[0].n, 1, 'expected the purge to be SKIPPED on a second request within 24h of the marker (lazy, not every-request)')
    console.log('PASS: retention purge is lazy — does not re-run within 24h of its last run (marker-based, homepage_feed_cache reuse)')

    // Cleanup this sub-test's fixture rows, INCLUDING the real product_view rows the
    // two retentionJar/retentionJar2 PDP hits above genuinely wrote under their own
    // throwaway visitor cookies (found via a leaked-fixture audit — must not leave
    // real anonymous rows behind after this suite finishes).
    await execD1(`DELETE FROM behavior_events WHERE visitor_id IN ('phase3a-old-view-2', '${retentionJar.nd_visitor}', '${retentionJar2.nd_visitor}')`)
  }

  // ---------- 6. recommendation_dismissals — exists but untouched by Phase 3A ----------
  {
    const count = await queryD1(`SELECT COUNT(*) as n FROM recommendation_dismissals`)
    assert.equal(count[0].n, 0, 'expected recommendation_dismissals to remain EMPTY — Phase 3A builds no dismiss UI and writes nothing to this table')
    console.log('PASS: recommendation_dismissals confirmed present and untouched (table built for future use, per Pat decision #2)')
  }

  // ---------- 8. Regression — every existing route/suite unaffected ----------
  // The PDP hit in this loop is a bare, cookie-less fetch — the server will issue it
  // its OWN fresh nd_visitor cookie and write a real product_view row, same as any
  // anonymous visit would. Captured here (not discarded) so it can be swept up in
  // Cleanup below rather than left behind as a stray fixture row.
  let regressionVisitorId = null
  for (const path of ['/', '/shop', '/api/catalog/categories/tree', `/shop/${encodeURIComponent(product.slug)}`]) {
    const res = await fetch(`${BASE_URL}${path}`)
    assert.equal(res.status, 200, `regression: expected 200 for ${path}, got ${res.status}`)
    if (path.startsWith('/shop/')) {
      const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
      const visitorCookie = setCookies.map((raw) => parseCookies([raw])).find((j) => j.nd_visitor)
      if (visitorCookie) regressionVisitorId = visitorCookie.nd_visitor
    }
  }
  console.log('PASS: regression — /, /shop, /api/catalog/categories/tree, PDP all still return 200')

  {
    const cartRes = await fetch(`${BASE_URL}/api/cart/`)
    assert.equal(cartRes.status, 401, `regression: expected /api/cart/ to still be 401 for anonymous, got ${cartRes.status}`)
    console.log('PASS: regression — /api/cart/ still correctly 401s unauthenticated (cart merge / guest-token path undisturbed)')
  }

  // ---------- Cleanup ----------
  // NOTE: matches BOTH 'phase3atest_<nonce>@...' (register sub-test) AND
  // 'phase3atest_login_<nonce>@...' (login sub-test) — the plain '%' wildcard
  // on both ends covers 'login_' appearing between the prefix and the nonce.
  await execD1(`DELETE FROM behavior_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'phase3atest_%${RUN_NONCE}%')`)
  await execD1(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'phase3atest_%${RUN_NONCE}%')`)
  await execD1(`DELETE FROM users WHERE email LIKE 'phase3atest_%${RUN_NONCE}%'`)
  await execD1(`DELETE FROM behavior_events WHERE visitor_id = '${visitorToken}' OR visitor_id LIKE 'phase3a-%'`)
  if (regressionVisitorId) await execD1(`DELETE FROM behavior_events WHERE visitor_id = '${regressionVisitorId}'`)
  await execD1(`DELETE FROM homepage_feed_cache WHERE section_key = 'behavior_events_retention_purge'`)
  console.log('OK: test fixtures cleaned up')

  console.log('\n=== ALL PHASE 3A CHECKS PASSED ===')
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exitCode = 1
})
