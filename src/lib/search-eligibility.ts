/**
 * Engine 11 (Search & Discovery), Phase 1 — shared two-level visibility
 * eligibility helper.
 *
 * WHY THIS EXISTS (see docs/ENGINE-11-SEARCH-DISCOVERY-AUDIT.md §4): the
 * Phase 0 audit found searchPublicListings() (src/lib/bookings.ts)
 * performs ZERO owner-status checking — it only checks
 * bl.is_active/resource-existence, never the owning provider/org's
 * current standing. This is a PRE-EXISTING correctness gap, not new
 * Engine 11 scope, and the user's explicit Phase 1 mandate is to fix it
 * HERE, in one centralized helper, BEFORE any FTS5 indexer exists —
 * never compensated for inside search_index_events itself (event
 * writers stay "dumb": thin pointers only, per migration 0047's header).
 *
 * CORRECTION TO THE ORIGINAL AUDIT ASSUMPTION (found during this unit's
 * implementation, evidence-based): the audit's §4 wording suggested the
 * missing join was against `provider_profiles.operational_status`. Direct
 * schema/data inspection this session shows bookable_listings.
 * provider_user_id references users(id) DIRECTLY — a LEFT JOIN against
 * provider_profiles.user_id returns zero matches for real
 * bookable_listings owners (provider_profiles is the gig_provider-
 * specific profile used by services.ts's service_listings, a SEPARATE
 * vertical). The actually-correct two-level check for a bookable_listing
 * is: (a) its own is_active, and (b) EITHER the owning organization's
 * status/verification_status (organization_id IS NOT NULL — 233 of 1501
 * real rows) OR the owning individual user's status (organization_id IS
 * NULL — 1327 of 1501 real rows). Building on the wrong assumption here
 * would have produced a helper that always fails open (no provider_
 * profiles row ever matches) or always fails closed — neither is
 * correct. This corrected relationship is used below instead.
 *
 * DESIGN: pure, read-only, single-purpose eligibility CHECKS — this
 * module does NOT decide indexing timing, does NOT write anything, and
 * does NOT know about search_index_events at all. It is deliberately
 * the single place all "is this entity's OWNER currently allowed to
 * operate" logic lives, reusing the SAME status dimensions already
 * established and enforced elsewhere in this codebase (seller.ts's
 * resolveSellerStatus, providers.ts's resolveProviderStatus) rather than
 * inventing new business rules — a listing whose owner is not
 * "currently active" by the SAME definition used to gate that owner's
 * own dashboard access must not be searchable either.
 *
 * TWO-LEVEL RULE (identical structure across all 4 entity types):
 *   eligible = entity.own_visibility_field_is_published
 *              AND owner.current_operational_standing_is_active
 *
 * A future Phase 2 indexer calls isEntitySearchEligible() at processing
 * time (never at enqueue time — see search-index-events.ts's module doc
 * comment: event writers are thin pointers, the indexer always re-reads
 * canonical state) to decide whether a search_index_events 'upsert' row
 * should add/update the FTS corpus or remove an existing entry (e.g. the
 * owner was suspended after the entity was indexed).
 */

export type SearchEntityType = 'product' | 'product_listing' | 'service_listing' | 'bookable_listing'

export interface EligibilityResult {
  eligible: boolean
  /** Human-readable reason codes for observability/debugging — never exposed to end users, purely internal. */
  reasons: string[]
}

function ineligible(...reasons: string[]): EligibilityResult {
  return { eligible: false, reasons }
}

const ELIGIBLE: EligibilityResult = { eligible: true, reasons: [] }

/**
 * product: canonical, shared catalog entry (NOT owned by a single
 * vendor — sold via one or more product_listings, each with its own
 * vendor). Eligibility at the PRODUCT level is therefore its own
 * publication state only; per-listing (price/stock/vendor-standing)
 * eligibility is a SEPARATE check via checkProductListingEligibility.
 * A product with zero eligible listings is still a valid canonical
 * catalog entry — "not currently buyable from anyone" is a listing-level
 * fact, not a reason to hide the product record itself from an
 * indexer's perspective (the Phase 2 indexer/ranking layer decides
 * whether to surface a product with zero eligible listings at all —
 * out of Phase 1's scope, which only decides raw entity eligibility).
 */
export async function checkProductEligibility(db: D1Database, productId: number): Promise<EligibilityResult> {
  const row = await db
    .prepare('SELECT is_active, moderation_status FROM products WHERE id = ?')
    .bind(productId)
    .first<{ is_active: number; moderation_status: string }>()
  if (!row) return ineligible('product_not_found')
  const reasons: string[] = []
  if (row.is_active !== 1) reasons.push('product_is_active_false')
  if (row.moderation_status !== 'active') reasons.push(`product_moderation_status_${row.moderation_status}`)
  return reasons.length > 0 ? ineligible(...reasons) : ELIGIBLE
}

/**
 * product_listing: two-level check — (a) the listing's OWN is_active +
 * moderation_status, AND (b) the owning vendor's CURRENT standing, using
 * the EXACT same dimensions seller.ts's resolveSellerStatus already
 * treats as "this seller cannot operate right now"
 * (store_status='suspended' OR verification_status IN ('suspended',
 * 'rejected')). Also requires the PARENT product to be eligible — a
 * listing for a hidden/rejected canonical product must not surface
 * either, even if the listing row itself looks fine in isolation.
 */
export async function checkProductListingEligibility(db: D1Database, listingId: number): Promise<EligibilityResult> {
  const row = await db
    .prepare(
      `SELECT pl.is_active as listing_active, pl.moderation_status as listing_moderation, pl.product_id,
              v.store_status, v.verification_status
       FROM product_listings pl
       JOIN vendors v ON v.id = pl.vendor_id
       WHERE pl.id = ?`
    )
    .bind(listingId)
    .first<{ listing_active: number; listing_moderation: string; product_id: number; store_status: string; verification_status: string }>()
  if (!row) return ineligible('product_listing_not_found')

  const reasons: string[] = []
  if (row.listing_active !== 1) reasons.push('listing_is_active_false')
  if (row.listing_moderation !== 'active') reasons.push(`listing_moderation_status_${row.listing_moderation}`)
  if (row.store_status === 'suspended') reasons.push('vendor_store_status_suspended')
  if (row.verification_status === 'suspended' || row.verification_status === 'rejected') {
    reasons.push(`vendor_verification_status_${row.verification_status}`)
  }

  const productEligibility = await checkProductEligibility(db, row.product_id)
  if (!productEligibility.eligible) reasons.push(...productEligibility.reasons.map((r) => `parent_${r}`))

  return reasons.length > 0 ? ineligible(...reasons) : ELIGIBLE
}

/**
 * service_listing: two-level check — (a) the listing's OWN is_active +
 * status, AND (b) the owning provider_profiles row's CURRENT standing,
 * using the EXACT same dimension providers.ts's resolveProviderStatus
 * treats as disqualifying (operational_status='suspended'), plus
 * verification_status='rejected' (mirrors the vendor rule's rejected
 * check — a rejected provider is not merely "not yet verified", they
 * were explicitly denied and must not surface in search either).
 */
export async function checkServiceListingEligibility(db: D1Database, listingId: number): Promise<EligibilityResult> {
  const row = await db
    .prepare(
      `SELECT sl.is_active as listing_active, sl.status as listing_status,
              pp.operational_status, pp.verification_status
       FROM service_listings sl
       JOIN provider_profiles pp ON pp.id = sl.provider_profile_id
       WHERE sl.id = ?`
    )
    .bind(listingId)
    .first<{ listing_active: number; listing_status: string; operational_status: string; verification_status: string }>()
  if (!row) return ineligible('service_listing_not_found')

  const reasons: string[] = []
  if (row.listing_active !== 1) reasons.push('listing_is_active_false')
  if (row.listing_status !== 'active') reasons.push(`listing_status_${row.listing_status}`)
  if (row.operational_status === 'suspended') reasons.push('provider_operational_status_suspended')
  if (row.verification_status === 'rejected') reasons.push('provider_verification_status_rejected')

  return reasons.length > 0 ? ineligible(...reasons) : ELIGIBLE
}

/**
 * bookable_listing: two-level check — (a) the listing's OWN is_active,
 * AND (b) the owner's CURRENT standing, where "owner" is EITHER the
 * owning organization (organization_id IS NOT NULL — checked via
 * organizations.status/verification_status) OR the individual creator
 * user (organization_id IS NULL — checked via users.status). See this
 * module's header comment for why provider_profiles is NOT the correct
 * join here (confirmed zero matches against real data this session).
 */
export async function checkBookableListingEligibility(db: D1Database, listingId: number): Promise<EligibilityResult> {
  const row = await db
    .prepare('SELECT is_active, provider_user_id, organization_id FROM bookable_listings WHERE id = ?')
    .bind(listingId)
    .first<{ is_active: number; provider_user_id: number; organization_id: number | null }>()
  if (!row) return ineligible('bookable_listing_not_found')

  const reasons: string[] = []
  if (row.is_active !== 1) reasons.push('listing_is_active_false')

  if (row.organization_id !== null) {
    const org = await db
      .prepare('SELECT status, verification_status FROM organizations WHERE id = ?')
      .bind(row.organization_id)
      .first<{ status: string; verification_status: string }>()
    if (!org) {
      reasons.push('owning_organization_not_found')
    } else {
      if (org.status === 'suspended' || org.status === 'disabled') reasons.push(`organization_status_${org.status}`)
      if (org.verification_status === 'rejected' || org.verification_status === 'suspended') {
        reasons.push(`organization_verification_status_${org.verification_status}`)
      }
    }
  } else {
    const user = await db
      .prepare('SELECT status FROM users WHERE id = ?')
      .bind(row.provider_user_id)
      .first<{ status: string }>()
    if (!user) {
      reasons.push('owning_user_not_found')
    } else if (user.status === 'suspended' || user.status === 'disabled' || user.status === 'deleted') {
      reasons.push(`owner_user_status_${user.status}`)
    }
  }

  return reasons.length > 0 ? ineligible(...reasons) : ELIGIBLE
}

/**
 * Single dispatch entry point — a future Phase 2 indexer calls this at
 * processing time with the entity_type/entity_id it read off a
 * search_index_events row, and NEVER makes an eligibility decision any
 * other way. This is the ONE function the rest of Engine 11 should
 * import once the indexer exists.
 */
export async function isEntitySearchEligible(db: D1Database, entityType: SearchEntityType, entityId: number): Promise<EligibilityResult> {
  switch (entityType) {
    case 'product':
      return checkProductEligibility(db, entityId)
    case 'product_listing':
      return checkProductListingEligibility(db, entityId)
    case 'service_listing':
      return checkServiceListingEligibility(db, entityId)
    case 'bookable_listing':
      return checkBookableListingEligibility(db, entityId)
  }
}
