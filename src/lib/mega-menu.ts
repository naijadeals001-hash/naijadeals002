import type { CategoryRow } from '../types'

/**
 * Mega-menu tree builder — Phase 1b preview.
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
 */
export interface MegaMenuNode {
  id: number
  slug: string
  name: string
  icon: string
  level: number | null
  country_iso: string | null
  children: MegaMenuNode[]
}

export async function getMegaMenuTree(db: D1Database): Promise<MegaMenuNode[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, name, icon, parent_id, level, country_iso
       FROM categories WHERE category_type = 'product' ORDER BY level ASC, sort_order ASC`
    )
    .all<CategoryRow>()

  const byId = new Map<number, MegaMenuNode>()
  const roots: MegaMenuNode[] = []

  for (const row of results) {
    byId.set(row.id, { id: row.id, slug: row.slug, name: row.name, icon: row.icon, level: row.level, country_iso: row.country_iso, children: [] })
  }
  for (const row of results) {
    const node = byId.get(row.id)!
    if (row.parent_id && byId.has(row.parent_id)) {
      byId.get(row.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}
