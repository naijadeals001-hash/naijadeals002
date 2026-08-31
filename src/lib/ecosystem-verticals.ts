import type { EcosystemVerticalRow, EcosystemVerticalFeatureRow } from '../types'

/**
 * Data access for the Ecosystem Preview system (migration 0010_ecosystem_verticals.sql).
 *
 * WHY THIS EXISTS: the global header/footer ecosystem nav (Layout.tsx's
 * ECOSYSTEM_LINKS) links to /fresh, /eats, /gigs, /stay, /drive, /send,
 * /stream, /aura — routes that previously 404'd because no page existed for
 * them. Rather than 8 hand-written pages, every one of those routes is
 * served by ONE handler (src/pages/ecosystem-preview.tsx) driven by ONE
 * component (src/components/EcosystemPreview.tsx), both fed by this module.
 * Adding a 9th vertical, or flipping an existing one from COMING_SOON to
 * LIVE, is a data change here — never a new page.
 */

/** Fetches a single vertical by its route (e.g. '/fresh'). Returns null if the route isn't configured — the caller (ecosystemPreviewPage) treats that as a genuine 404, so an unconfigured route never silently renders a blank preview. */
export async function getVerticalByRoute(db: D1Database, route: string): Promise<EcosystemVerticalRow | null> {
  const row = await db
    .prepare(
      `SELECT id, slug, route, name, tagline, description, icon, accent_color,
              hero_image_desktop, hero_image_mobile, status, cta_label,
              seo_title, seo_description, display_order
       FROM ecosystem_verticals
       WHERE route = ?`
    )
    .bind(route)
    .first<EcosystemVerticalRow>()
  return row ?? null
}

/** Every configured vertical, ordered for nav/overview rendering (e.g. the /ecosystem page). */
export async function getAllVerticals(db: D1Database): Promise<EcosystemVerticalRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, route, name, tagline, description, icon, accent_color,
              hero_image_desktop, hero_image_mobile, status, cta_label,
              seo_title, seo_description, display_order
       FROM ecosystem_verticals
       ORDER BY display_order ASC, id ASC`
    )
    .all<EcosystemVerticalRow>()
  return results
}

/** Planned feature cards for one vertical, in display order. */
export async function getFeaturesForVertical(db: D1Database, verticalId: number): Promise<EcosystemVerticalFeatureRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, vertical_id, icon, title, description, display_order
       FROM ecosystem_vertical_features
       WHERE vertical_id = ?
       ORDER BY display_order ASC, id ASC`
    )
    .bind(verticalId)
    .all<EcosystemVerticalFeatureRow>()
  return results
}

/**
 * Records a waitlist signup for a specific vertical. Idempotent per
 * (vertical_id, email) — re-submitting the same email for the same vertical
 * is a no-op, not a duplicate row or an error, so the API can always report
 * success without leaking whether the email was already on the list.
 */
export async function addToVerticalWaitlist(db: D1Database, verticalId: number, email: string, userId: number | null): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO ecosystem_waitlist (vertical_id, email, user_id) VALUES (?, ?, ?)')
    .bind(verticalId, email, userId)
    .run()
}
