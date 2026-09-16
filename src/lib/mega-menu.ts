import type { CategoryRow } from '../types'

/**
 * Mega-menu tree builder — Phase 1b preview, extended for Checkpoint 2
 * (Pat's Category / Mega-Menu Enterprise Control Center directive,
 * 2026-09-16) to consume the new Control-Center-writable nav columns
 * (is_visible, nav_label_override, nav_badge — migration 0062) WITHOUT
 * rebuilding, replacing, or changing the shape of this function's output
 * or call sites. getMegaMenuTree() is still the sole data source for
 * GET /api/catalog/categories/tree, still consumed unchanged by app.js's
 * initMegaMenu() (desktop flyout + mobile accordion) — this is an
 * additive, minimal change per Pat's explicit "DO NOT REBUILD/REPLACE"
 * instruction.
 *
 * Reuses the EXACT category rows already served by
 * catalogApi's `/api/catalog/categories` (category_type='product', all
 * levels, via the migration-0053 materialized path/level columns) — no new
 * table, no duplicated taxonomy. This module's only job is turning that
 * flat row list into a nested tree the mega-menu component can render as
 * Department -> Group -> Subcategory -> Leaf columns, with African/
 * country-specific nodes appearing IN-LINE wherever they sit in the real
 * tree (never a separate "Africa" system) — see migration 0053 header
 * comment for why country_iso lives on the category row itself.
 *
 * VISIBILITY SEMANTICS (new, Checkpoint 2): hiding a category via the
 * Control Center hides its ENTIRE subtree from the customer-facing menu —
 * a hidden department's children never get silently promoted to root.
 * This matches how navigation visibility works everywhere else in this
 * codebase (e.g. an inactive product's listing never independently
 * resurfaces) and avoids a confusing "orphaned category floating at the
 * top level" bug. The underlying taxonomy rows (parent_id/level/path) are
 * completely untouched by hiding — this is purely a presentation filter
 * applied after the full tree is built, so re-showing a category later
 * instantly restores its exact original position with zero data loss.
 */
export interface MegaMenuNode {
  id: number
  slug: string
  /** Effective display name: nav_label_override if an admin set one, otherwise the category's real `name` — never both shown, never fabricated. */
  name: string
  icon: string
  level: number | null
  country_iso: string | null
  /** Admin-set nav badge (e.g. "New", "Hot") — null unless an admin explicitly typed one. Never auto-derived or invented. */
  badge: string | null
  children: MegaMenuNode[]
}

interface MegaMenuSourceRow extends CategoryRow {
  is_visible: number
  nav_label_override: string | null
  nav_badge: string | null
}

export async function getMegaMenuTree(db: D1Database): Promise<MegaMenuNode[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, name, icon, parent_id, level, country_iso, is_visible, nav_label_override, nav_badge
       FROM categories WHERE category_type = 'product' ORDER BY level ASC, sort_order ASC`
    )
    .all<MegaMenuSourceRow>()

  // Pass 1: build the FULL tree (including invisible nodes) so parent/child
  // relationships are resolved correctly regardless of visibility state.
  const byId = new Map<number, MegaMenuNode & { _visible: boolean }>()
  const roots: (MegaMenuNode & { _visible: boolean })[] = []

  for (const row of results) {
    byId.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: row.nav_label_override || row.name,
      icon: row.icon,
      level: row.level,
      country_iso: row.country_iso,
      badge: row.nav_badge || null,
      children: [],
      _visible: row.is_visible !== 0,
    })
  }
  for (const row of results) {
    const node = byId.get(row.id)!
    if (row.parent_id && byId.has(row.parent_id)) {
      byId.get(row.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Pass 2: prune invisible nodes AND their entire subtree (a hidden
  // department hides everything beneath it — see doc comment above).
  function pruneHidden(nodes: (MegaMenuNode & { _visible: boolean })[]): MegaMenuNode[] {
    const visible: MegaMenuNode[] = []
    for (const node of nodes) {
      if (!node._visible) continue
      const { _visible, ...rest } = node
      rest.children = pruneHidden(node.children as (MegaMenuNode & { _visible: boolean })[])
      visible.push(rest)
    }
    return visible
  }

  return pruneHidden(roots)
}
