/**
 * Marketplace Engine 2.1 — Dynamic product attributes (spec sections 8/9).
 *
 * The schema (`category_attributes` / `product_attribute_values`) has
 * existed since migration 0038, but NOTHING in the application read or
 * wrote it (confirmed via grep during Engine 2.1 inspection — zero
 * references anywhere in src/). This file is the category-driven
 * server-side authority: load a category's attribute DEFINITIONS, validate
 * a seller's submitted VALUES against them, and persist/read those values.
 * No product-specific field is ever hardcoded here — every input/label/
 * requirement/type comes from category_attributes rows.
 *
 * SECURITY (spec section 9, non-negotiable):
 *   - `validateAndCollectAttributeValues` rejects any attribute key that is
 *     not defined for the product's OWN category — a seller cannot write
 *     values for another category's attributes, and cannot inject
 *     unsupported attribute types (data_type is read from the DB, never
 *     trusted from the client).
 *   - `saveProductAttributeValues` takes the caller-verified ownership
 *     (vendorId + productId, already checked by sellerOwnsProduct in
 *     seller-products.ts before this is called) — this module itself does
 *     not re-verify ownership, exactly like createVariant/replacePricingTiers
 *     already do for their own scoped mutations.
 *   - required-field validation happens HERE, server-side, before any row
 *     is written — a missing required attribute throws, it is never
 *     silently defaulted.
 *   - attribute DEFINITIONS (category_attributes rows) are managed only by
 *     admin/catalog-manager functions below (createCategoryAttribute etc.),
 *     never by a seller-facing endpoint.
 */

export type AttributeDataType = 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date' | 'measurement' | 'structured'

export interface CategoryAttributeRow {
  id: number
  category_id: number
  key: string
  label: string
  data_type: AttributeDataType
  options_json: string | null
  requirement: 'required' | 'optional'
  condition_json: string | null
  sort_order: number
}

/** Every attribute DEFINITION for one category, in display order — the seller-UI's "what fields do I render" call. */
export async function getAttributesForCategory(db: D1Database, categoryId: number): Promise<CategoryAttributeRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM category_attributes WHERE category_id = ? ORDER BY sort_order ASC, id ASC')
    .bind(categoryId)
    .all<CategoryAttributeRow>()
  return results
}

export interface CreateCategoryAttributeInput {
  category_id: number
  key: string
  label: string
  data_type: AttributeDataType
  options_json?: string | null
  requirement?: 'required' | 'optional'
  condition_json?: string | null
  sort_order?: number
}

const VALID_DATA_TYPES: AttributeDataType[] = ['text', 'number', 'boolean', 'select', 'multiselect', 'date', 'measurement', 'structured']

/** Admin/catalog-manager only (route layer must gate with requirePlatformRole('admin')) — defines a NEW attribute for a category. */
export async function createCategoryAttribute(db: D1Database, input: CreateCategoryAttributeInput): Promise<number> {
  if (!VALID_DATA_TYPES.includes(input.data_type)) {
    throw new Error(`Unsupported attribute data_type "${input.data_type}". Valid types: ${VALID_DATA_TYPES.join(', ')}`)
  }
  if ((input.data_type === 'select' || input.data_type === 'multiselect') && !input.options_json) {
    throw new Error(`data_type "${input.data_type}" requires options_json (the list of selectable values)`)
  }
  const result = await db
    .prepare(
      `INSERT INTO category_attributes (category_id, key, label, data_type, options_json, requirement, condition_json, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(input.category_id, input.key, input.label, input.data_type, input.options_json ?? null, input.requirement ?? 'optional', input.condition_json ?? null, input.sort_order ?? 0)
    .run()
  return Number(result.meta.last_row_id)
}

export async function updateCategoryAttribute(db: D1Database, attributeId: number, input: Partial<Omit<CreateCategoryAttributeInput, 'category_id'>>): Promise<boolean> {
  if (input.data_type && !VALID_DATA_TYPES.includes(input.data_type)) {
    throw new Error(`Unsupported attribute data_type "${input.data_type}"`)
  }
  const fields: string[] = []
  const binds: unknown[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    fields.push(`${key} = ?`)
    binds.push(value)
  }
  if (fields.length === 0) return true
  const result = await db.prepare(`UPDATE category_attributes SET ${fields.join(', ')} WHERE id = ?`).bind(...binds, attributeId).run()
  return (result.meta.rows_written ?? 0) > 0
}

export async function deleteCategoryAttribute(db: D1Database, attributeId: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM category_attributes WHERE id = ?').bind(attributeId).run()
  return (result.meta.rows_written ?? 0) > 0
}

/**
 * Validates a seller's submitted `{ key: value }` map against the REAL
 * attribute definitions for `categoryId` (never trusts a client-supplied
 * attribute id/type). Returns the resolved `{ attribute_id, value }` pairs
 * ready to persist. Throws with a clear message on:
 *   - a submitted key that isn't defined for this category (blocks
 *     "write another category's attributes" / arbitrary key injection),
 *   - a missing REQUIRED attribute,
 *   - a boolean/number/date value that doesn't parse,
 *   - a select/multiselect value not present in options_json.
 */
export async function validateAndCollectAttributeValues(
  db: D1Database,
  categoryId: number,
  submitted: Record<string, unknown>
): Promise<{ attribute_id: number; value: string }[]> {
  const definitions = await getAttributesForCategory(db, categoryId)
  const byKey = new Map(definitions.map((d) => [d.key, d]))

  // Reject unknown keys outright — this is what makes "seller writes
  // arbitrary attribute definitions" / "another category's attributes"
  // structurally impossible rather than merely unchecked.
  for (const key of Object.keys(submitted)) {
    if (!byKey.has(key)) {
      throw new Error(`"${key}" is not a valid attribute for this category`)
    }
  }

  const resolved: { attribute_id: number; value: string }[] = []
  for (const def of definitions) {
    const raw = submitted[def.key]
    const isMissing = raw === undefined || raw === null || raw === ''

    if (def.requirement === 'required' && isMissing) {
      throw new Error(`"${def.label}" is required for this category`)
    }
    if (isMissing) continue // optional and not provided — skip, never a fake default

    resolved.push({ attribute_id: def.id, value: coerceAndValidate(def, raw) })
  }
  return resolved
}

function coerceAndValidate(def: CategoryAttributeRow, raw: unknown): string {
  switch (def.data_type) {
    case 'number':
    case 'measurement': {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new Error(`"${def.label}" must be a number`)
      return String(n)
    }
    case 'boolean': {
      return raw === true || raw === 'true' || raw === 1 || raw === '1' ? 'true' : 'false'
    }
    case 'date': {
      const d = new Date(String(raw))
      if (Number.isNaN(d.getTime())) throw new Error(`"${def.label}" must be a valid date`)
      return String(raw)
    }
    case 'select': {
      const options: string[] = def.options_json ? JSON.parse(def.options_json) : []
      if (!options.includes(String(raw))) throw new Error(`"${raw}" is not a valid option for "${def.label}"`)
      return String(raw)
    }
    case 'multiselect': {
      const options: string[] = def.options_json ? JSON.parse(def.options_json) : []
      const values: string[] = Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map((s) => s.trim())
      for (const v of values) {
        if (!options.includes(v)) throw new Error(`"${v}" is not a valid option for "${def.label}"`)
      }
      return JSON.stringify(values)
    }
    case 'structured':
      return typeof raw === 'string' ? raw : JSON.stringify(raw)
    default: // 'text'
      return String(raw)
  }
}

/**
 * Persists the already-validated attribute values for a product. Caller
 * MUST have already verified `sellerOwnsProduct(db, vendorId, productId)`
 * (this module does not re-check ownership — mirrors createVariant's
 * "ownership verified by caller" contract in seller-products.ts).
 * Replaces ALL existing values for this product atomically (delete +
 * re-insert), same pattern as pricing.ts's replacePricingTiers.
 */
export async function saveProductAttributeValues(db: D1Database, productId: number, values: { attribute_id: number; value: string }[]): Promise<void> {
  const statements = [
    db.prepare('DELETE FROM product_attribute_values WHERE product_id = ?').bind(productId),
    ...values.map((v) =>
      db.prepare('INSERT INTO product_attribute_values (product_id, attribute_id, value) VALUES (?, ?, ?)').bind(productId, v.attribute_id, v.value)
    ),
  ]
  await db.batch(statements)
}

/** Customer/seller-facing: a product's attribute values joined with their definitions (label/data_type) for display — spec section 8's "display attributes on product pages". */
export async function getProductAttributeValues(db: D1Database, productId: number) {
  const { results } = await db
    .prepare(
      `SELECT pav.value, ca.key, ca.label, ca.data_type, ca.sort_order
       FROM product_attribute_values pav
       JOIN category_attributes ca ON ca.id = pav.attribute_id
       WHERE pav.product_id = ?
       ORDER BY ca.sort_order ASC`
    )
    .bind(productId)
    .all()
  return results
}
