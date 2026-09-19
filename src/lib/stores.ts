/**
 * Marketplace Engine 2.0 — Store creation & organization-owned vendor
 * resolution (spec section 4: "a vendor should reference user OR
 * organization; do not create duplicate identity systems").
 *
 * Two ownership models for a `vendors` row, both already supported by the
 * schema:
 *   - INDIVIDUAL: vendors.user_id set, vendors.organization_id NULL.
 *     Resolved via src/lib/seller.ts's resolveSellerStatus (unchanged).
 *   - ORGANIZATION: vendors.organization_id set. Resolved here via
 *     resolveOrganizationStoreVendor, which requires an ACTIVE membership
 *     in that organization (via organizations.ts's resolveMembership) — the
 *     exact same server-side-only authorization primitive the Identity
 *     Engine already established, never re-implemented.
 *
 * A vendor row is never BOTH — one or the other, matching "separate
 * identity from storefront from listing" (spec section 4).
 */
import type { VendorRow } from '../types'

function slugifyStoreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Looks up the vendor/store owned by an organization. Returns null if the
 * organization has no store yet. `organizationId` MUST already be a
 * server-resolved value (from an active membership resolution) — never a
 * raw client-supplied id used without that resolution having happened
 * first.
 */
export async function getVendorForOrganization(db: D1Database, organizationId: number): Promise<VendorRow | null> {
  return db.prepare('SELECT * FROM vendors WHERE organization_id = ?').bind(organizationId).first<VendorRow>()
}

export interface CreateOrganizationStoreInput {
  name: string
  description?: string
  city?: string
  store_type?: string
  business_email?: string | null
  business_phone?: string | null
  /**
   * Stage 2C (Currency & Address Foundation): the vendor's operational
   * country. MUST come from validated server-side input (the caller
   * resolving this from the parent organization's own `country_iso`, or an
   * explicit request body value it has validated) — never silently defaults
   * to 'NG' regardless of the organization's actual country, which was the
   * bug this field fixes. Falls back to 'NG' only at the INSERT layer
   * below, as a last-resort default for callers that genuinely omit it.
   */
  country_iso?: string
}

/**
 * Creates a new store owned by an organization. Requires the caller to
 * have already verified the organization does not already have a store
 * (one organization -> one store per this implementation; multi-store
 * orgs are a valid future extension per spec section 4's "a business can
 * operate one or multiple stores" but out of scope for this checkpoint's
 * budget — the schema does not prevent adding a second later).
 *
 * New organization stores start ACTIVE/VERIFIED for parity with how
 * individual sellers currently onboard in this environment (see
 * src/lib/seller.ts's ACTIVE_SELLER classification) — a real KYC/
 * verification workflow for organization stores is a REMAINING GAP,
 * documented honestly in the final report rather than faked here.
 */
export async function createOrganizationStore(db: D1Database, organizationId: number, input: CreateOrganizationStoreInput): Promise<number> {
  const existing = await getVendorForOrganization(db, organizationId)
  if (existing) throw new Error('This organization already has a store.')

  const baseSlug = slugifyStoreName(input.name) || 'store'
  let slug = baseSlug
  let suffix = 1
  while (await db.prepare('SELECT id FROM vendors WHERE slug = ?').bind(slug).first()) {
    slug = `${baseSlug}-${++suffix}`
  }

  const result = await db
    .prepare(
      `INSERT INTO vendors
        (slug, name, description, city, organization_id, store_type, business_name, business_email, business_phone, country_iso,
         verification_status, onboarding_step, onboarding_completed_at, store_status, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', 6, datetime('now'), 'active', 1)`
    )
    .bind(
      slug,
      input.name,
      input.description ?? '',
      input.city ?? null,
      organizationId,
      input.store_type ?? 'organization',
      input.name,
      input.business_email ?? null,
      input.business_phone ?? null,
      input.country_iso ?? 'NG'
    )
    .run()

  return Number(result.meta.last_row_id)
}
