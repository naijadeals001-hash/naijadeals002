import type { HeroCampaignRow } from '../types'

/**
 * Active hero campaigns, ordered for the carousel. A campaign is eligible when:
 *   - status = 'active' (admin can deactivate without deleting the row/asset), AND
 *   - starts_at is NULL or already in the past (lets merchandising queue a future
 *     promo today without it appearing early), AND
 *   - ends_at is NULL or still in the future (expired campaigns disappear on their
 *     own — no manual cleanup step required).
 * Ordered by display_order ASC (ties broken by id) — the same convention as
 * getTopBrands() in catalog.ts (is_featured/display_order pattern from migration 0006).
 *
 * This function is intentionally NOT called directly from home.tsx per-request.
 * It is registered as a section loader in homepage-feed.ts's SECTION_LOADERS map,
 * so it inherits that module's TTL cache (one D1 query per cache window, not one
 * per visitor) automatically — see homepage-feed.ts for the cache mechanics. Any
 * write via src/lib/hero-campaigns-admin.ts's create/update/status/archive/reorder
 * functions must be paired with homepage-feed.ts's invalidateSection('hero_campaigns')
 * at the route layer so a just-published/paused campaign reflects immediately
 * instead of waiting out the TTL.
 *
 * `is_archived = 0` (migration 0061, Enterprise Control Center Checkpoint 1) is a
 * deliberate belt-and-suspenders clause: the admin's archive action already forces
 * status='inactive' at the same time, so this condition should never independently
 * matter — but the public homepage query must never depend on the admin write path
 * having been implemented perfectly.
 */
export async function getActiveHeroCampaigns(db: D1Database, limit = 12): Promise<HeroCampaignRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, title, subtitle, image_desktop_url, image_mobile_url,
              cta_label, cta_href, vertical, theme, display_order
       FROM hero_campaigns
       WHERE status = 'active'
         AND is_archived = 0
         AND (starts_at IS NULL OR starts_at <= datetime('now'))
         AND (ends_at IS NULL OR ends_at > datetime('now'))
       ORDER BY display_order ASC, id ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<HeroCampaignRow>()
  return results
}
