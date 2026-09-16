/**
 * Header Category Pill Navigation — Checkpoint 3 (Pat's directive, 2026-09-16).
 *
 * ARCHITECTURE (per Pat's locked-in A1/B/C decisions):
 *   categories (ONE taxonomy, any depth)
 *     -> nav_pill_visible / nav_pill_order  (migration 0063, genuinely new
 *        columns — NOT is_visible, NOT is_featured_home/homepage_priority.
 *        Those three mechanisms — mega-menu, header pills, homepage rails —
 *        are deliberately independent views over the same tree, so a
 *        toggle in one never has a side effect on another.)
 *     -> nav_label_override / nav_badge     (migration 0062, REUSED as-is —
 *        one label/badge concept per category, shared by mega-menu + pill,
 *        never two competing override fields.)
 *     -> getCategoryPillNav(db) (this file, cache-backed)
 *     -> Layout.tsx (desktop pill strip + mobile scroller + mobile drawer —
 *        all three consume the exact same result, per Pat's explicit "no
 *        separate mobile category data source" instruction.)
 *
 * DESTINATION URLs: every pill links to `/shop?category=<slug>` — NEVER a
 * hardcoded path. shop.tsx already resolves this at ANY taxonomy depth via
 * the materialized `path` column (migration 0053): clicking a level-1
 * department (e.g. Electronics) or a level-2 subcategory (e.g. Phones &
 * Tablets) both work identically, with zero special-casing needed here.
 *
 * CACHE: reuses the EXISTING homepage_feed_cache table (same generic
 * section_key -> payload_json store used by ecosystem-nav.ts and
 * homepage-feed.ts) under section_key='category_pill_nav_header' — NOT a
 * new cache system, per Pat's explicit instruction.
 */

const TTL_SECONDS = 120
const CACHE_KEY = 'category_pill_nav_header'

export interface CategoryPillLink {
  id: number
  slug: string
  /** Effective display label: nav_label_override if an admin set one, otherwise the category's real `name` — never both, never fabricated. */
  label: string
  icon: string
  /** Always `/shop?category=<slug>` — resolved at read time, never stored. */
  href: string
  /** Admin-set badge (e.g. "New", "Hot") — null unless explicitly set. Reuses categories.nav_badge (migration 0062), same field the mega-menu uses. */
  badge: string | null
  level: number | null
}

interface CategoryPillSourceRow {
  id: number
  slug: string
  name: string
  icon: string
  nav_label_override: string | null
  nav_badge: string | null
  level: number | null
}

async function loadCategoryPillsFromDb(db: D1Database): Promise<CategoryPillLink[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, name, icon, nav_label_override, nav_badge, level
       FROM categories
       WHERE nav_pill_visible = 1 AND category_type = 'product'
       ORDER BY nav_pill_order ASC, id ASC`
    )
    .all<CategoryPillSourceRow>()
  return results.map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.nav_label_override || r.name,
    icon: r.icon,
    href: `/shop?category=${encodeURIComponent(r.slug)}`,
    badge: r.nav_badge || null,
    level: r.level,
  }))
}

async function getCached(db: D1Database): Promise<CategoryPillLink[] | null> {
  const row = await db
    .prepare(`SELECT payload_json, generated_at FROM homepage_feed_cache WHERE section_key = ?`)
    .bind(CACHE_KEY)
    .first<{ payload_json: string; generated_at: string }>()
  if (!row) return null
  const ageSeconds = (Date.now() - new Date(row.generated_at + 'Z').getTime()) / 1000
  if (ageSeconds > TTL_SECONDS) return null
  try {
    return JSON.parse(row.payload_json) as CategoryPillLink[]
  } catch {
    return null
  }
}

async function setCached(db: D1Database, data: CategoryPillLink[]): Promise<void> {
  await db
    .prepare(
      `INSERT INTO homepage_feed_cache (section_key, payload_json, generated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(section_key) DO UPDATE SET payload_json = excluded.payload_json, generated_at = excluded.generated_at`
    )
    .bind(CACHE_KEY, JSON.stringify(data))
    .run()
}

export async function getCategoryPillNav(db: D1Database): Promise<CategoryPillLink[]> {
  const cached = await getCached(db)
  if (cached) return cached
  const fresh = await loadCategoryPillsFromDb(db)
  await setCached(db, fresh)
  return fresh
}

/** Called by the CC's PATCH/reorder routes whenever a pill-affecting field changes (visibility, order, label, badge) — mirrors invalidateEcosystemNavCache's exact contract. */
export async function invalidateCategoryPillNavCache(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM homepage_feed_cache WHERE section_key = ?').bind(CACHE_KEY).run()
}
