/**
 * Generic page-section cache — Stage 2A extraction.
 *
 * WHY THIS EXISTS: homepage-feed.ts already solved "avoid re-running
 * expensive D1 queries on every single request" with a lazy-refresh pattern
 * backed by the homepage_feed_cache table (see that file's header comment
 * for the full CPU-budget rationale — it applies identically here). That
 * table's actual shape (section_key TEXT PRIMARY KEY, payload_json TEXT,
 * generated_at TEXT) was never homepage-specific — homepage-feed.ts just
 * hardcoded a single TTL_SECONDS=120 constant inline, which is wrong for
 * country-profile/facts data that changes far less often than a flash-deals
 * carousel.
 *
 * This module extracts that pattern as a reusable, TTL-parameterized helper
 * against the SAME existing table — deliberately NOT a new table, per
 * Stage 2A's "don't build parallel systems" rule. Section keys are
 * namespaced per caller (e.g. "country_profile:NG", "flash_deals") so one
 * cache serves every page-level cache need in the app without collision.
 *
 * homepage-feed.ts is left untouched (still has its own inline TTL_SECONDS
 * + get/set functions) — refactoring it to use this module is a pure
 * follow-up cleanup, out of scope for Stage 2A, and not required for this
 * unit's country-page caching to work correctly.
 */

export async function getCachedPageSection<T>(db: D1Database, key: string, ttlSeconds: number): Promise<T | null> {
  const row = await db
    .prepare('SELECT payload_json, generated_at FROM homepage_feed_cache WHERE section_key = ?')
    .bind(key)
    .first<{ payload_json: string; generated_at: string }>()
  if (!row) return null
  const ageSeconds = (Date.now() - new Date(row.generated_at + 'Z').getTime()) / 1000
  if (ageSeconds > ttlSeconds) return null
  return JSON.parse(row.payload_json) as T
}

export async function setCachedPageSection(db: D1Database, key: string, data: unknown): Promise<void> {
  await db
    .prepare(
      `INSERT INTO homepage_feed_cache (section_key, payload_json, generated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(section_key) DO UPDATE SET payload_json = excluded.payload_json, generated_at = excluded.generated_at`
    )
    .bind(key, JSON.stringify(data))
    .run()
}

/** Force-expires one cached section — same semantics as homepage-feed.ts's invalidateHomepageFeedSection, generalized to any namespaced key. */
export async function invalidatePageSection(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM homepage_feed_cache WHERE section_key = ?').bind(key).run()
}

/** Invalidates every cached key sharing a namespace prefix, e.g. invalidatePageSectionPrefix(db, 'country_profile:NG') clears just Nigeria's cached sections without touching other countries or homepage sections. */
export async function invalidatePageSectionPrefix(db: D1Database, prefix: string): Promise<void> {
  await db.prepare('DELETE FROM homepage_feed_cache WHERE section_key LIKE ?').bind(`${prefix}%`).run()
}

/** Fetches a section using the cache if fresh, else recomputes via loader and refreshes the cache. */
export async function getOrComputePageSection<T>(db: D1Database, key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const cached = await getCachedPageSection<T>(db, key, ttlSeconds)
  if (cached) return cached
  const fresh = await loader()
  await setCachedPageSection(db, key, fresh)
  return fresh
}
