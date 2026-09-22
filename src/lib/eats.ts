/**
 * NaijaEats — data layer (migrations 0078-0081 foundation).
 *
 * Modeled directly on src/lib/fresh.ts's structure (exported constants,
 * a shared base SELECT template, exported async query functions, a
 * filters/result interface pair, label lookup objects) — NOT a copy of
 * Fresh's product/listing engine, since NaijaEats has its OWN dedicated
 * schema (restaurants/cuisines/dishes/menus/menu_sections/menu_items/
 * menu_item_option_groups/menu_item_options, confirmed via direct
 * `sqlite_master` inspection this session — see migrations 0078-0081).
 *
 * Image resolution rule (critical, verified this session): ALL 38 seeded
 * menu_items.image_url values are NULL — every seeded dish photo lives on
 * dishes.image_url instead, reached via menu_items.dish_id. Every SELECT
 * below therefore projects `COALESCE(mi.image_url, d.image_url) AS
 * resolved_image_url` rather than reading menu_items.image_url directly —
 * reading it directly would render a broken image for all 38 seed items.
 *
 * No fabricated data anywhere in this file: every column comes straight
 * from the real schema; there are no hardcoded restaurant/dish lists.
 */
import type { RestaurantRow, MenuItemRow, MenuSectionRow, CuisineRow, MenuItemOptionGroupRow, MenuItemOptionRow } from '../types'

/** Restaurant card select — the buy-box-equivalent join for a restaurant tile on /eats and /eats/restaurants. Only ever surfaces active, seed/live rows (is_active=1) — never a disabled restaurant. */
const RESTAURANT_CARD_SELECT = `
  SELECT r.*, c.name AS cuisine_name, c.slug AS cuisine_slug
  FROM restaurants r
  JOIN cuisines c ON c.id = r.cuisine_id
  WHERE r.is_active = 1
`

/** Menu item select with the dish-image-fallback join described in this file's header comment. Scoped to available items only by default — callers that need unavailable items too (e.g. a restaurant owner's own menu editor, out of scope for Phase 1) would need a separate query. */
const MENU_ITEM_SELECT = `
  SELECT mi.*, d.image_url AS dish_image_url, ms.name AS section_name,
         COALESCE(mi.image_url, d.image_url) AS resolved_image_url
  FROM menu_items mi
  JOIN menu_sections ms ON ms.id = mi.menu_section_id
  LEFT JOIN dishes d ON d.id = mi.dish_id
`

/** All active cuisines, sort_order ascending — the cuisine-filter rail on /eats and /eats/restaurants. */
export async function getCuisines(db: D1Database): Promise<CuisineRow[]> {
  const { results } = await db.prepare('SELECT * FROM cuisines ORDER BY sort_order ASC, name ASC').all<CuisineRow>()
  return results
}

export async function getCuisineBySlug(db: D1Database, slug: string): Promise<CuisineRow | null> {
  return db.prepare('SELECT * FROM cuisines WHERE slug = ?').bind(slug).first<CuisineRow>()
}

/** One restaurant by slug, joined with its cuisine. Returns null for an inactive/nonexistent slug — honest zero, never a silent fallback to a different restaurant. */
export async function getRestaurantBySlug(db: D1Database, slug: string): Promise<RestaurantRow | null> {
  return db.prepare(`${RESTAURANT_CARD_SELECT} AND r.slug = ?`).bind(slug).first<RestaurantRow>()
}

export async function getRestaurantById(db: D1Database, id: number): Promise<RestaurantRow | null> {
  return db.prepare(`${RESTAURANT_CARD_SELECT} AND r.id = ?`).bind(id).first<RestaurantRow>()
}

/** Featured/homepage rail — highest-rated first, then newest, so a freshly-seeded (rating_count=0) restaurant still appears (tiebreak on id DESC) rather than a rating-only sort silently hiding every seed row. */
export async function getFeaturedRestaurants(db: D1Database, limit = 12): Promise<RestaurantRow[]> {
  const { results } = await db
    .prepare(`${RESTAURANT_CARD_SELECT} ORDER BY r.rating_avg DESC, r.rating_count DESC, r.id DESC LIMIT ?`)
    .bind(limit)
    .all<RestaurantRow>()
  return results
}

export interface RestaurantBrowseFilters {
  cuisine?: string
  q?: string
  city?: string
  sort?: string
  page?: number
  perPage?: number
}

export interface RestaurantBrowseResult {
  restaurants: RestaurantRow[]
  total: number
  totalPages: number
  activeCuisine: CuisineRow | null
  cuisineLookupFailed: boolean
}

/**
 * /eats/restaurants discovery + search — the exact browseFreshProducts()
 * pattern (dynamic WHERE, honest-zero on an unknown cuisine slug, real sort
 * options), applied to restaurants instead of products.
 */
export async function browseRestaurants(db: D1Database, filters: RestaurantBrowseFilters): Promise<RestaurantBrowseResult> {
  const perPage = filters.perPage ?? 24
  const page = Math.max(1, filters.page ?? 1)
  const offset = (page - 1) * perPage

  let sql = RESTAURANT_CARD_SELECT
  const binds: any[] = []
  let activeCuisine: CuisineRow | null = null
  let cuisineLookupFailed = false

  if (filters.cuisine) {
    activeCuisine = await getCuisineBySlug(db, filters.cuisine)
    if (activeCuisine) {
      sql += ' AND r.cuisine_id = ?'
      binds.push(activeCuisine.id)
    } else {
      cuisineLookupFailed = true
      sql += ' AND 1 = 0' // honest zero — unknown cuisine slug, never a silent full-list fallback
    }
  }
  if (filters.q) {
    sql += ' AND (r.name LIKE ? OR r.description LIKE ? OR c.name LIKE ?)'
    binds.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`)
  }
  if (filters.city) {
    sql += ' AND r.city = ?'
    binds.push(filters.city)
  }

  const countSql = sql.replace(/SELECT r\.\*[\s\S]*?FROM restaurants r/, 'SELECT COUNT(*) as total FROM restaurants r')
  const countRow = await db.prepare(countSql).bind(...binds).first<{ total: number }>()
  const total = countRow?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  switch (filters.sort) {
    case 'rating': sql += ' ORDER BY r.rating_avg DESC, r.rating_count DESC'; break
    case 'delivery_fee_asc': sql += ' ORDER BY r.delivery_fee_kobo ASC'; break
    case 'prep_time': sql += ' ORDER BY r.avg_prep_minutes ASC'; break
    default: sql += ' ORDER BY r.rating_avg DESC, r.id DESC'
  }
  sql += ' LIMIT ? OFFSET ?'
  binds.push(perPage, offset)

  const restaurants = await db.prepare(sql).bind(...binds).all<RestaurantRow>()
  return { restaurants: restaurants.results, total, totalPages, activeCuisine, cuisineLookupFailed }
}

/** Full menu for a restaurant, grouped by section — sections ordered by sort_order, items within a section ordered by sort_order. Only available=1 items (Phase 1 is customer-facing, an unavailable item should never be orderable/visible on the profile page). */
export async function getMenuForRestaurant(db: D1Database, restaurantId: number): Promise<{ section: MenuSectionRow; items: MenuItemRow[] }[]> {
  const sections = await db
    .prepare(
      `SELECT ms.* FROM menu_sections ms
       JOIN menus m ON m.id = ms.menu_id
       WHERE m.restaurant_id = ? AND m.is_active = 1
       ORDER BY ms.sort_order ASC, ms.id ASC`
    )
    .bind(restaurantId)
    .all<MenuSectionRow>()

  if (sections.results.length === 0) return []

  const items = await db
    .prepare(`${MENU_ITEM_SELECT} WHERE mi.restaurant_id = ? AND mi.is_available = 1 ORDER BY mi.sort_order ASC, mi.id ASC`)
    .bind(restaurantId)
    .all<MenuItemRow>()

  const bySection = new Map<number, MenuItemRow[]>()
  for (const item of items.results) {
    const list = bySection.get(item.menu_section_id) ?? []
    list.push(item)
    bySection.set(item.menu_section_id, list)
  }

  return sections.results
    .map((section) => ({ section, items: bySection.get(section.id) ?? [] }))
    .filter((group) => group.items.length > 0) // never render an empty section header
}

/** One menu item by id, scoped to the given restaurant (so /eats/restaurants/:slug/item/:itemId can never leak a different restaurant's item via id guessing). */
export async function getMenuItem(db: D1Database, restaurantId: number, menuItemId: number): Promise<MenuItemRow | null> {
  return db
    .prepare(`${MENU_ITEM_SELECT} WHERE mi.id = ? AND mi.restaurant_id = ? AND mi.is_available = 1`)
    .bind(menuItemId, restaurantId)
    .first<MenuItemRow>()
}

/** Option groups + their options for one menu item, in display order. */
export async function getOptionGroupsForMenuItem(db: D1Database, menuItemId: number): Promise<{ group: MenuItemOptionGroupRow; options: MenuItemOptionRow[] }[]> {
  const groups = await db
    .prepare('SELECT * FROM menu_item_option_groups WHERE menu_item_id = ? ORDER BY sort_order ASC, id ASC')
    .bind(menuItemId)
    .all<MenuItemOptionGroupRow>()
  if (groups.results.length === 0) return []

  const groupIds = groups.results.map((g) => g.id)
  const options = await db
    .prepare(`SELECT * FROM menu_item_options WHERE option_group_id IN (${groupIds.map(() => '?').join(',')}) AND is_available = 1 ORDER BY sort_order ASC, id ASC`)
    .bind(...groupIds)
    .all<MenuItemOptionRow>()

  const byGroup = new Map<number, MenuItemOptionRow[]>()
  for (const opt of options.results) {
    const list = byGroup.get(opt.option_group_id) ?? []
    list.push(opt)
    byGroup.set(opt.option_group_id, list)
  }

  return groups.results.map((group) => ({ group, options: byGroup.get(group.id) ?? [] }))
}

/** Human-readable label + Material-icon + Tailwind color for eats_orders.status. Mirrors gigs.tsx's ORDER_STATUS_LABEL / fresh.ts's FRESHNESS_LABEL map pattern exactly. */
export const EATS_ORDER_STATUS_LABEL: Record<string, { label: string; icon: string; color: string }> = {
  new: { label: 'Order placed', icon: 'receipt_long', color: 'bg-gray-500 text-white' },
  accepted: { label: 'Accepted by restaurant', icon: 'thumb_up', color: 'bg-blue-600 text-white' },
  preparing: { label: 'Preparing your food', icon: 'soup_kitchen', color: 'bg-amber-600 text-white' },
  ready: { label: 'Ready for pickup/delivery', icon: 'inventory_2', color: 'bg-primary text-white' },
  handoff: { label: 'Out for delivery', icon: 'delivery_dining', color: 'bg-primary text-white' },
  completed: { label: 'Delivered', icon: 'check_circle', color: 'bg-primary-dark text-white' },
  cancelled: { label: 'Cancelled', icon: 'cancel', color: 'bg-red-100 text-red-700' },
  declined: { label: 'Declined by restaurant', icon: 'block', color: 'bg-red-100 text-red-700' },
}
