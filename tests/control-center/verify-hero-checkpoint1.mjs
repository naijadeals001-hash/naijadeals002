/**
 * Checkpoint 1 live verification script — Hero Campaign Management.
 * Reuses the EXISTING tests/control-center/helpers/client.mjs harness exactly
 * (registerUser via the real /api/auth/register endpoint, grantControlCenterRole
 * via the established test-only D1 fixture pattern). Not a permanent regression
 * suite by itself (no cleanup-on-assert-fail guarantees) — a one-shot manual
 * verification run for this checkpoint's report, executed against the real
 * running dev server.
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
  countAuditLogs,
} from './helpers/client.mjs'

async function main() {
  console.log('--- Checkpoint 1 verification run, nonce', RUN_NONCE, '---')

  // 1. Marketing admin — full CRUD access
  const marketing = await registerUser('marketing')
  await grantControlCenterRole(marketing.userId, 'marketing_admin')
  console.log('OK: registered marketing_admin test user', marketing.userId)

  // 2. Support admin — should get 403 on hero-campaigns (no promotions.* permission)
  const support = await registerUser('support')
  await grantControlCenterRole(support.userId, 'support_admin')
  console.log('OK: registered support_admin test user', support.userId)

  // ---------- 403 test: support_admin has zero promotions.* permission ----------
  const supportRes = await support.client.get('/api/control-center/hero-campaigns')
  assert.equal(supportRes.status, 403, `expected 403 for support_admin, got ${supportRes.status}: ${JSON.stringify(supportRes.body)}`)
  console.log('PASS: support_admin GET /hero-campaigns -> 403 (correctly denied)')

  // ---------- List (marketing_admin, promotions.read) ----------
  const listRes = await marketing.client.get('/api/control-center/hero-campaigns')
  assert.equal(listRes.status, 200, `list failed: ${JSON.stringify(listRes.body)}`)
  assert.ok(Array.isArray(listRes.body.results), 'expected results array')
  const initialCount = listRes.body.results.length
  console.log(`PASS: marketing_admin GET /hero-campaigns -> 200, ${initialCount} campaigns (expect >= 10)`)
  assert.ok(initialCount >= 10, 'expected at least the 10 seeded campaigns')

  // ---------- Image library ----------
  const libRes = await marketing.client.get('/api/control-center/hero-campaigns/image-library')
  assert.equal(libRes.status, 200)
  assert.ok(libRes.body.results.length > 0, 'expected non-empty image library')
  console.log(`PASS: image-library -> 200, ${libRes.body.results.length} images`)

  // ---------- Create ----------
  const slug = `cctest-checkpoint1-${RUN_NONCE}`
  const createRes = await marketing.client.post('/api/control-center/hero-campaigns', {
    slug,
    title: 'Checkpoint 1 Verification Campaign',
    subtitle: 'Created by automated verification script',
    image_desktop_url: '/static/hero/mega-electronics-sale-desktop.jpg',
    image_mobile_url: '/static/hero/mega-electronics-sale-mobile.jpg',
    cta_label: 'Shop now',
    cta_href: '/shop',
    vertical: 'shop',
    theme: 'dark',
    target_countries: ['NG', 'GH'],
    target_segment: 'all',
    target_auth_state: 'all',
  })
  assert.equal(createRes.status, 201, `create failed: ${JSON.stringify(createRes.body)}`)
  const newId = createRes.body.id
  console.log(`PASS: POST /hero-campaigns -> 201, new id ${newId}`)

  // ---------- Verify created row is 'inactive' by design (create != publish) ----------
  const getRes = await marketing.client.get(`/api/control-center/hero-campaigns/${newId}`)
  assert.equal(getRes.status, 200)
  assert.equal(getRes.body.result.status, 'inactive', 'new campaign should default to inactive')
  assert.equal(getRes.body.result.lifecycle_state, 'inactive')
  assert.equal(JSON.parse(getRes.body.result.target_countries).join(','), 'NG,GH')
  console.log('PASS: new campaign created as inactive draft, targeting persisted correctly (NG,GH)')

  // ---------- Verify it does NOT appear in the public homepage feed while inactive ----------
  const homeBefore = await fetch('http://localhost:3000/').then((r) => r.text())
  assert.ok(!homeBefore.includes(slug), 'inactive campaign must not appear on public homepage')
  console.log('PASS: inactive campaign correctly absent from public homepage HTML')

  // ---------- Activate ----------
  const activateRes = await marketing.client.post(`/api/control-center/hero-campaigns/${newId}/status`, { status: 'active' })
  assert.equal(activateRes.status, 200, JSON.stringify(activateRes.body))
  console.log('PASS: POST /hero-campaigns/:id/status {active} -> 200')

  // ---------- Verify cache invalidation worked: homepage now shows 11 campaigns ----------
  const homeAfter = await fetch('http://localhost:3000/').then((r) => r.text())
  const totalMatch = homeAfter.match(/data-total="(\d+)"/)
  console.log(`INFO: homepage data-total after activation = ${totalMatch ? totalMatch[1] : 'NOT FOUND'}`)
  assert.ok(totalMatch && Number(totalMatch[1]) >= 11, 'expected homepage hero count to increase after activation (cache invalidation working)')
  console.log('PASS: cache invalidation confirmed — homepage reflects new active campaign immediately (no 120s TTL wait)')

  // ---------- Audit log check ----------
  const auditCreated = await countAuditLogs('hero_campaign_created', 'hero_campaign', String(newId))
  const auditActivated = await countAuditLogs('hero_campaign_activated', 'hero_campaign', String(newId))
  assert.ok(auditCreated >= 1, 'expected an audit log row for hero_campaign_created')
  assert.ok(auditActivated >= 1, 'expected an audit log row for hero_campaign_activated')
  console.log(`PASS: audit trail confirmed — hero_campaign_created x${auditCreated}, hero_campaign_activated x${auditActivated}`)

  // ---------- Duplicate ----------
  const dupRes = await marketing.client.post(`/api/control-center/hero-campaigns/${newId}/duplicate`)
  assert.equal(dupRes.status, 201, JSON.stringify(dupRes.body))
  const dupId = dupRes.body.id
  const dupCheck = await marketing.client.get(`/api/control-center/hero-campaigns/${dupId}`)
  assert.equal(dupCheck.body.result.slug, `${slug}-copy`)
  assert.equal(dupCheck.body.result.status, 'inactive', 'duplicate should default to inactive')
  console.log(`PASS: duplicate -> 201, new slug ${dupCheck.body.result.slug}, correctly inactive`)

  // ---------- Pause ----------
  const pauseRes = await marketing.client.post(`/api/control-center/hero-campaigns/${newId}/status`, { status: 'inactive' })
  assert.equal(pauseRes.status, 200)
  console.log('PASS: pause -> 200')

  // ---------- Reorder ----------
  const allIds = listRes.body.results.map((r) => r.id).concat([newId, dupId])
  const shuffled = [newId, dupId, ...allIds.filter((id) => id !== newId && id !== dupId)]
  const reorderRes = await marketing.client.post('/api/control-center/hero-campaigns/reorder', { ordered_ids: shuffled })
  assert.equal(reorderRes.status, 200, JSON.stringify(reorderRes.body))
  const afterReorder = await queryOneD1(`SELECT display_order FROM hero_campaigns WHERE id = ${newId}`)
  assert.equal(Number(afterReorder.display_order), 1, 'expected reordered campaign to have display_order 1')
  console.log('PASS: reorder -> 200, display_order persisted correctly')

  // ---------- Archive (soft delete) ----------
  const archiveRes = await marketing.client.post(`/api/control-center/hero-campaigns/${dupId}/archive`)
  assert.equal(archiveRes.status, 200)
  const archivedRow = await queryOneD1(`SELECT is_archived, status FROM hero_campaigns WHERE id = ${dupId}`)
  assert.equal(Number(archivedRow.is_archived), 1)
  assert.equal(archivedRow.status, 'inactive')
  console.log('PASS: archive -> 200, is_archived=1 and status forced to inactive (soft delete confirmed, row NOT hard-deleted)')

  // ---------- Confirm archived campaign excluded from default admin list ----------
  const listDefault = await marketing.client.get('/api/control-center/hero-campaigns')
  const foundInDefault = listDefault.body.results.some((r) => r.id === dupId)
  assert.equal(foundInDefault, false, 'archived campaign must be excluded from default admin list')
  const listWithArchived = await marketing.client.get('/api/control-center/hero-campaigns?include_archived=1')
  const foundInFull = listWithArchived.body.results.some((r) => r.id === dupId)
  assert.equal(foundInFull, true, 'archived campaign must still be visible with include_archived=1')
  console.log('PASS: archived campaign hidden from default list, visible with include_archived=1')

  // ---------- Restore ----------
  const restoreRes = await marketing.client.post(`/api/control-center/hero-campaigns/${dupId}/restore`)
  assert.equal(restoreRes.status, 200)
  const restoredRow = await queryOneD1(`SELECT is_archived FROM hero_campaigns WHERE id = ${dupId}`)
  assert.equal(Number(restoredRow.is_archived), 0)
  console.log('PASS: restore -> 200, is_archived=0')

  // ---------- Validation: duplicate slug rejected ----------
  const dupSlugRes = await marketing.client.post('/api/control-center/hero-campaigns', {
    slug,
    title: 'Should fail',
    image_desktop_url: '/static/hero/mega-electronics-sale-desktop.jpg',
    image_mobile_url: '/static/hero/mega-electronics-sale-mobile.jpg',
    cta_label: 'x', cta_href: '/x', vertical: 'shop',
  })
  assert.equal(dupSlugRes.status, 400)
  console.log('PASS: duplicate-slug create correctly rejected with 400')

  // ---------- Cleanup: archive our test campaigns permanently (soft) + revoke roles ----------
  await marketing.client.post(`/api/control-center/hero-campaigns/${newId}/archive`)
  await marketing.client.post(`/api/control-center/hero-campaigns/${dupId}/archive`)
  await revokeAllControlCenterRoles(marketing.userId)
  await revokeAllControlCenterRoles(support.userId)
  console.log('CLEANUP: test campaigns archived, CC roles revoked from both test users')

  console.log('\n=== ALL CHECKS PASSED ===')
}

main().catch((err) => {
  console.error('\n=== VERIFICATION FAILED ===')
  console.error(err)
  process.exit(1)
})
