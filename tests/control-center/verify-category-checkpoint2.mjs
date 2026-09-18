/**
 * Checkpoint 2 live verification script — Category / Mega-Menu Enterprise
 * Control Center. Reuses the EXISTING tests/control-center/helpers/client.mjs
 * harness exactly (same pattern as verify-hero-checkpoint1.mjs). One-shot
 * manual verification run against the real running dev server, executed for
 * this checkpoint's report.
 *
 * Verifies:
 *   1. RBAC: support_admin (no catalog.* permission) -> 403
 *   2. RBAC: auditor (catalog.read only) -> 200 list, 403 on mutation
 *   3. platform_admin (catalog.read + catalog.manage) -> full CRUD works
 *   4. Hiding a category removes it AND its subtree from the PUBLIC mega-menu
 *      tree (via the real getMegaMenuTree() / GET /api/catalog/categories/tree)
 *   5. Un-hiding restores it to its exact original position
 *   6. Nav label override + badge are reflected in the public tree
 *   7. Reorder persists and changes the public tree's sibling order
 *   8. Featured toggle is reflected in getFeaturedHomeCategories (homepage feed)
 *   9. Preview endpoint returns byte-identical shape to the public endpoint
 *   10. Audit logging: category_nav_updated / category_nav_reordered rows exist
 *   11. Taxonomy integrity: parent_id/level/path are NEVER touched by any
 *       of the above mutations
 *   12. Cleanup: DB restored to original state, no residual test artifacts
 */
import assert from 'node:assert/strict'
import {
  registerUser,
  grantControlCenterRole,
  revokeAllControlCenterRoles,
  cleanupRunNonce,
  ApiClient,
  RUN_NONCE,
  queryOneD1,
  queryD1,
  countAuditLogs,
} from './helpers/client.mjs'

const BASE_URL = process.env.CC_TEST_BASE_URL ?? 'http://localhost:3000'

async function publicTree() {
  const res = await fetch(`${BASE_URL}/api/catalog/categories/tree`)
  return res.json()
}

function findNodeBySlug(tree, slug) {
  for (const node of tree) {
    if (node.slug === slug) return node
    const found = findNodeBySlug(node.children || [], slug)
    if (found) return found
  }
  return null
}

async function main() {
  console.log('--- Checkpoint 2 verification run, nonce', RUN_NONCE, '---')

  // Pick a real, currently-visible level-2 category with a stable parent
  // for the hide/show + label/badge tests. "phones-tablets" (child of
  // Electronics, id=2/parent_id=1) is a real seeded category confirmed to
  // exist in the ACTUAL production taxonomy (79 rows, ids 1-150) — see
  // migration 0065's header comment for why the taxonomy is only 2 levels
  // deep today (originally this test targeted "smartphones", a slug from
  // the unapplied "Phase 1a" 189-row seed that was never real production
  // data; reconciled 2026-09-18, Category + Footer Live Reconciliation).
  const targetSlug = 'phones-tablets'
  const before = await queryOneD1(`SELECT id, name, parent_id, level, path, sort_order, is_visible, nav_label_override, nav_badge, is_featured_home, homepage_priority FROM categories WHERE slug = '${targetSlug}'`)
  assert.ok(before, `expected test category "${targetSlug}" to exist`)
  const targetId = before.id
  console.log(`OK: test target category "${targetSlug}" id=${targetId}, parent_id=${before.parent_id}, level=${before.level}, path=${before.path}`)

  const originalTreeNode = findNodeBySlug(await publicTree(), targetSlug)
  assert.ok(originalTreeNode, 'expected target category to be visible in the public mega-menu tree initially')
  console.log('OK: target category confirmed visible in public mega-menu tree before any mutation')

  // 1. support_admin — zero catalog.* permission
  const support = await registerUser('cat2support')
  await grantControlCenterRole(support.userId, 'support_admin')
  const supportRes = await support.client.get('/api/control-center/category-nav')
  assert.equal(supportRes.status, 403, `expected 403 for support_admin, got ${supportRes.status}`)
  console.log('PASS: support_admin GET /category-nav -> 403 (correctly denied)')

  // 2. auditor — catalog.read only, no catalog.manage
  const auditor = await registerUser('cat2auditor')
  await grantControlCenterRole(auditor.userId, 'auditor')
  const auditorListRes = await auditor.client.get('/api/control-center/category-nav')
  assert.equal(auditorListRes.status, 200, `auditor list failed: ${JSON.stringify(auditorListRes.body)}`)
  assert.ok(Array.isArray(auditorListRes.body.results), 'expected results array')
  // Assert against the REAL row count in the DB (category_type='product',
  // matching getCategoryNavTreeForAdmin's own WHERE clause exactly) rather
  // than a hardcoded number — this endpoint must always report the true
  // live taxonomy size, whatever it is, not a number frozen at test-write
  // time. Originally hardcoded to >=189, a figure from the unapplied
  // "Phase 1a" seed that never matched real production data (actual count
  // confirmed 43 product-type categories at the time of this fix,
  // reconciled 2026-09-18, Category + Footer Live Reconciliation).
  const realCategoryCount = (await queryOneD1(`SELECT COUNT(*) as n FROM categories WHERE category_type = 'product'`)).n
  assert.equal(auditorListRes.body.results.length, realCategoryCount, `expected /category-nav to return exactly the real DB product-category count (${realCategoryCount}), got ${auditorListRes.body.results.length}`)
  console.log(`PASS: auditor GET /category-nav -> 200, ${auditorListRes.body.results.length} categories (matches real DB count exactly, read access confirmed)`)

  const auditorMutateRes = await auditor.client.patch(`/api/control-center/category-nav/${targetId}`, { is_visible: false })
  assert.equal(auditorMutateRes.status, 403, `expected 403 for auditor mutation, got ${auditorMutateRes.status}`)
  console.log('PASS: auditor PATCH /category-nav/:id -> 403 (read-only confirmed, catalog.manage correctly withheld)')

  // 3. platform_admin — full access
  const admin = await registerUser('cat2admin')
  await grantControlCenterRole(admin.userId, 'platform_admin')
  const adminListRes = await admin.client.get('/api/control-center/category-nav')
  assert.equal(adminListRes.status, 200)
  console.log('PASS: platform_admin GET /category-nav -> 200')

  // 4. Hide the target category -> must disappear from PUBLIC tree
  const hideRes = await admin.client.patch(`/api/control-center/category-nav/${targetId}`, { is_visible: false })
  assert.equal(hideRes.status, 200, `hide failed: ${JSON.stringify(hideRes.body)}`)
  const treeAfterHide = await publicTree()
  const hiddenNode = findNodeBySlug(treeAfterHide, targetSlug)
  assert.equal(hiddenNode, null, 'expected hidden category to be ABSENT from public mega-menu tree')
  console.log('PASS: hiding category via CC -> category disappears from PUBLIC /api/catalog/categories/tree')

  // 5. Un-hide -> must reappear
  const showRes = await admin.client.patch(`/api/control-center/category-nav/${targetId}`, { is_visible: true })
  assert.equal(showRes.status, 200)
  const treeAfterShow = await publicTree()
  const shownNode = findNodeBySlug(treeAfterShow, targetSlug)
  assert.ok(shownNode, 'expected category to REAPPEAR in public tree after un-hiding')
  console.log('PASS: un-hiding category via CC -> category reappears in PUBLIC mega-menu tree')

  // 6. Nav label override + badge reflected in public tree
  const labelRes = await admin.client.patch(`/api/control-center/category-nav/${targetId}`, {
    nav_label_override: 'Phones (Test Override)',
    nav_badge: 'Hot',
  })
  assert.equal(labelRes.status, 200, `label override failed: ${JSON.stringify(labelRes.body)}`)
  const treeAfterLabel = await publicTree()
  const labeledNode = findNodeBySlug(treeAfterLabel, targetSlug)
  assert.equal(labeledNode.name, 'Phones (Test Override)', 'expected public tree to show the nav_label_override, not the real category name')
  assert.equal(labeledNode.badge, 'Hot', 'expected public tree node to carry the nav_badge')
  console.log('PASS: nav_label_override + nav_badge correctly reflected in PUBLIC mega-menu tree')

  // Revert label/badge to null (restore original state)
  const revertLabelRes = await admin.client.patch(`/api/control-center/category-nav/${targetId}`, {
    nav_label_override: null,
    nav_badge: null,
  })
  assert.equal(revertLabelRes.status, 200)
  const treeAfterRevert = await publicTree()
  const revertedNode = findNodeBySlug(treeAfterRevert, targetSlug)
  assert.equal(revertedNode.name, before.name ?? 'Phones & Tablets', 'expected real category name restored after clearing override')
  console.log('PASS: clearing nav_label_override/nav_badge restores the real category name in public tree')

  // 7. Reorder siblings -> persists and changes public tree order
  const siblingsRow = await queryD1(`SELECT id, sort_order FROM categories WHERE parent_id = ${before.parent_id} AND category_type = 'product' ORDER BY sort_order ASC`)
  const siblingIds = siblingsRow.map((r) => r.id)
  assert.ok(siblingIds.length >= 2, 'expected at least 2 siblings for a meaningful reorder test')
  const reversedIds = [...siblingIds].reverse()
  const reorderRes = await admin.client.post('/api/control-center/category-nav/reorder', {
    parent_id: before.parent_id,
    ordered_ids: reversedIds,
  })
  assert.equal(reorderRes.status, 200, `reorder failed: ${JSON.stringify(reorderRes.body)}`)
  const siblingsAfterReorder = await queryD1(`SELECT id, sort_order FROM categories WHERE parent_id = ${before.parent_id} AND category_type = 'product' ORDER BY sort_order ASC`)
  assert.deepEqual(siblingsAfterReorder.map((r) => r.id), reversedIds, 'expected sort_order to reflect the reversed order after reorder call')
  console.log('PASS: reorder persists to DB and matches the exact requested order')

  // Restore original sibling order
  const restoreOrderRes = await admin.client.post('/api/control-center/category-nav/reorder', {
    parent_id: before.parent_id,
    ordered_ids: siblingIds,
  })
  assert.equal(restoreOrderRes.status, 200)
  console.log('OK: restored original sibling order')

  // 8. Featured toggle reflected in homepage feed's getFeaturedHomeCategories
  // (only meaningful if the category has a real image — check first)
  const catRow = await queryOneD1(`SELECT image_url, is_featured_home FROM categories WHERE id = ${targetId}`)
  if (catRow.image_url && !catRow.image_url.startsWith('/ph.svg')) {
    const wasFeatureed = catRow.is_featured_home === 1
    // getFeaturedHomeCategories orders by homepage_priority ASC LIMIT 12 —
    // priority 0 guarantees first position (existing featured rows start
    // at priority 2, confirmed live), so this proves the CC write actually
    // flows through to the homepage feed rather than just landing outside
    // the visible LIMIT window.
    const setFeaturedRes = await admin.client.patch(`/api/control-center/category-nav/${targetId}`, { is_featured_home: true, homepage_priority: 0 })
    assert.equal(setFeaturedRes.status, 200)
    const homepageFeedRes = await fetch(`${BASE_URL}/api/catalog/homepage-feed`)
    const feedData = await homepageFeedRes.json()
    const inFeatured = (feedData.shop_by_category || []).some((c) => c.id === targetId)
    assert.ok(inFeatured, 'expected newly-featured category (with real image + priority 0) to appear in shop_by_category feed')
    console.log('PASS: is_featured_home toggle via CC -> category appears in getFeaturedHomeCategories (homepage feed), cache correctly invalidated')
    // Restore original featured state
    await admin.client.patch(`/api/control-center/category-nav/${targetId}`, { is_featured_home: wasFeatureed, homepage_priority: before.homepage_priority })
  } else {
    console.log('SKIP: featured-toggle-reflects-in-feed test (target category has no real image, correctly excluded by getFeaturedHomeCategories\' own image filter — this is CORRECT behavior, not a bug)')
  }

  // 9. Preview endpoint matches public endpoint exactly
  const previewRes = await admin.client.get('/api/control-center/category-nav/preview')
  assert.equal(previewRes.status, 200)
  const publicTreeData = await publicTree()
  assert.deepEqual(previewRes.body.results, publicTreeData, 'expected CC preview endpoint to return BYTE-IDENTICAL tree to the public customer-facing endpoint')
  console.log('PASS: CC preview endpoint returns byte-identical data to the real public mega-menu endpoint (no parallel fake preview)')

  // 10. Audit logging
  const updateAuditCount = await countAuditLogs('category_nav_updated', 'category', String(targetId))
  assert.ok(updateAuditCount >= 4, `expected >=4 category_nav_updated audit rows for category ${targetId}, got ${updateAuditCount}`)
  console.log(`PASS: audit trail confirmed — ${updateAuditCount} category_nav_updated rows recorded for category ${targetId}`)

  const reorderAuditCount = await countAuditLogs('category_nav_reordered', 'category', String(before.parent_id))
  assert.ok(reorderAuditCount >= 2, `expected >=2 category_nav_reordered audit rows for parent ${before.parent_id}, got ${reorderAuditCount}`)
  console.log(`PASS: audit trail confirmed — ${reorderAuditCount} category_nav_reordered rows recorded for parent ${before.parent_id}`)

  // 11. Taxonomy integrity — parent_id/level/path never touched by ANY
  // mutation in this suite (hide/show/label/badge/featured/reorder).
  const after = await queryOneD1(`SELECT id, parent_id, level, path FROM categories WHERE id = ${targetId}`)
  assert.equal(after.parent_id, before.parent_id, 'parent_id must be unchanged')
  assert.equal(after.level, before.level, 'level must be unchanged')
  assert.equal(after.path, before.path, 'path must be unchanged')
  console.log('PASS: taxonomy integrity confirmed — parent_id/level/path all match pre-test values exactly (untouched by any nav-config mutation)')

  // sort_order relative ORDER (not absolute numbers) must match the original
  // — reorderCategoryChildren always writes 0-indexed contiguous values
  // (identical established pattern to reorderHeroCampaigns/
  // reorderCollectionProducts elsewhere in this codebase), so restoring via
  // a reorder call correctly renormalizes to 0-indexed even if the original
  // seed used 1-indexed values. Customer-visible sibling ORDER is what
  // matters, not the absolute integers, exactly like the other two reorder
  // implementations already behave.
  const siblingsRestored = await queryD1(`SELECT id FROM categories WHERE parent_id = ${before.parent_id} AND category_type = 'product' ORDER BY sort_order ASC`)
  assert.deepEqual(siblingsRestored.map((r) => r.id), siblingIds, 'expected sibling RELATIVE order fully restored to original after reorder+restore cycle')
  console.log('PASS: sibling relative navigation order fully restored (reorder normalizes to 0-indexed sort_order, matching the established reorderHeroCampaigns/reorderCollectionProducts pattern — customer-visible order unaffected)')

  // 12. Ecosystem nav config — read + mutate + audit
  const ecoListRes = await admin.client.get('/api/control-center/ecosystem-nav')
  assert.equal(ecoListRes.status, 200)
  assert.equal(ecoListRes.body.results.length, 8, `expected 8 ecosystem verticals, got ${ecoListRes.body.results.length}`)
  console.log('PASS: GET /ecosystem-nav -> 200, 8 verticals (now fully wired to the customer header as of Micro-Checkpoint 2A — see verify-ecosystem-nav-2a.mjs for the dedicated live-toggle proof)')

  const freshVertical = ecoListRes.body.results[0]
  const originalNavVisible = freshVertical.nav_visible
  const ecoPatchRes = await admin.client.patch(`/api/control-center/ecosystem-nav/${freshVertical.id}`, { nav_visible: !originalNavVisible })
  assert.equal(ecoPatchRes.status, 200)
  const ecoAuditCount = await countAuditLogs('ecosystem_nav_updated', 'ecosystem_vertical', String(freshVertical.id))
  assert.ok(ecoAuditCount >= 1, 'expected ecosystem_nav_updated audit row')
  console.log('PASS: ecosystem-nav PATCH persists + audit-logged')
  // restore
  await admin.client.patch(`/api/control-center/ecosystem-nav/${freshVertical.id}`, { nav_visible: originalNavVisible })

  // Cleanup
  await revokeAllControlCenterRoles(support.userId)
  await revokeAllControlCenterRoles(auditor.userId)
  await revokeAllControlCenterRoles(admin.userId)
  const remainingRoles = await queryOneD1(`SELECT COUNT(*) as n FROM cc_user_roles WHERE user_id IN (${support.userId}, ${auditor.userId}, ${admin.userId})`)
  assert.equal(remainingRoles.n, 0, 'expected zero remaining cc_user_roles for test users after cleanup')
  console.log('OK: test users\' CC roles fully revoked')

  const finalTreeNode = findNodeBySlug(await publicTree(), targetSlug)
  assert.ok(finalTreeNode, 'expected target category still visible in public tree after full test cycle')
  assert.equal(finalTreeNode.name, originalTreeNode.name, 'expected category name fully restored to original')
  console.log('OK: public mega-menu tree confirmed restored to original state for the target category')

  await cleanupRunNonce(RUN_NONCE)
  console.log('\n=== ALL CHECKS PASSED ===')
}

main().catch((err) => {
  console.error('\n=== FAILURE ===')
  console.error(err)
  process.exit(1)
})
