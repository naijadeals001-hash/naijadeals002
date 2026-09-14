/**
 * Marketplace Engine 2.1 — Product/listing moderation workflow (spec
 * section 16).
 *
 * THE single authority for changing product_listings.moderation_status
 * (and, for the underlying canonical product, products.moderation_status)
 * as an ADMIN decision. This is what closes the critical security gap
 * found during Engine 2.1 inspection: src/routes/api-seller.ts's
 * `PATCH /listings/:id` previously accepted `body.moderation_status`
 * directly from the seller with no role check, letting a seller
 * self-approve their own listing. That field has been stripped from the
 * seller-writable input set (see api-seller.ts's diff) — moderation
 * decisions now ONLY happen through the admin-only functions below,
 * gated at the route layer by requirePlatformRole('admin').
 *
 * Every decision records actor/timestamp/previous-state/new-state/reason
 * (spec section 16's explicit requirement) into the EXISTING dormant
 * `cc_audit_logs` table (migration 0013) rather than inventing a new
 * moderation-log table — this is exactly the shape cc_audit_logs was
 * designed for (before_json/after_json/entity_type/entity_id/action) and
 * satisfies the Master Ecosystem Directive's "integrate, don't
 * duplicate" rule for the Admin & Operations Command Center.
 */

export type ModerationDecision = 'approve' | 'reject' | 'suspend' | 'request_changes'

const DECISION_TO_STATUS: Record<ModerationDecision, string> = {
  approve: 'active',
  reject: 'rejected',
  suspend: 'paused',
  request_changes: 'draft',
}

export interface PendingListingRow {
  id: number
  product_id: number
  vendor_id: number
  moderation_status: string
  price_kobo: number
  stock: number
  product_title: string
  product_image_url: string
  vendor_name: string
  created_at: string
}

/** Admin-facing queue: every listing awaiting moderation, oldest first (FIFO — spec section 16's "view pending products"). Route MUST already be gated by requirePlatformRole('admin'). */
export async function getPendingModerationQueue(db: D1Database, limit = 100): Promise<PendingListingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT pl.id, pl.product_id, pl.vendor_id, pl.moderation_status, pl.price_kobo, pl.stock, pl.created_at,
              p.title AS product_title, p.image_url AS product_image_url, v.name AS vendor_name
       FROM product_listings pl
       JOIN products p ON p.id = pl.product_id
       JOIN vendors v ON v.id = pl.vendor_id
       WHERE pl.moderation_status = 'pending_review'
       ORDER BY pl.created_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<PendingListingRow>()
  return results
}

/** Full detail for one listing + its seller — spec section 16's "inspect product/seller info". Admin-only, no vendor scoping (any listing is inspectable by admin). */
export async function getListingForModeration(db: D1Database, listingId: number) {
  return db
    .prepare(
      `SELECT pl.*, p.title AS product_title, p.description AS product_description, p.image_url AS product_image_url,
              v.name AS vendor_name, v.business_name, v.verification_status AS vendor_verification_status
       FROM product_listings pl
       JOIN products p ON p.id = pl.product_id
       JOIN vendors v ON v.id = pl.vendor_id
       WHERE pl.id = ?`
    )
    .bind(listingId)
    .first()
}

/**
 * Records an admin moderation decision on ONE listing. Writes the new
 * moderation_status, then an audit-log row capturing actor/before/after/
 * reason into the shared cc_audit_logs table, then a cc_domain_events row
 * so Communication ("product approved/rejected" seller notification, spec
 * section 22) can react without Marketplace building its own notifier.
 *
 * `request_changes` (-> 'draft') requires a reason; the other decisions
 * accept an optional reason.
 */
export async function applyModerationDecision(
  db: D1Database,
  listingId: number,
  decision: ModerationDecision,
  adminUserId: number,
  adminName: string,
  reason?: string
): Promise<{ previousStatus: string; newStatus: string }> {
  if (decision === 'request_changes' && !reason) {
    throw new Error('A reason is required when requesting changes')
  }

  const listing = await db.prepare('SELECT id, moderation_status, vendor_id FROM product_listings WHERE id = ?').bind(listingId).first<{ id: number; moderation_status: string; vendor_id: number }>()
  if (!listing) throw new Error('Listing not found')

  const newStatus = DECISION_TO_STATUS[decision]
  const previousStatus = listing.moderation_status

  await db.batch([
    db.prepare(`UPDATE product_listings SET moderation_status = ?, updated_at = datetime('now') WHERE id = ?`).bind(newStatus, listingId),
    db
      .prepare(
        `INSERT INTO cc_audit_logs (actor_user_id, actor_name_snapshot, action, entity_type, entity_id, before_json, after_json, context_json, success)
         VALUES (?, ?, 'listing_moderation_decision', 'product_listing', ?, ?, ?, ?, 1)`
      )
      .bind(
        adminUserId,
        adminName,
        String(listingId),
        JSON.stringify({ moderation_status: previousStatus }),
        JSON.stringify({ moderation_status: newStatus }),
        JSON.stringify({ decision, reason: reason ?? null, vendor_id: listing.vendor_id })
      ),
    db
      .prepare(
        `INSERT INTO cc_domain_events (event_type, entity_type, entity_id, payload_json, actor_user_id)
         VALUES ('listing_moderation_decision', 'product_listing', ?, ?, ?)`
      )
      .bind(String(listingId), JSON.stringify({ decision, previous_status: previousStatus, new_status: newStatus, reason: reason ?? null, vendor_id: listing.vendor_id }), adminUserId),
  ])

  // Buy-box eligibility depends on moderation_status (buybox.ts's
  // recomputeBuyBoxWinner already filters on it) — recompute so an
  // approval/rejection takes effect on customer-facing pages immediately.
  const { recomputeBuyBoxWinner } = await import('./buybox')
  const productRow = await db.prepare('SELECT product_id FROM product_listings WHERE id = ?').bind(listingId).first<{ product_id: number }>()
  if (productRow) await recomputeBuyBoxWinner(db, productRow.product_id)

  return { previousStatus, newStatus }
}

/**
 * Admin-facing: every moderation decision across all vendors, most recent
 * first — the Control Center Moderation screen's "Decision History" panel
 * (Phase-2 Functional Activation, Workstream A quick win). Reads the SAME
 * cc_audit_logs rows applyModerationDecision() already writes; no new
 * table, no parallel history mechanism.
 */
export async function getRecentModerationDecisions(db: D1Database, limit = 50) {
  const { results } = await db
    .prepare(
      `SELECT id, actor_user_id, actor_name_snapshot, entity_id, before_json, after_json, context_json, created_at
       FROM cc_audit_logs
       WHERE action = 'listing_moderation_decision'
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .bind(limit)
    .all()
  return results
}

/** Seller-facing: this vendor's own moderation-decision history, scoped strictly by vendor_id via the listing's context_json — never another seller's. */
export async function getModerationHistoryForVendor(db: D1Database, vendorId: number, limit = 50) {
  const { results } = await db
    .prepare(
      `SELECT * FROM cc_audit_logs
       WHERE action = 'listing_moderation_decision'
         AND json_extract(context_json, '$.vendor_id') = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(vendorId, limit)
    .all()
  return results
}
