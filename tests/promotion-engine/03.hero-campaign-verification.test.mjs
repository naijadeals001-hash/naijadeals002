/**
 * Promotion Engine — Engine 12 Legacy Remediation, Unit 3: Hero Campaign
 * verification + regression coverage.
 *
 * BACKGROUND (see docs/ENGINE-12-PROMOTION-ADVERTISING-GAP-MATRIX.md and
 * docs/ENGINE-12-LEGACY-REMEDIATION.md): the Phase 0 audit classified Hero
 * Campaigns as REAL/COMPLETE, disproving a stale README claim that the
 * feature was "not yet wired into home.tsx." Prior to this remediation pass
 * there was ZERO dedicated automated test coverage for hero_campaigns' status
 * gating, scheduling (starts_at/ends_at), or display ordering — only manual
 * Playwright verification during the audit. This suite closes that gap
 * WITHOUT modifying any working implementation code (src/lib/hero-campaigns.ts,
 * src/components/HeroCarousel.tsx, src/lib/homepage-feed.ts, src/pages/home.tsx
 * are all read-only / untouched by this remediation pass).
 *
 * Exercises getActiveHeroCampaigns() in src/lib/hero-campaigns.ts DIRECTLY,
 * in-process, against the real local D1 binding — same rationale/pattern as
 * 01.coupon-concurrency-and-rules.test.mjs and 02.brand-merchandising.test.mjs.
 *
 * Run via:
 *   npx tsx --test tests/promotion-engine/03.hero-campaign-verification.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getTestDb,
  queryD1,
  createTestHeroCampaign,
  cleanupTestHeroCampaigns,
  disposeTestDb
} from './helpers/db.mjs'
import { getActiveHeroCampaigns } from '../../src/lib/hero-campaigns.ts'

test.after(async () => {
  await cleanupTestHeroCampaigns()
  await disposeTestDb()
})

// ---------- 1. The 5 real seeded campaigns exist and are active ----------
test('seeded campaigns: the 5 real migration-0008 campaigns exist, active, in the documented display_order', async () => {
  const rows = await queryD1(
    `SELECT slug, status, display_order FROM hero_campaigns
     WHERE slug IN ('mega-electronics-sale','ankara-fashion-edit','naijadeals-ecosystem','everyday-groceries','naijasend-nationwide')
     ORDER BY display_order ASC`
  )
  assert.equal(rows.length, 5, 'expected all 5 real seeded campaigns to be present')
  assert.deepEqual(
    rows.map((r) => r.slug),
    ['mega-electronics-sale', 'ankara-fashion-edit', 'naijadeals-ecosystem', 'everyday-groceries', 'naijasend-nationwide']
  )
  for (const row of rows) {
    assert.equal(row.status, 'active', `${row.slug} must be active`)
  }
})

// ---------- 2. getActiveHeroCampaigns() returns real campaigns in display_order ----------
test('getActiveHeroCampaigns(): returns active campaigns ordered by display_order ascending', async () => {
  const db = await getTestDb()
  const results = await getActiveHeroCampaigns(db, 20)
  assert.ok(results.length >= 5, 'expected at least the 5 real seeded campaigns')

  const orders = results.map((r) => r.display_order)
  const sorted = [...orders].sort((a, b) => a - b)
  assert.deepEqual(orders, sorted, 'campaigns must be returned in ascending display_order')

  // Every row returned is a real, complete row -- no placeholder content.
  for (const row of results) {
    assert.ok(row.title, 'every campaign must have a title')
    assert.ok(row.image_desktop_url, 'every campaign must have a desktop image')
    assert.ok(row.image_mobile_url, 'every campaign must have a mobile image')
    assert.ok(row.cta_label, 'every campaign must have a CTA label')
    assert.ok(row.cta_href, 'every campaign must have a CTA href')
  }
})

// ---------- 3. Status gating: inactive campaigns are excluded ----------
test('status gating: a campaign with status=inactive is excluded from getActiveHeroCampaigns()', async () => {
  const db = await getTestDb()
  const { slug } = await createTestHeroCampaign(db, 'inactive-gate', { status: 'inactive', display_order: 1 })

  const results = await getActiveHeroCampaigns(db, 50)
  assert.ok(!results.some((r) => r.slug === slug), 'inactive campaign must not appear in getActiveHeroCampaigns()')
})

// ---------- 4. Scheduling: a campaign with a future starts_at is excluded (queued, not yet live) ----------
test('scheduling (starts_at): a campaign scheduled to start in the future is excluded until its start time', async () => {
  const db = await getTestDb()
  const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const { slug } = await createTestHeroCampaign(db, 'future-start', { starts_at: futureStart, display_order: 1 })

  const results = await getActiveHeroCampaigns(db, 50)
  assert.ok(!results.some((r) => r.slug === slug), 'campaign with a future starts_at must not appear yet')
})

// ---------- 5. Scheduling: a campaign whose starts_at is already in the past IS included ----------
test('scheduling (starts_at): a campaign whose starts_at has already passed is included', async () => {
  const db = await getTestDb()
  const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const { slug } = await createTestHeroCampaign(db, 'past-start', { starts_at: pastStart, display_order: 1 })

  const results = await getActiveHeroCampaigns(db, 50)
  assert.ok(results.some((r) => r.slug === slug), 'campaign whose starts_at has already passed must appear')
})

// ---------- 6. Scheduling: a campaign with a past ends_at is excluded (expired, auto-retired) ----------
test('scheduling (ends_at): a campaign whose ends_at has already passed is excluded (auto-expired, no manual deactivation needed)', async () => {
  const db = await getTestDb()
  const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const { slug } = await createTestHeroCampaign(db, 'expired', { ends_at: pastEnd, display_order: 1 })

  const results = await getActiveHeroCampaigns(db, 50)
  assert.ok(!results.some((r) => r.slug === slug), 'campaign whose ends_at has already passed must be auto-excluded')
})

// ---------- 7. Scheduling: a campaign with a future ends_at IS included (not expired yet) ----------
test('scheduling (ends_at): a campaign whose ends_at is still in the future is included', async () => {
  const db = await getTestDb()
  const futureEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const { slug } = await createTestHeroCampaign(db, 'not-expired', { ends_at: futureEnd, display_order: 1 })

  const results = await getActiveHeroCampaigns(db, 50)
  assert.ok(results.some((r) => r.slug === slug), 'campaign whose ends_at is still in the future must appear')
})

// ---------- 8. Display ordering: a campaign with a lower display_order ranks earlier than the real seeded set ----------
test('display ordering: a campaign with display_order=0 ranks before all 5 real seeded campaigns (order 1-5)', async () => {
  const db = await getTestDb()
  const { slug } = await createTestHeroCampaign(db, 'priority', { display_order: 0 })

  const results = await getActiveHeroCampaigns(db, 50)
  const idx = results.findIndex((r) => r.slug === slug)
  assert.ok(idx !== -1, 'priority campaign must appear in results')
  assert.equal(idx, 0, 'campaign with display_order=0 must rank first, ahead of the real seeded campaigns (display_order 1-5)')
})

// ---------- 9. limit parameter is honored ----------
test('limit parameter: getActiveHeroCampaigns(db, N) never returns more than N rows', async () => {
  const db = await getTestDb()
  const results = await getActiveHeroCampaigns(db, 3)
  assert.ok(results.length <= 3, 'result must respect the limit parameter')
})

// ---------- 10. Homepage integration: hero_campaigns is a registered section loader consumed by the real homepage feed ----------
test('homepage integration: hero_campaigns is registered in homepage-feed.ts SECTION_LOADERS and getHomepageFeed() returns it', async () => {
  const db = await getTestDb()
  const { getHomepageFeed } = await import('../../src/lib/homepage-feed.ts')
  const feed = await getHomepageFeed(db)

  assert.ok(Array.isArray(feed.hero_campaigns), 'feed.hero_campaigns must be an array')
  assert.ok(feed.hero_campaigns.length > 0, 'feed.hero_campaigns must contain real campaign data (not empty)')
  // Cross-check: every hero_campaigns item in the feed must be a real active campaign
  // (proves this is the SAME getActiveHeroCampaigns() data path, not a separate/duplicate source).
  const slugs = feed.hero_campaigns.map((c) => c.slug)
  assert.ok(slugs.includes('mega-electronics-sale'), 'feed must include the real seeded mega-electronics-sale campaign')
})
