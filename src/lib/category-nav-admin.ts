import type { CategoryRow } from '../types'

/**
 * Enterprise Control Center — Category / Mega-Menu navigation management
 * service layer (Checkpoint 2, Pat's Phase 2 directive, 2026-09-16).
 *
 * ARCHITECTURE (per Pat's mandated pattern, proven out in Checkpoint 1):
 *   DATABASE (categories, unchanged taxonomy + 3 new nav columns)
 *     -> SERVICE (this file)
 *     -> API (src/routes/api-control-center.ts, new /categories/* routes)
 *     -> ENTERPRISE CONTROL CENTER (src/routes/control-center.tsx, /categories)
 *     -> CUSTOMER-FACING EXPERIENCE (src/lib/mega-menu.ts's getMegaMenuTree,
 *        UNCHANGED call sites in api-catalog.ts / app.js's initMegaMenu())
 *
 * THIS MODULE DOES NOT REBUILD THE MEGA-MENU. getMegaMenuTree() itself is
 * modified minimally (adds an is_visible filter + label/badge passthrough)
 * in src/lib/mega-menu.ts — not here, and not replaced. This module only
 * provides the ADMIN read/write surface: list the full tree (including
 * hidden nodes, for editing), and mutate the 5 navigation-config fields a
 * Category Manager admin is allowed to touch:
 *   is_visible, sort_order (nav order — REUSED, not duplicated),
 *   is_featured_home + homepage_priority (REUSED, not duplicated),
 *   nav_label_override, nav_badge.
 *
 * Everything else on a category row (slug, name, parent_id, level, path,
 * category_type, country_iso, icon, image_url) is read-only from this
 * module's perspective — taxonomy structure is not something a nav-config
 * screen should be able to silently corrupt. Renaming a category, moving
 * it in the tree, or changing its country scope is explicitly OUT of
 * scope for Checkpoint 2 (per Pat's "preserve the hierarchical taxonomy"
 * instruction) and is not exposed by any function below.
 */

export interface CategoryNavAdminRow extends CategoryRow {
  is_visible: number
  nav_label_override: string | null
  nav_badge: string | null
  is_featured_home: number
  homepage_priority: number | null
  /**
   * Checkpoint 3 — Header Category Pill Navigation (migration 0063).
   * DELIBERATELY INDEPENDENT of is_visible/is_featured_home: a category can
   * be in the mega-menu but not a header pill, a pill but not featured on
   * the homepage, etc. — three separate curation lenses over the one tree,
   * per Pat's explicit "do not reuse" instruction.
   */
  nav_pill_visible: number
  nav_pill_order: number | null
  /** Live product count (any depth via materialized path) — real signal, shown in the admin table so an operator can see whether hiding/demoting a category actually affects anything. Never used to gate visibility itself. */
  product_count: number
}

/**
 * Full category tree for the ADMIN view — every row regardless of
 * is_visible (an admin must be able to find and re-show a hidden category),
 * annotated with a live per-branch product count. Ordered by level then
 * sort_order, matching getMegaMenuTree()'s own ordering exactly so the
 * admin table's default order matches what customers would see if
 * everything were visible.
 */
export async function getCategoryNavTreeForAdmin(db: D1Database): Promise<CategoryNavAdminRow[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM products p WHERE p.is_active = 1 AND
                 (p.category_id = c.id OR EXISTS (
                    SELECT 1 FROM categories d WHERE d.id = p.category_id
                      AND d.path LIKE (COALESCE(c.path, CAST(c.id AS TEXT)) || '/%')
                 ))
              ) as product_count
       FROM categories c
       WHERE c.category_type = 'product'
       ORDER BY c.level ASC, c.sort_order ASC`
    )
    .all<CategoryNavAdminRow>()
  return results
}

export interface CategoryNavUpdateInput {
  is_visible?: boolean
  sort_order?: number
  is_featured_home?: boolean
  homepage_priority?: number | null
  nav_label_override?: string | null
  nav_badge?: string | null
  nav_pill_visible?: boolean
  nav_pill_order?: number | null
}

const ALLOWED_FIELDS = new Set([
  'is_visible', 'sort_order', 'is_featured_home', 'homepage_priority', 'nav_label_override', 'nav_badge',
  'nav_pill_visible', 'nav_pill_order',
])

/**
 * Updates ONLY the navigation-config fields for one category. Deliberately
 * whitelists columns via ALLOWED_FIELDS rather than spreading an arbitrary
 * body — slug/name/parent_id/level/path/category_type/country_iso/icon/
 * image_url can never be reached through this function, by construction,
 * even if a caller's input object accidentally contained them.
 */
export async function updateCategoryNavConfig(
  db: D1Database,
  categoryId: number,
  input: CategoryNavUpdateInput
): Promise<CategoryNavAdminRow | null> {
  const existing = await db.prepare(`SELECT * FROM categories WHERE id = ? AND category_type = 'product'`).bind(categoryId).first<CategoryRow>()
  if (!existing) return null

  const fields: string[] = []
  const binds: unknown[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (!ALLOWED_FIELDS.has(key)) continue // defense-in-depth: never reachable via the typed input, but explicit anyway
    fields.push(`${key} = ?`)
    binds.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
  }
  if (fields.length === 0) {
    return getCategoryNavTreeForAdmin(db).then((rows) => rows.find((r) => r.id === categoryId) ?? null)
  }

  await db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).bind(...binds, categoryId).run()
  const rows = await getCategoryNavTreeForAdmin(db)
  return rows.find((r) => r.id === categoryId) ?? null
}

/**
 * Batch reorder — full replace of sort_order within ONE parent's direct
 * children (mirrors reorderCollectionProducts/reorderHeroCampaigns'
 * proven shape from Checkpoints 0/1). Scoping to a single parent_id in
 * the WHERE clause means a caller can never accidentally reorder
 * categories across different branches of the tree in one call.
 */
export async function reorderCategoryChildren(db: D1Database, parentId: number | null, orderedIds: number[]): Promise<void> {
  const statements = orderedIds.map((id, index) =>
    parentId === null
      ? db.prepare(`UPDATE categories SET sort_order = ? WHERE id = ? AND parent_id IS NULL AND category_type = 'product'`).bind(index, id)
      : db.prepare(`UPDATE categories SET sort_order = ? WHERE id = ? AND parent_id = ? AND category_type = 'product'`).bind(index, id, parentId)
  )
  if (statements.length > 0) await db.batch(statements)
}

/**
 * Checkpoint 3 — full replace of nav_pill_order across the ENTIRE curated
 * pill set (not scoped to one parent, unlike reorderCategoryChildren above)
 * — pills are intentionally MIXED-depth (a level-1 department can sit next
 * to a level-2 subcategory in the same strip), so there is no single parent
 * to scope a reorder to. Only rows already flagged nav_pill_visible=1 are
 * ever touched by this — a category not currently a pill can never be
 * silently reordered into pill position by this function.
 */
export async function reorderCategoryPills(db: D1Database, orderedIds: number[]): Promise<void> {
  const statements = orderedIds.map((id, index) =>
    db.prepare(`UPDATE categories SET nav_pill_order = ? WHERE id = ? AND nav_pill_visible = 1 AND category_type = 'product'`).bind(index, id)
  )
  if (statements.length > 0) await db.batch(statements)
}

/**
 * Ecosystem vertical navigation config — Micro-Checkpoint 2A: FULLY WIRED
 * to the customer-facing header. Reads/writes ecosystem_verticals' existing
 * columns (status, display_order, icon, name, route) plus the nav_visible
 * column added in migration 0062. Layout.tsx (now an async component) calls
 * getEcosystemNavLinks() (src/lib/ecosystem-nav.ts) on every request, which
 * reads these exact same columns — so an admin toggle made through this
 * module's updateEcosystemNavConfig() is what a customer's browser actually
 * renders, not a parallel/disconnected configuration surface.
 */
export interface EcosystemNavAdminRow {
  id: number
  slug: string
  route: string
  name: string
  icon: string
  status: string
  display_order: number
  nav_visible: number
}

export async function getEcosystemNavConfigForAdmin(db: D1Database): Promise<EcosystemNavAdminRow[]> {
  const { results } = await db
    .prepare(`SELECT id, slug, route, name, icon, status, display_order, nav_visible FROM ecosystem_verticals ORDER BY display_order ASC, id ASC`)
    .all<EcosystemNavAdminRow>()
  return results
}

export interface EcosystemNavUpdateInput {
  nav_visible?: boolean
  display_order?: number
}

export async function updateEcosystemNavConfig(db: D1Database, verticalId: number, input: EcosystemNavUpdateInput): Promise<boolean> {
  const fields: string[] = []
  const binds: unknown[] = []
  if (input.nav_visible !== undefined) { fields.push('nav_visible = ?'); binds.push(input.nav_visible ? 1 : 0) }
  if (input.display_order !== undefined) { fields.push('display_order = ?'); binds.push(input.display_order) }
  if (fields.length === 0) return true
  fields.push(`updated_at = datetime('now')`)
  const result = await db.prepare(`UPDATE ecosystem_verticals SET ${fields.join(', ')} WHERE id = ?`).bind(...binds, verticalId).run()
  return (result.meta.rows_written ?? 0) > 0
}
