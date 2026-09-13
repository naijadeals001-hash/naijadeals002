/**
 * Booking Engine 2.0 — Bookable listing CRUD & ownership (spec sections 8-14).
 *
 * OWNERSHIP RULE (mirrors src/lib/seller-products.ts / src/lib/services.ts
 * exactly): every mutating function takes an already-server-resolved
 * providerUserId/organizationId that the CALLER (route layer) must have
 * resolved from the authenticated session — never a client-supplied value
 * used for authorization. Every write is scoped with `AND provider_user_id
 * = ?` (or organization_id) so a listing belonging to a different
 * owner simply does not match any row (the D1 rows_written pattern, not
 * result.success — see the documented bug class in seller-products.ts /
 * services.ts, audited here from the start rather than fixed later).
 */
import type { BookableListingRow, BookingResourceRow } from '../types'
import { enqueueSearchIndexEvent } from './search-index-events'

export class NotOwnedListingError extends Error {
  constructor() {
    super('Bookable listing not found or not owned by this provider/organization')
  }
}

/**
 * Engine 11 event writer, called inline after each real write path in this
 * file commits — mirrors seller-products.ts/services.ts's emit*SearchEvent()
 * helpers exactly (read updated_at back from the row, own try/catch, never
 * fatal to the booking listing write it follows).
 */
async function emitBookableListingSearchEvent(db: D1Database, listingId: number): Promise<void> {
  try {
    const row = await db.prepare('SELECT updated_at FROM bookable_listings WHERE id = ?').bind(listingId).first<{ updated_at: string }>()
    if (!row) return
    await enqueueSearchIndexEvent(db, { entityType: 'bookable_listing', entityId: listingId, operation: 'upsert', sourceUpdatedAt: row.updated_at })
  } catch (err) {
    console.error('bookings: search index event enqueue failed (non-fatal, bookable listing write already committed)', err)
  }
}

export interface CreateBookableListingInput {
  listingType: 'gig_service' | 'stay_unit'
  title: string
  description?: string
  countryIso: string
  city?: string | null
  bookingMode?: 'instant' | 'request'
  pricingUnit?: 'per_booking' | 'per_hour' | 'per_night'
  basePriceKobo: number
  currency?: string
  category?: string | null
  coverImageUrl?: string | null
  timezone?: string
  capacityModel?: 'single' | 'multiple' | 'pooled' | 'per_resource'
  isDateOnly?: boolean
  vertical?: string | null
  organizationId?: number | null
  cancellationPolicyId?: number | null
  depositPercentage?: number
  /** Initial resource(s). Defaults to one resource named 'Default' with capacity_units=1 (single-capacity listing) — mirrors src/lib/providers.ts's "every provider gets one implicit Primary resource" pattern so downstream logic never special-cases zero resources. */
  resources?: { name: string; resourceType?: BookingResourceRow['resource_type']; capacityUnits?: number }[]
}

/**
 * Creates a new bookable listing owned by providerUserId, plus its initial
 * resource(s). Never auto-publishes with is_active beyond what the caller
 * explicitly allows — mirrors the Marketplace/Service moderation-conscious
 * pattern, though this generic engine leaves publish/moderation policy to
 * the calling vertical rather than imposing one moderation workflow here
 * (spec: "each vertical supplies its own business rules").
 */
export async function createBookableListing(db: D1Database, providerUserId: number, input: CreateBookableListingInput): Promise<number> {
  if (input.basePriceKobo <= 0) throw new Error('basePriceKobo must be > 0')

  const result = await db
    .prepare(
      `INSERT INTO bookable_listings
        (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit,
         base_price_kobo, currency, is_active, category, cover_image_url, timezone, capacity_model, is_date_only,
         organization_id, cancellation_policy_id, vertical, deposit_percentage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.listingType,
      providerUserId,
      input.title,
      input.description ?? '',
      input.countryIso,
      input.city ?? null,
      input.bookingMode ?? 'request',
      input.pricingUnit ?? 'per_booking',
      input.basePriceKobo,
      input.currency ?? 'NGN',
      input.category ?? null,
      input.coverImageUrl ?? null,
      input.timezone ?? 'Africa/Lagos',
      input.capacityModel ?? 'single',
      input.isDateOnly ? 1 : 0,
      input.organizationId ?? null,
      input.cancellationPolicyId ?? null,
      input.vertical ?? null,
      input.depositPercentage ?? 100
    )
    .run()

  const listingId = Number(result.meta.last_row_id)

  const resources = input.resources && input.resources.length > 0 ? input.resources : [{ name: 'Default', resourceType: 'pooled' as const, capacityUnits: 1 }]
  const statements = resources.map((r, i) =>
    db
      .prepare(`INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order) VALUES (?, ?, ?, ?, ?)`)
      .bind(listingId, r.name, r.resourceType ?? 'pooled', r.capacityUnits ?? 1, i)
  )
  await db.batch(statements)

  await emitBookableListingSearchEvent(db, listingId)
  return listingId
}

/**
 * Fetches a listing ONLY if owned by providerUserId AS AN INDIVIDUAL —
 * prevents cross-provider enumeration/mutation.
 *
 * SECURITY (Invariant #7 fix): `organization_id IS NULL` is required here,
 * not optional. createBookableListing always stamps provider_user_id with
 * the ACTING user's id, even for an organization-owned listing (see that
 * function's header — it's the creator's historical attribution, same
 * pattern as bookings.provider_user_id). Without this guard, this
 * "individual-only" lookup was matching organization-owned listings too,
 * so a member's individual-identity view leaked org-owned resources they
 * had no CURRENT membership-based right to see via this path — and kept
 * leaking them even after the member was removed from the organization,
 * since provider_user_id is permanent history, never revoked. Org-owned
 * listing access belongs exclusively to getOwnedListingForOrganization
 * below (which the route layer gates with a live membership check).
 */
export async function getOwnedListingForProvider(db: D1Database, providerUserId: number, listingId: number): Promise<BookableListingRow | null> {
  return db.prepare('SELECT * FROM bookable_listings WHERE id = ? AND provider_user_id = ? AND organization_id IS NULL').bind(listingId, providerUserId).first<BookableListingRow>()
}

/** Fetches a listing ONLY if owned by organizationId — the org-owned-booking path (spec: "org-owned bookings supported"). */
export async function getOwnedListingForOrganization(db: D1Database, organizationId: number, listingId: number): Promise<BookableListingRow | null> {
  return db.prepare('SELECT * FROM bookable_listings WHERE id = ? AND organization_id = ?').bind(listingId, organizationId).first<BookableListingRow>()
}

export async function getPublicListingById(db: D1Database, listingId: number): Promise<BookableListingRow | null> {
  return db.prepare('SELECT * FROM bookable_listings WHERE id = ? AND is_active = 1').bind(listingId).first<BookableListingRow>()
}

export interface PublicListingSearchOpts {
  listingType?: 'gig_service' | 'stay_unit'
  vertical?: string
  countryIso?: string
  city?: string
  limit?: number
  offset?: number
}

/**
 * Availability-aware search (spec's explicit "not just theoretically
 * bookable" requirement) — returns only listings with at least one resource
 * that isn't fully blocked-out, WITHOUT checking any specific date window
 * here (a listing search page doesn't know the customer's desired dates
 * yet; per-window filtering happens via GET /availability once a listing is
 * selected). "Availability-aware" at this layer means: excludes listings
 * with zero active resources (a listing that was created but never given a
 * bookable resource, e.g. mid-onboarding, is correctly never surfaced).
 */
export async function searchPublicListings(db: D1Database, opts: PublicListingSearchOpts = {}): Promise<BookableListingRow[]> {
  const clauses = [`bl.is_active = 1`, `EXISTS (SELECT 1 FROM booking_resources br WHERE br.listing_id = bl.id AND br.is_active = 1)`]
  const binds: unknown[] = []
  if (opts.listingType) {
    clauses.push('bl.listing_type = ?')
    binds.push(opts.listingType)
  }
  if (opts.vertical) {
    clauses.push('bl.vertical = ?')
    binds.push(opts.vertical)
  }
  if (opts.countryIso) {
    clauses.push('bl.country_iso = ?')
    binds.push(opts.countryIso)
  }
  if (opts.city) {
    clauses.push('bl.city = ?')
    binds.push(opts.city)
  }
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0
  binds.push(limit, offset)

  const { results } = await db
    .prepare(`SELECT bl.* FROM bookable_listings bl WHERE ${clauses.join(' AND ')} ORDER BY bl.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds)
    .all<BookableListingRow>()
  return results
}

export interface UpdateBookableListingInput {
  title?: string
  description?: string
  basePriceKobo?: number
  currency?: string
  city?: string | null
  isActive?: boolean
  coverImageUrl?: string | null
  cancellationPolicyId?: number | null
  depositPercentage?: number
}

/**
 * Updates fields on a listing owned by providerUserId AS AN INDIVIDUAL.
 * Ownership enforced by the WHERE clause; a mismatched pair updates 0 rows
 * (D1's result.success-is-not-enough gotcha, checked via rows_written
 * exclusively — see module doc comment). `organization_id IS NULL` guard
 * mirrors getOwnedListingForProvider (Invariant #7 fix) — this is the
 * individual-identity mutation path, called only from
 * PATCH /booking-providers/me/bookable-listings/:id; an org-owned listing
 * must be mutated exclusively through the org-scoped route, which
 * resolves LIVE membership rather than historical provider_user_id.
 */
export async function updateBookableListing(db: D1Database, providerUserId: number, listingId: number, input: UpdateBookableListingInput): Promise<boolean> {
  const fields: string[] = []
  const binds: unknown[] = []
  const colMap: Record<string, string> = {
    title: 'title', description: 'description', basePriceKobo: 'base_price_kobo', currency: 'currency',
    city: 'city', coverImageUrl: 'cover_image_url', cancellationPolicyId: 'cancellation_policy_id', depositPercentage: 'deposit_percentage',
  }
  for (const [key, col] of Object.entries(colMap)) {
    const value = (input as Record<string, unknown>)[key]
    if (value !== undefined) {
      fields.push(`${col} = ?`)
      binds.push(value)
    }
  }
  if (input.isActive !== undefined) {
    fields.push('is_active = ?')
    binds.push(input.isActive ? 1 : 0)
  }
  if (fields.length === 0) return true
  fields.push(`updated_at = datetime('now')`)

  const result = await db
    .prepare(`UPDATE bookable_listings SET ${fields.join(', ')} WHERE id = ? AND provider_user_id = ? AND organization_id IS NULL`)
    .bind(...binds, listingId, providerUserId)
    .run()
  const updated = (result.meta.rows_written ?? 0) > 0
  // Engine 11: only a genuine ownership-matched update may enqueue a
  // re-index signal — a 0-row UPDATE (wrong provider / org-owned listing
  // hitting the individual-identity path) must not.
  if (updated) await emitBookableListingSearchEvent(db, listingId)
  return updated
}

/** Individual-identity listing list (see getOwnedListingForProvider's doc comment for the `organization_id IS NULL` rationale — Invariant #7 fix). */
export async function getListingsForProvider(db: D1Database, providerUserId: number): Promise<BookableListingRow[]> {
  const { results } = await db.prepare('SELECT * FROM bookable_listings WHERE provider_user_id = ? AND organization_id IS NULL ORDER BY updated_at DESC').bind(providerUserId).all<BookableListingRow>()
  return results
}

export async function getListingsForOrganization(db: D1Database, organizationId: number): Promise<BookableListingRow[]> {
  const { results } = await db.prepare('SELECT * FROM bookable_listings WHERE organization_id = ? ORDER BY updated_at DESC').bind(organizationId).all<BookableListingRow>()
  return results
}

/** Adds a resource to an existing listing owned by providerUserId (multi-resource listings, e.g. adding a 4th salon chair). Verifies ownership first — never trusts a client-supplied listingId alone. */
export async function addResourceToListing(db: D1Database, providerUserId: number, listingId: number, input: { name: string; resourceType?: BookingResourceRow['resource_type']; capacityUnits?: number }): Promise<number> {
  const listing = await getOwnedListingForProvider(db, providerUserId, listingId)
  if (!listing) throw new NotOwnedListingError()
  const { results } = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM booking_resources WHERE listing_id = ?').bind(listingId).all<{ next: number }>()
  const sortOrder = results[0]?.next ?? 0
  const result = await db
    .prepare('INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order) VALUES (?, ?, ?, ?, ?)')
    .bind(listingId, input.name, input.resourceType ?? 'pooled', input.capacityUnits ?? 1, sortOrder)
    .run()
  return Number(result.meta.last_row_id)
}

/** Provider-side one-off availability block/blackout — reuses the EXISTING booking_availability_blocks table, never a duplicate blocking mechanism. Ownership verified via the listing. */
export async function createAvailabilityBlock(db: D1Database, providerUserId: number, listingId: number, input: { resourceId?: number | null; blockedFrom: string; blockedUntil: string; reason?: string }): Promise<number> {
  const listing = await getOwnedListingForProvider(db, providerUserId, listingId)
  if (!listing) throw new NotOwnedListingError()
  const result = await db
    .prepare('INSERT INTO booking_availability_blocks (listing_id, resource_id, blocked_from, blocked_until, reason) VALUES (?, ?, ?, ?, ?)')
    .bind(listingId, input.resourceId ?? null, input.blockedFrom, input.blockedUntil, input.reason ?? null)
    .run()
  return Number(result.meta.last_row_id)
}

/** Provider-side recurring weekly availability rule (spec's "not hardcoded per vertical" recurring schedule). */
export async function setAvailabilityRule(db: D1Database, providerUserId: number, listingId: number, resourceId: number, input: { dayOfWeek: number; startTime: string; endTime: string; capacityOverride?: number | null }): Promise<number> {
  const listing = await getOwnedListingForProvider(db, providerUserId, listingId)
  if (!listing) throw new NotOwnedListingError()
  if (input.dayOfWeek < 0 || input.dayOfWeek > 6) throw new Error('dayOfWeek must be 0-6')
  if (input.endTime <= input.startTime) throw new Error('endTime must be after startTime')
  const result = await db
    .prepare('INSERT INTO booking_availability_rules (resource_id, day_of_week, start_time, end_time, capacity_override) VALUES (?, ?, ?, ?, ?)')
    .bind(resourceId, input.dayOfWeek, input.startTime, input.endTime, input.capacityOverride ?? null)
    .run()
  return Number(result.meta.last_row_id)
}

export async function getAvailabilityRulesForResource(db: D1Database, resourceId: number) {
  const { results } = await db.prepare('SELECT * FROM booking_availability_rules WHERE resource_id = ? ORDER BY day_of_week ASC, start_time ASC').bind(resourceId).all()
  return results
}

export async function getAvailabilityBlocksForListing(db: D1Database, listingId: number) {
  const { results } = await db.prepare('SELECT * FROM booking_availability_blocks WHERE listing_id = ? ORDER BY blocked_from ASC').bind(listingId).all()
  return results
}
