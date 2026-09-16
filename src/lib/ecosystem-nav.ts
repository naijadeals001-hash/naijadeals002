/**
 * Micro-Checkpoint 2A — customer-facing Ecosystem Navigation, DB-backed.
 *
 * Closes the gap Pat flagged at the end of Checkpoint 2: `ecosystem_verticals.
 * nav_visible` (migration 0062) and its Control Center admin surface
 * (getEcosystemNavConfigForAdmin/updateEcosystemNavConfig in
 * category-nav-admin.ts) were REAL, but Layout.tsx's header pills were still
 * a hardcoded ECOSYSTEM_LINKS array — so an admin's toggle had zero effect on
 * what a customer actually saw. This module is the missing link:
 *
 *   ecosystem_verticals (DB)
 *     -> getEcosystemNavLinks() (this file, cached)
 *     -> Layout.tsx (async component, reads via useRequestContext())
 *     -> customer-facing header (desktop pill strip + mobile scroller + mobile drawer)
 *
 * CACHING: reuses the EXISTING `homepage_feed_cache` table and TTL pattern
 * from src/lib/homepage-feed.ts (same table, same 120s TTL, same lazy-refresh
 * shape) rather than inventing a second configuration/cache system — the
 * table is a generic `section_key -> payload_json` store, not homepage-only,
 * and this is a distinct section_key ('ecosystem_nav_header') alongside
 * 'shop_by_category' etc. Layout.tsx renders on EVERY page (not just the
 * homepage), so this is intentionally its own small read path rather than
 * being folded into getHomepageFeed()'s Promise.all (which home.tsx alone
 * calls) — but it deliberately shares storage + invalidation mechanics with
 * that module so there is exactly one caching pattern in this codebase, not
 * two.
 *
 * NaijaShop (/shop) is NOT a row in ecosystem_verticals — it IS the core
 * marketplace this whole app is built around, not a "vertical" that can be
 * hidden or reordered by this admin surface. It stays a pinned, always-live,
 * always-first entry, exactly as it always has been; only the 8 OTHER
 * verticals (Fresh/Eats/Gigs/Stay/Drive/Send/Stream/Aura) are DB-driven here.
 */

const TTL_SECONDS = 120 // matches homepage-feed.ts's TTL exactly — same cache table, same freshness contract
const CACHE_KEY = 'ecosystem_nav_header'

export interface EcosystemNavLink {
  href: string
  label: string
  icon: string
  live: boolean
}

/** The one entry that is NOT DB-driven — see file header. Always first, always live. */
const SHOP_PILL: EcosystemNavLink = { href: '/shop', label: 'NaijaShop', icon: 'storefront', live: true }

async function loadEcosystemNavLinksFromDb(db: D1Database): Promise<EcosystemNavLink[]> {
  const { results } = await db
    .prepare(
      `SELECT route, name, icon, status FROM ecosystem_verticals WHERE nav_visible = 1 ORDER BY display_order ASC, id ASC`
    )
    .all<{ route: string; name: string; icon: string; status: string }>()
  const dbLinks: EcosystemNavLink[] = results.map((r) => ({
    href: r.route,
    label: r.name,
    icon: r.icon,
    live: r.status === 'live',
  }))
  return [SHOP_PILL, ...dbLinks]
}

async function getCached(db: D1Database): Promise<EcosystemNavLink[] | null> {
  const row = await db
    .prepare('SELECT payload_json, generated_at FROM homepage_feed_cache WHERE section_key = ?')
    .bind(CACHE_KEY)
    .first<{ payload_json: string; generated_at: string }>()
  if (!row) return null
  const ageSeconds = (Date.now() - new Date(row.generated_at + 'Z').getTime()) / 1000
  if (ageSeconds > TTL_SECONDS) return null
  return JSON.parse(row.payload_json) as EcosystemNavLink[]
}

async function setCached(db: D1Database, data: EcosystemNavLink[]) {
  await db
    .prepare(
      `INSERT INTO homepage_feed_cache (section_key, payload_json, generated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(section_key) DO UPDATE SET payload_json = excluded.payload_json, generated_at = excluded.generated_at`
    )
    .bind(CACHE_KEY, JSON.stringify(data))
    .run()
}

/**
 * Returns the customer-facing ecosystem nav pills, cache-first. This is what
 * Layout.tsx calls on every page render — one indexed PK lookup on a cache
 * hit (well within the Workers per-request CPU budget), a handful of rows
 * from ecosystem_verticals only once per TTL_SECONDS window on a miss.
 */
export async function getEcosystemNavLinks(db: D1Database): Promise<EcosystemNavLink[]> {
  const cached = await getCached(db)
  if (cached) return cached
  const fresh = await loadEcosystemNavLinksFromDb(db)
  await setCached(db, fresh)
  return fresh
}

/**
 * Force-expires the cached header nav immediately — the Control Center's
 * `PATCH /api/control-center/ecosystem-nav/:id` MUST call this after every
 * write, exactly mirroring invalidateHomepageFeedSection's contract, so a
 * customer sees the effect of an admin's visibility toggle on their very
 * next page load instead of waiting out the TTL window.
 */
export async function invalidateEcosystemNavCache(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM homepage_feed_cache WHERE section_key = ?').bind(CACHE_KEY).run()
}
