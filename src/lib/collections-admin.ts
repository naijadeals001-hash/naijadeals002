/**
 * Marketplace Engine 2.1 — Merchandising collection MANAGEMENT (spec
 * section 10). Extends the existing read-only src/lib/collections.ts
 * (getAllCollections/getCollectionBySlug/getProductsInCollection/
 * addProductToCollection/removeProductFromCollection/getCollectionsForProduct
 * — all preserved, unchanged) with the create/edit/activate/deactivate/
 * schedule/reorder functions that were confirmed missing during
 * inspection. Every function here is intended to sit behind
 * requirePlatformRole('admin') at the route layer (src/routes/api-admin.ts)
 * — this module does not re-check platform role itself.
 */

export interface CreateCollectionInput {
  slug: string
  name: string
  description?: string
  collection_type?: string
  sort_order?: number
  starts_at?: string | null
  ends_at?: string | null
}

export async function createCollection(db: D1Database, adminUserId: number, input: CreateCollectionInput): Promise<number> {
  const existing = await db.prepare('SELECT id FROM collections WHERE slug = ?').bind(input.slug).first()
  if (existing) throw new Error(`A collection with slug "${input.slug}" already exists`)

  const result = await db
    .prepare(
      `INSERT INTO collections (slug, name, description, collection_type, sort_order, starts_at, ends_at, created_by_user_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .bind(input.slug, input.name, input.description ?? '', input.collection_type ?? 'merchandising', input.sort_order ?? 0, input.starts_at ?? null, input.ends_at ?? null, adminUserId)
    .run()
  return Number(result.meta.last_row_id)
}

export interface UpdateCollectionInput {
  name?: string
  description?: string
  collection_type?: string
  sort_order?: number
  starts_at?: string | null
  ends_at?: string | null
}

export async function updateCollection(db: D1Database, collectionId: number, input: UpdateCollectionInput): Promise<boolean> {
  const fields: string[] = []
  const binds: unknown[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    fields.push(`${key} = ?`)
    binds.push(value)
  }
  if (fields.length === 0) return true
  const result = await db.prepare(`UPDATE collections SET ${fields.join(', ')} WHERE id = ?`).bind(...binds, collectionId).run()
  return (result.meta.rows_written ?? 0) > 0
}

export async function setCollectionActive(db: D1Database, collectionId: number, isActive: boolean): Promise<boolean> {
  const result = await db.prepare('UPDATE collections SET is_active = ? WHERE id = ?').bind(isActive ? 1 : 0, collectionId).run()
  return (result.meta.rows_written ?? 0) > 0
}

/** All collections including inactive ones — admin management view (the public catalog only ever calls the existing getAllCollections, which already filters is_active=1). */
export async function getAllCollectionsForAdmin(db: D1Database) {
  const { results } = await db.prepare('SELECT * FROM collections ORDER BY sort_order ASC, id ASC').all()
  return results
}

export async function addProductToCollectionOrdered(db: D1Database, collectionId: number, productId: number, sortOrder?: number): Promise<void> {
  const collection = await db.prepare('SELECT id FROM collections WHERE id = ?').bind(collectionId).first()
  if (!collection) throw new Error('Collection not found')

  let finalSortOrder = sortOrder
  if (finalSortOrder === undefined) {
    const maxRow = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM product_collections WHERE collection_id = ?').bind(collectionId).first<{ max_order: number }>()
    finalSortOrder = (maxRow?.max_order ?? -1) + 1
  }

  await db
    .prepare(
      `INSERT INTO product_collections (collection_id, product_id, sort_order) VALUES (?, ?, ?)
       ON CONFLICT(collection_id, product_id) DO UPDATE SET sort_order = excluded.sort_order`
    )
    .bind(collectionId, productId, finalSortOrder)
    .run()
}

export async function removeProductFromCollectionById(db: D1Database, collectionId: number, productId: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM product_collections WHERE collection_id = ? AND product_id = ?').bind(collectionId, productId).run()
  return (result.meta.rows_written ?? 0) > 0
}

/**
 * Reorders every product within one collection in a single batch —
 * `orderedProductIds` is the FULL new order (index = new sort_order).
 * Products not in this collection are silently ignored (WHERE clause
 * scopes to collection_id), so a bad id can never corrupt another
 * collection's ordering.
 */
export async function reorderCollectionProducts(db: D1Database, collectionId: number, orderedProductIds: number[]): Promise<void> {
  const statements = orderedProductIds.map((productId, index) =>
    db.prepare('UPDATE product_collections SET sort_order = ? WHERE collection_id = ? AND product_id = ?').bind(index, collectionId, productId)
  )
  if (statements.length > 0) await db.batch(statements)
}

/** Products in a collection with admin-relevant fields (title/image/vendor/stock), ordered by sort_order — the admin management-panel view. */
export async function getCollectionProductsForAdmin(db: D1Database, collectionId: number) {
  const { results } = await db
    .prepare(
      `SELECT pc.product_id, pc.sort_order, p.title, p.image_url, p.slug, p.is_active AS product_is_active
       FROM product_collections pc
       JOIN products p ON p.id = pc.product_id
       WHERE pc.collection_id = ?
       ORDER BY pc.sort_order ASC`
    )
    .bind(collectionId)
    .all()
  return results
}
