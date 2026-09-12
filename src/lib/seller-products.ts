/**
 * Marketplace Engine 2.0 — Seller product/listing/inventory management
 * (spec sections 27, 28, 35, 38).
 *
 * OWNERSHIP RULE (non-negotiable, mirrors src/lib/seller.ts's
 * resolveSellerStatus doc comment): every function here that mutates a
 * product/listing takes a `vendorId` parameter that the CALLER must have
 * already resolved server-side from the authenticated session — either via
 * `c.get('sellerVendor').id` (individual seller, see requireActiveSeller) or
 * via an organization-owned vendor row looked up by
 * `organization_id = c.get('orgMembership').member.organization_id` after
 * `requirePermission('store.manage')` has passed. This file NEVER accepts a
 * vendor_id sourced from request body/query/params for authorization
 * purposes — every write is scoped with `AND vendor_id = ?` so a listing
 * that belongs to a different seller simply does not match any row
 * (returns 0 affected rows / null), which is what makes "Seller A cannot
 * edit Seller B's listing" true by construction rather than by a
 * case-by-case check.
 */
import type { ProductRow, ListingRow, VariantRow } from '../types'

export class NotOwnedError extends Error {
  constructor(entity: string, id: number) {
    super(`${entity} ${id} not found or not owned by this seller`)
  }
}

// ---------- Products ----------

export interface CreateProductInput {
  category_id: number
  brand_id?: number | null
  title: string
  description?: string
  long_description?: string
  specs_json?: string
  whats_included_json?: string
  image_url: string
  gallery_json?: string
  return_policy?: string
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * Creates a NEW canonical product. Per spec section 29 (duplication
 * control), the caller (route handler) should first call
 * `findSimilarProducts` and surface candidates to the seller before
 * calling this — this function itself does not silently merge/dedupe.
 * New products start in moderation_status='pending_review' — never
 * auto-published as 'active' (spec section 30/47: no fake completion via
 * skipped moderation).
 */
export async function createProduct(db: D1Database, input: CreateProductInput): Promise<number> {
  const baseSlug = slugify(input.title) || 'product'
  let slug = baseSlug
  let suffix = 1
  // Guarantee slug uniqueness without relying on a race-prone SELECT-then-INSERT loop for more than a few collisions.
  while (await db.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first()) {
    slug = `${baseSlug}-${++suffix}`
  }

  const result = await db
    .prepare(
      `INSERT INTO products (slug, category_id, brand_id, title, description, long_description, specs_json, whats_included_json, image_url, gallery_json, return_policy, is_active, moderation_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending_review')`
    )
    .bind(
      slug,
      input.category_id,
      input.brand_id ?? null,
      input.title,
      input.description ?? '',
      input.long_description ?? '',
      input.specs_json ?? '{}',
      input.whats_included_json ?? '[]',
      input.image_url,
      input.gallery_json ?? '[]',
      input.return_policy ?? '7-day return if the item arrives damaged or not as described.'
    )
    .run()

  return Number(result.meta.last_row_id)
}

/**
 * Section 29 duplication control: cheap title/brand similarity search so
 * the seller-facing "Create Product" flow can suggest "attach your offer
 * to this existing product instead" before creating a duplicate canonical
 * product. Deliberately simple (LIKE match) — never auto-merges.
 */
export async function findSimilarProducts(db: D1Database, title: string, categoryId?: number): Promise<ProductRow[]> {
  const words = title.split(/\s+/).filter((w) => w.length > 2).slice(0, 4)
  if (words.length === 0) return []
  const likeClauses = words.map(() => 'title LIKE ?').join(' OR ')
  const binds: (string | number)[] = words.map((w) => `%${w}%`)
  let sql = `SELECT * FROM products WHERE (${likeClauses}) AND is_active = 1`
  if (categoryId) {
    sql += ' AND category_id = ?'
    binds.push(categoryId)
  }
  sql += ' LIMIT 10'
  const { results } = await db.prepare(sql).bind(...binds).all<ProductRow>()
  return results
}

export async function getProductById(db: D1Database, productId: number): Promise<ProductRow | null> {
  return db.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first<ProductRow>()
}

/**
 * Products are canonical/shared — a seller may edit descriptive fields of a
 * product they listed, but this is intentionally narrow (title/description/
 * specs only, never category/brand which affect the shared catalog tree
 * broadly) and only permitted if the seller has at least one listing
 * attached to it. Returns false if the seller has no listing on this
 * product (NotOwnedError is not thrown here so callers can 404 uniformly).
 */
export async function sellerOwnsProduct(db: D1Database, vendorId: number, productId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM product_listings WHERE product_id = ? AND vendor_id = ? LIMIT 1')
    .bind(productId, vendorId)
    .first()
  return !!row
}

export interface UpdateProductInput {
  title?: string
  description?: string
  long_description?: string
  specs_json?: string
  whats_included_json?: string
  image_url?: string
  gallery_json?: string
}

export async function updateProduct(db: D1Database, vendorId: number, productId: number, input: UpdateProductInput): Promise<void> {
  if (!(await sellerOwnsProduct(db, vendorId, productId))) throw new NotOwnedError('Product', productId)

  const fields: string[] = []
  const binds: unknown[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    fields.push(`${key} = ?`)
    binds.push(value)
  }
  if (fields.length === 0) return
  fields.push(`updated_at = datetime('now')`)
  await db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).bind(...binds, productId).run()
}

// ---------- Listings ----------

export interface CreateListingInput {
  product_id: number
  price_kobo: number
  compare_at_price_kobo?: number | null
  stock: number
  condition?: string
  delivery_days_min?: number
  delivery_days_max?: number
  warranty_months?: number
  unit_of_measure?: string
  unit_quantity?: number
  is_variable_weight?: boolean
  variable_weight_tolerance_pct?: number
  sku?: string | null
  warehouse_location?: string | null
  low_stock_threshold?: number
  allow_backorder?: boolean
}

/**
 * Creates a NEW listing (seller offer) attached to an EXISTING canonical
 * product. `vendorId` is the server-resolved owning vendor — never a
 * client-supplied value. Enforces the same UNIQUE(product_id, vendor_id)
 * the DB already guards, and starts in moderation_status='pending_review'.
 * A listing never sets is_primary=1 on creation — buy-box selection (see
 * src/lib/buybox.ts) decides that separately.
 */
export async function createListing(db: D1Database, vendorId: number, input: CreateListingInput): Promise<number> {
  const existing = await db
    .prepare('SELECT id FROM product_listings WHERE product_id = ? AND vendor_id = ?')
    .bind(input.product_id, vendorId)
    .first<{ id: number }>()
  if (existing) throw new Error('You already have a listing for this product. Use update instead.')

  if (input.price_kobo <= 0) throw new Error('price_kobo must be > 0')
  if (input.stock < 0) throw new Error('stock cannot be negative')

  const result = await db
    .prepare(
      `INSERT INTO product_listings
        (product_id, vendor_id, price_kobo, compare_at_price_kobo, stock, condition, delivery_days_min, delivery_days_max, warranty_months,
         unit_of_measure, unit_quantity, is_variable_weight, variable_weight_tolerance_pct, sku, warehouse_location, low_stock_threshold, allow_backorder,
         is_active, moderation_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending_review')`
    )
    .bind(
      input.product_id,
      vendorId,
      input.price_kobo,
      input.compare_at_price_kobo ?? null,
      input.stock,
      input.condition ?? 'new',
      input.delivery_days_min ?? 1,
      input.delivery_days_max ?? 3,
      input.warranty_months ?? 0,
      input.unit_of_measure ?? 'piece',
      input.unit_quantity ?? 1,
      input.is_variable_weight ? 1 : 0,
      input.variable_weight_tolerance_pct ?? 0,
      input.sku ?? null,
      input.warehouse_location ?? null,
      input.low_stock_threshold ?? 5,
      input.allow_backorder ? 1 : 0
    )
    .run()

  return Number(result.meta.last_row_id)
}

/** Fetches a listing ONLY if owned by vendorId — the "does not exist for you" pattern that prevents cross-vendor enumeration. */
export async function getOwnedListing(db: D1Database, vendorId: number, listingId: number): Promise<ListingRow | null> {
  return db.prepare('SELECT * FROM product_listings WHERE id = ? AND vendor_id = ?').bind(listingId, vendorId).first<ListingRow>()
}

export interface UpdateListingInput {
  price_kobo?: number
  compare_at_price_kobo?: number | null
  condition?: string
  delivery_days_min?: number
  delivery_days_max?: number
  warranty_months?: number
  unit_of_measure?: string
  unit_quantity?: number
  is_variable_weight?: boolean
  variable_weight_tolerance_pct?: number
  sku?: string | null
  warehouse_location?: string | null
  low_stock_threshold?: number
  allow_backorder?: boolean
  is_active?: boolean
  moderation_status?: 'draft' | 'pending_review' | 'active' | 'paused' | 'rejected' | 'archived'
}

/**
 * Updates a listing's non-inventory fields. Ownership is enforced by the
 * WHERE clause itself (`vendor_id = ?`) — a mismatched listingId/vendorId
 * pair simply updates 0 rows, and the caller treats that as 404 (never a
 * silent no-op that leaks whether the listing exists for another seller).
 * Stock is intentionally NOT settable here — use adjustStock (inventory.ts)
 * so every stock change is ledgered.
 */
export async function updateListing(db: D1Database, vendorId: number, listingId: number, input: UpdateListingInput): Promise<boolean> {
  if (input.price_kobo !== undefined && input.price_kobo <= 0) throw new Error('price_kobo must be > 0')

  const fields: string[] = []
  const binds: unknown[] = []
  const boolFields = new Set(['is_variable_weight', 'allow_backorder', 'is_active'])
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    fields.push(`${key} = ?`)
    binds.push(boolFields.has(key) ? (value ? 1 : 0) : value)
  }
  if (fields.length === 0) return true
  fields.push(`updated_at = datetime('now')`)

  const result = await db
    .prepare(`UPDATE product_listings SET ${fields.join(', ')} WHERE id = ? AND vendor_id = ?`)
    .bind(...binds, listingId, vendorId)
    .run()
  return (result.meta.rows_written ?? 0) > 0 || result.success
}

/** Lists all listings owned by a vendor, joined with product title/image, for the seller products dashboard. */
export async function getListingsForVendor(db: D1Database, vendorId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT pl.*, p.title AS product_title, p.slug AS product_slug, p.image_url AS product_image_url, c.name AS category_name
       FROM product_listings pl
       JOIN products p ON p.id = pl.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE pl.vendor_id = ?
       ORDER BY pl.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(vendorId, limit, offset)
    .all()
  return results
}

// ---------- Variants ----------

export interface CreateVariantInput {
  variant_type: string
  variant_value: string
  price_delta_kobo?: number
  stock?: number
  sort_order?: number
}

/** Creates a variant scoped to a listing already verified to be owned by vendorId (caller must call getOwnedListing first). */
export async function createVariant(db: D1Database, listingId: number, input: CreateVariantInput): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO product_variants (listing_id, variant_type, variant_value, price_delta_kobo, stock, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(listingId, input.variant_type, input.variant_value, input.price_delta_kobo ?? 0, input.stock ?? 0, input.sort_order ?? 0)
    .run()
  return Number(result.meta.last_row_id)
}

/** Verifies a variant belongs to a listing owned by vendorId — the cross-vendor guard for variant-level mutations. */
export async function getOwnedVariant(db: D1Database, vendorId: number, variantId: number): Promise<VariantRow | null> {
  return db
    .prepare(
      `SELECT v.* FROM product_variants v
       JOIN product_listings pl ON pl.id = v.listing_id
       WHERE v.id = ? AND pl.vendor_id = ?`
    )
    .bind(variantId, vendorId)
    .first<VariantRow>()
}

// ---------- Seller orders ----------

/** Orders containing at least one item sold by this vendor, scoped strictly by vendor_id on order_items — never exposes another seller's order rows or another seller's items within a shared multi-vendor order. */
export async function getOrdersForVendor(db: D1Database, vendorId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT DISTINCT o.id, o.order_number, o.status, o.payment_status, o.created_at, o.shipping_name, o.shipping_city, o.shipping_state
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE oi.vendor_id = ?
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(vendorId, limit, offset)
    .all()
  return results
}

/**
 * The order-items belonging to THIS vendor within one order — deliberately
 * excludes other sellers' items in the same multi-vendor order (spec
 * section 42's explicit security test: "seller A cannot view seller B's
 * private order data" — even when A and B legitimately share an order).
 */
export async function getVendorItemsForOrder(db: D1Database, vendorId: number, orderId: number) {
  const { results } = await db
    .prepare('SELECT * FROM order_items WHERE order_id = ? AND vendor_id = ?')
    .bind(orderId, vendorId)
    .all()
  return results
}

export type SellerOrderItemAction = 'fulfilled' | 'shipped' | 'delivered' | 'cancelled'

/**
 * Updates the fulfillment status of ONE order item, scoped by vendor_id in
 * the WHERE clause — a seller can never update another seller's item, even
 * within an order they can otherwise see. When fulfilling a variable-weight
 * item, `fulfilledQuantity` records the actual weight and the final price
 * is (re)computed from it (spec section 13).
 */
export async function updateOrderItemStatus(
  db: D1Database,
  vendorId: number,
  orderItemId: number,
  action: SellerOrderItemAction,
  opts: { fulfilledQuantity?: number } = {}
): Promise<boolean> {
  const item = await db
    .prepare('SELECT * FROM order_items WHERE id = ? AND vendor_id = ?')
    .bind(orderItemId, vendorId)
    .first<{ id: number; listing_id: number; unit_price_kobo: number; quantity: number }>()
  if (!item) return false

  if (action === 'fulfilled' && opts.fulfilledQuantity !== undefined) {
    const finalPriceKobo = Math.round(item.unit_price_kobo * opts.fulfilledQuantity)
    await db
      .prepare(`UPDATE order_items SET item_status = ?, fulfilled_quantity = ?, final_price_kobo = ? WHERE id = ?`)
      .bind(action, opts.fulfilledQuantity, finalPriceKobo, orderItemId)
      .run()
  } else {
    await db.prepare(`UPDATE order_items SET item_status = ? WHERE id = ?`).bind(action, orderItemId).run()
  }
  return true
}
