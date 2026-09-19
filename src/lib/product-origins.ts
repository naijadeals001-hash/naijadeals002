/**
 * Stage 2A — Africa Catalog & Country Architecture.
 *
 * Control Center propose -> verify workflow for product_country_origins
 * (migration 0067). That table has existed since Stage 1 with a full
 * verification-lifecycle schema (verification_status/source_url/
 * verified_by_user_id/verified_at) but ZERO application code anywhere ever
 * read or wrote it (confirmed by the Stage 2 discovery audit) — this module
 * is the first code to actually activate it, exactly as migration 0067's
 * own header comment anticipated ("Population is deferred to a future
 * Phase B pass with real, per-product verified provenance").
 *
 * SAME two-step propose -> verify discipline as country-profile.ts's
 * cc_country_facts workflow (Pat's Stage 2A authorization decision) —
 * deliberately the identical shape in both modules, not two different
 * conventions for what is conceptually the same problem (evidence-gated
 * provenance claims).
 *
 * THE GUARDRAIL, restated for this table specifically: a product_country_
 * origins row may NEVER be marked 'verified' without a non-empty
 * source_url. Enforced here in code, exactly like
 * country-profile.ts's verifyCountryFact().
 *
 * CRITICAL RULE THIS MODULE ENFORCES BY DESIGN, NOT JUST BY COMMENT: there
 * is no function anywhere in this file that derives origin_type or
 * country_iso from a product's category, brand, vendor, title, or any other
 * indirect signal. Every create call requires the caller (a human Control
 * Center admin, via the API layer) to supply country_iso and origin_type
 * explicitly. This module cannot be used to bulk-infer origins even by
 * accident — there is no bulk/batch function here at all, only single-row
 * propose/verify/dispute/delete, matching Stage 2A's explicit "no bulk
 * provenance backfill" scope boundary.
 */

export class OriginVerificationSourceRequiredError extends Error {
  constructor() {
    super('A source_url is required before a product country-of-origin claim can be marked verified.')
    this.name = 'OriginVerificationSourceRequiredError'
  }
}

export class ProductOriginNotFoundError extends Error {
  constructor() {
    super('Product country-of-origin record not found.')
    this.name = 'ProductOriginNotFoundError'
  }
}

export type OriginType = 'manufactured' | 'grown' | 'crafted' | 'brand_origin' | 'unspecified'
const VALID_ORIGIN_TYPES: OriginType[] = ['manufactured', 'grown', 'crafted', 'brand_origin', 'unspecified']

export interface ProductCountryOriginRow {
  id: number
  product_id: number
  country_iso: string
  origin_type: OriginType
  verification_status: 'unverified' | 'verified' | 'disputed'
  source_url: string | null
  note: string
  verified_by_user_id: number | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

export interface ProposeProductOriginInput {
  product_id: number
  country_iso: string
  origin_type: OriginType
  note: string
  source_url?: string | null
}

/**
 * STEP 1: propose an origin claim, always created at
 * verification_status='unverified'. `note` is REQUIRED (not optional) —
 * matching migration 0067's own comment: "Free-text note for how/why this
 * origin was assigned — required for audit trail so a future reviewer...
 * can see WHY a product was linked to a country without re-deriving it from
 * scratch." A caller cannot skip explaining their evidence even at the
 * proposal stage.
 */
export async function proposeProductOrigin(db: D1Database, input: ProposeProductOriginInput): Promise<number> {
  if (!VALID_ORIGIN_TYPES.includes(input.origin_type)) {
    throw new Error(`Unsupported origin_type "${input.origin_type}". Valid types: ${VALID_ORIGIN_TYPES.join(', ')}`)
  }
  if (!input.note?.trim()) {
    throw new Error('note is required — explain the evidence/reasoning for this origin claim')
  }
  if (!/^[A-Z]{2}$/.test(input.country_iso)) {
    throw new Error('country_iso must be a 2-letter ISO code')
  }
  const result = await db
    .prepare(
      `INSERT INTO product_country_origins (product_id, country_iso, origin_type, note, source_url, verification_status)
       VALUES (?, ?, ?, ?, ?, 'unverified')`
    )
    .bind(input.product_id, input.country_iso, input.origin_type, input.note.trim(), input.source_url ?? null)
    .run()
  return Number(result.meta.last_row_id)
}

/**
 * STEP 2: the ONLY function permitted to set product_country_origins.
 * verification_status='verified'. Identical guardrail shape to
 * country-profile.ts's verifyCountryFact() — throws if sourceUrl is empty,
 * requires the actor's user id from the authenticated session.
 */
export async function verifyProductOrigin(db: D1Database, originId: number, sourceUrl: string, verifiedByUserId: number): Promise<void> {
  if (!sourceUrl?.trim()) {
    throw new OriginVerificationSourceRequiredError()
  }
  const existing = await db.prepare('SELECT id FROM product_country_origins WHERE id = ?').bind(originId).first<{ id: number }>()
  if (!existing) throw new ProductOriginNotFoundError()

  await db
    .prepare(
      `UPDATE product_country_origins
       SET verification_status = 'verified', source_url = ?, verified_by_user_id = ?, verified_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(sourceUrl.trim(), verifiedByUserId, originId)
    .run()
}

/** Retracts a previously-verified (or unverified) origin claim to 'disputed' — e.g. new evidence contradicts a prior claim. Disputed rows never surface on a public "Products From <Country>" page. */
export async function disputeProductOrigin(db: D1Database, originId: number): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE product_country_origins SET verification_status = 'disputed', updated_at = datetime('now') WHERE id = ?`)
    .bind(originId)
    .run()
  return (result.meta.rows_written ?? 0) > 0
}

export async function deleteProductOrigin(db: D1Database, originId: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM product_country_origins WHERE id = ?').bind(originId).run()
  return (result.meta.rows_written ?? 0) > 0
}

/** Every origin claim (any status) for one product — the product-editing admin view. */
export async function getProductOrigins(db: D1Database, productId: number): Promise<ProductCountryOriginRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM product_country_origins WHERE product_id = ? ORDER BY created_at ASC')
    .bind(productId)
    .all<ProductCountryOriginRow>()
  return results
}

/** Control-Center-only: every origin claim across all products still awaiting verification — the review queue. */
export async function getPendingProductOrigins(db: D1Database, limit = 100): Promise<Array<ProductCountryOriginRow & { product_title: string; product_slug: string }>> {
  const { results } = await db
    .prepare(
      `SELECT o.*, p.title as product_title, p.slug as product_slug
       FROM product_country_origins o
       JOIN products p ON p.id = o.product_id
       WHERE o.verification_status = 'unverified'
       ORDER BY o.created_at ASC LIMIT ?`
    )
    .bind(limit)
    .all<ProductCountryOriginRow & { product_title: string; product_slug: string }>()
  return results
}
