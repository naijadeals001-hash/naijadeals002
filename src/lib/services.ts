/**
 * Service Engine 2.0 — Service listing / package / category / area / resource
 * management (spec sections 4, 5, 6, 7, 15, 16, 19).
 *
 * OWNERSHIP RULE (mirrors src/lib/seller-products.ts exactly): every mutating
 * function takes a `providerProfileId` that the CALLER must have already
 * resolved server-side via requireActiveProvider / resolveOrganizationProvider
 * (src/lib/providers.ts) — never a client-supplied value used for
 * authorization. Every write is scoped with `AND provider_profile_id = ?` so
 * a listing belonging to a different provider simply does not match any row.
 */
import type {
  ServiceListingRow,
  ServicePackageRow,
  ServiceAreaRow,
  ServiceResourceRow,
  ServiceAvailabilityHourRow,
  CategoryRow,
  ServiceType,
  ServicePricingModel,
  ServiceListingStatus
} from '../types'
import { enqueueSearchIndexEvent } from './search-index-events'

export class NotOwnedError extends Error {
  constructor(entity: string, id: number) {
    super(`${entity} ${id} not found or not owned by this provider`)
  }
}

/**
 * Engine 11 event writer, called inline after each real write path in this
 * file commits — mirrors seller-products.ts's emitProductSearchEvent()/
 * emitListingSearchEvent() exactly (read updated_at BACK from the row
 * rather than computing a JS-side timestamp; own try/catch so a
 * search-index failure can never break a service-listing write).
 */
async function emitServiceListingSearchEvent(db: D1Database, listingId: number): Promise<void> {
  try {
    const row = await db.prepare('SELECT updated_at FROM service_listings WHERE id = ?').bind(listingId).first<{ updated_at: string }>()
    if (!row) return
    await enqueueSearchIndexEvent(db, { entityType: 'service_listing', entityId: listingId, operation: 'upsert', sourceUpdatedAt: row.updated_at })
  } catch (err) {
    console.error('services: search index event enqueue failed (non-fatal, service listing write already committed)', err)
  }
}

// ---------- Service categories (spec section 4) ----------

/** Top-level service categories — the same `categories` table used by the Marketplace Engine, filtered by the additive category_type discriminator (migration 0039). */
export async function getTopLevelServiceCategories(db: D1Database): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM categories WHERE category_type = 'service' AND parent_id IS NULL ORDER BY sort_order ASC`)
    .all<CategoryRow>()
  return results
}

export async function getServiceSubcategories(db: D1Database, parentSlug: string): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT c.* FROM categories c JOIN categories p ON p.id = c.parent_id
       WHERE p.slug = ? AND c.category_type = 'service' ORDER BY c.sort_order ASC`
    )
    .bind(parentSlug)
    .all<CategoryRow>()
  return results
}

export async function getServiceCategoryBySlug(db: D1Database, slug: string): Promise<CategoryRow | null> {
  return db.prepare(`SELECT * FROM categories WHERE slug = ? AND category_type = 'service'`).bind(slug).first<CategoryRow>()
}

// ---------- Service listings ----------

export interface CreateServiceListingInput {
  category_id: number
  title: string
  description?: string
  service_type?: ServiceType
  pricing_model?: ServicePricingModel
  base_price_kobo?: number | null
  max_price_kobo?: number | null
  currency?: string
  duration_minutes?: number | null
  requirements_json?: string
  media_json?: string
  terms?: string
  cancellation_policy?: string
}

/**
 * Creates a NEW service listing owned by providerProfileId. Starts in
 * status='pending_review' — never auto-published (spec section 52: no fake
 * completion via skipped moderation). pricing_model validated against the
 * spec's enumerated set; base_price_kobo may be NULL only for
 * 'custom_quote'/'negotiable' models (spec section 6).
 */
export async function createServiceListing(db: D1Database, providerProfileId: number, input: CreateServiceListingInput): Promise<number> {
  const pricingModel = input.pricing_model ?? 'fixed'
  const priceOptionalModels = new Set(['custom_quote', 'negotiable'])
  if (!priceOptionalModels.has(pricingModel) && (input.base_price_kobo === undefined || input.base_price_kobo === null || input.base_price_kobo <= 0)) {
    throw new Error(`base_price_kobo is required and must be > 0 for pricing_model '${pricingModel}'`)
  }

  const result = await db
    .prepare(
      `INSERT INTO service_listings
        (provider_profile_id, category_id, title, description, service_type, pricing_model, base_price_kobo, max_price_kobo,
         currency, duration_minutes, requirements_json, media_json, terms, cancellation_policy, is_active, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending_review')`
    )
    .bind(
      providerProfileId,
      input.category_id,
      input.title,
      input.description ?? '',
      input.service_type ?? 'in_person',
      pricingModel,
      input.base_price_kobo ?? null,
      input.max_price_kobo ?? null,
      input.currency ?? 'NGN',
      input.duration_minutes ?? null,
      input.requirements_json ?? '[]',
      input.media_json ?? '[]',
      input.terms ?? '',
      input.cancellation_policy ?? ''
    )
    .run()

  const listingId = Number(result.meta.last_row_id)
  await emitServiceListingSearchEvent(db, listingId)
  return listingId
}

/** Fetches a listing ONLY if owned by providerProfileId — prevents cross-provider enumeration (spec section 43). */
export async function getOwnedServiceListing(db: D1Database, providerProfileId: number, listingId: number): Promise<ServiceListingRow | null> {
  return db
    .prepare('SELECT * FROM service_listings WHERE id = ? AND provider_profile_id = ?')
    .bind(listingId, providerProfileId)
    .first<ServiceListingRow>()
}

export interface UpdateServiceListingInput {
  title?: string
  description?: string
  service_type?: ServiceType
  pricing_model?: ServicePricingModel
  base_price_kobo?: number | null
  max_price_kobo?: number | null
  duration_minutes?: number | null
  requirements_json?: string
  media_json?: string
  terms?: string
  cancellation_policy?: string
  is_active?: boolean
  status?: ServiceListingStatus
}

/**
 * Updates a listing's fields. Ownership enforced by the WHERE clause itself
 * — a mismatched listingId/providerProfileId pair updates 0 rows, treated
 * as 404 by the caller (never leaks existence to another provider).
 */
export async function updateServiceListing(
  db: D1Database,
  providerProfileId: number,
  listingId: number,
  input: UpdateServiceListingInput
): Promise<boolean> {
  const fields: string[] = []
  const binds: unknown[] = []
  const boolFields = new Set(['is_active'])
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    fields.push(`${key} = ?`)
    binds.push(boolFields.has(key) ? (value ? 1 : 0) : value)
  }
  if (fields.length === 0) return true
  fields.push(`updated_at = datetime('now')`)

  // NOTE: D1's result.success means "query executed without a SQL error",
  // NOT "a row was actually changed" — it is true even for a 0-row UPDATE.
  // Relying on it here previously caused a mismatched (listingId,
  // providerProfileId) pair to falsely report success instead of 404.
  // rows_written is the only reliable signal of an actual ownership match.
  const result = await db
    .prepare(`UPDATE service_listings SET ${fields.join(', ')} WHERE id = ? AND provider_profile_id = ?`)
    .bind(...binds, listingId, providerProfileId)
    .run()
  const updated = (result.meta.rows_written ?? 0) > 0
  // Engine 11: only a genuine ownership-matched update may enqueue a
  // re-index signal — a 0-row UPDATE (wrong provider) must not.
  if (updated) await emitServiceListingSearchEvent(db, listingId)
  return updated
}

/** All listings owned by a provider — the provider dashboard "My Services" data source. */
export async function getListingsForProvider(db: D1Database, providerProfileId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT sl.*, c.name AS category_name, c.slug AS category_slug
       FROM service_listings sl
       JOIN categories c ON c.id = sl.category_id
       WHERE sl.provider_profile_id = ?
       ORDER BY sl.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(providerProfileId, limit, offset)
    .all()
  return results
}

/** Public discovery — active/approved listings only, joined with provider + category for the card view. Used by GET /api/services and GET /api/services/:id. */
export async function getPublicServiceListings(
  db: D1Database,
  opts: { categorySlug?: string; city?: string; countryIso?: string; limit?: number; offset?: number } = {}
): Promise<ServiceListingRow[]> {
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0
  const clauses: string[] = [`sl.status = 'active'`, `sl.is_active = 1`, `pp.operational_status = 'active'`]
  const binds: unknown[] = []

  if (opts.categorySlug) {
    clauses.push(`(c.slug = ? OR c.parent_id = (SELECT id FROM categories WHERE slug = ?))`)
    binds.push(opts.categorySlug, opts.categorySlug)
  }
  if (opts.city) {
    clauses.push(`EXISTS (SELECT 1 FROM service_areas sa WHERE sa.provider_profile_id = pp.id AND sa.city = ?)`)
    binds.push(opts.city)
  }
  if (opts.countryIso) {
    clauses.push(`pp.country_iso = ?`)
    binds.push(opts.countryIso)
  }

  binds.push(limit, offset)
  const { results } = await db
    .prepare(
      `SELECT sl.*, c.name AS category_name, c.slug AS category_slug,
              pp.display_name AS provider_display_name, pp.rating_avg AS provider_rating_avg,
              pp.verification_status AS provider_verification_status
       FROM service_listings sl
       JOIN categories c ON c.id = sl.category_id
       JOIN provider_profiles pp ON pp.id = sl.provider_profile_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY sl.rating_count DESC, sl.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds)
    .all<ServiceListingRow>()
  return results
}

export async function getPublicServiceListingById(db: D1Database, listingId: number): Promise<ServiceListingRow | null> {
  return db
    .prepare(
      `SELECT sl.*, c.name AS category_name, c.slug AS category_slug,
              pp.display_name AS provider_display_name, pp.rating_avg AS provider_rating_avg,
              pp.verification_status AS provider_verification_status
       FROM service_listings sl
       JOIN categories c ON c.id = sl.category_id
       JOIN provider_profiles pp ON pp.id = sl.provider_profile_id
       WHERE sl.id = ? AND sl.status = 'active' AND sl.is_active = 1`
    )
    .bind(listingId)
    .first<ServiceListingRow>()
}

// ---------- Service packages (spec section 7) ----------

export interface CreateServicePackageInput {
  title: string
  description?: string
  price_kobo: number
  duration_minutes?: number | null
  included_json?: string
  limits_json?: string
  sort_order?: number
}

/** Creates a package under a listing already verified owned by the caller (call getOwnedServiceListing first). */
export async function createServicePackage(db: D1Database, listingId: number, input: CreateServicePackageInput): Promise<number> {
  if (input.price_kobo <= 0) throw new Error('price_kobo must be > 0')
  const result = await db
    .prepare(
      `INSERT INTO service_packages (service_listing_id, title, description, price_kobo, duration_minutes, included_json, limits_json, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      listingId,
      input.title,
      input.description ?? '',
      input.price_kobo,
      input.duration_minutes ?? null,
      input.included_json ?? '[]',
      input.limits_json ?? '{}',
      input.sort_order ?? 0
    )
    .run()
  return Number(result.meta.last_row_id)
}

export async function getPackagesForListing(db: D1Database, listingId: number): Promise<ServicePackageRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM service_packages WHERE service_listing_id = ? AND is_active = 1 ORDER BY sort_order ASC')
    .bind(listingId)
    .all<ServicePackageRow>()
  return results
}

/** Verifies a package belongs to a listing owned by providerProfileId — the cross-provider guard for package-level mutations. */
export async function getOwnedPackage(db: D1Database, providerProfileId: number, packageId: number): Promise<ServicePackageRow | null> {
  return db
    .prepare(
      `SELECT sp.* FROM service_packages sp
       JOIN service_listings sl ON sl.id = sp.service_listing_id
       WHERE sp.id = ? AND sl.provider_profile_id = ?`
    )
    .bind(packageId, providerProfileId)
    .first<ServicePackageRow>()
}

// ---------- Service areas (spec sections 16 & 17) ----------

export interface CreateServiceAreaInput {
  country_iso?: string
  region?: string | null
  city?: string | null
  neighborhood?: string | null
  radius_km?: number | null
  latitude?: number | null
  longitude?: number | null
  is_online_only?: boolean
}

export async function createServiceArea(db: D1Database, providerProfileId: number, input: CreateServiceAreaInput): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO service_areas (provider_profile_id, country_iso, region, city, neighborhood, radius_km, latitude, longitude, is_online_only)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      providerProfileId,
      input.country_iso ?? 'NG',
      input.region ?? null,
      input.city ?? null,
      input.neighborhood ?? null,
      input.radius_km ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.is_online_only ? 1 : 0
    )
    .run()
  return Number(result.meta.last_row_id)
}

export async function getAreasForProvider(db: D1Database, providerProfileId: number): Promise<ServiceAreaRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM service_areas WHERE provider_profile_id = ? ORDER BY id ASC')
    .bind(providerProfileId)
    .all<ServiceAreaRow>()
  return results
}

// ---------- Service resources & availability (spec sections 14 & 15) ----------

export async function getResourcesForProvider(db: D1Database, providerProfileId: number): Promise<ServiceResourceRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM service_resources WHERE provider_profile_id = ? AND is_active = 1 ORDER BY id ASC')
    .bind(providerProfileId)
    .all<ServiceResourceRow>()
  return results
}

/** Verifies a resource belongs to providerProfileId — the cross-provider guard for availability mutations. */
export async function getOwnedResource(db: D1Database, providerProfileId: number, resourceId: number): Promise<ServiceResourceRow | null> {
  return db
    .prepare('SELECT * FROM service_resources WHERE id = ? AND provider_profile_id = ?')
    .bind(resourceId, providerProfileId)
    .first<ServiceResourceRow>()
}

export interface SetAvailabilityHourInput {
  day_of_week: number
  start_time: string
  end_time: string
  buffer_minutes?: number
}

/** Replaces the weekly recurring hours for one resource (idempotent full-replace, mirrors replacePricingTiers's pattern in pricing.ts). */
export async function replaceAvailabilityHours(db: D1Database, resourceId: number, hours: SetAvailabilityHourInput[]): Promise<void> {
  for (const h of hours) {
    if (h.day_of_week < 0 || h.day_of_week > 6) throw new Error('day_of_week must be 0-6')
    if (h.end_time <= h.start_time) throw new Error('end_time must be after start_time')
  }
  const statements = [db.prepare('DELETE FROM service_availability_hours WHERE resource_id = ?').bind(resourceId)]
  for (const h of hours) {
    statements.push(
      db
        .prepare(
          `INSERT INTO service_availability_hours (resource_id, day_of_week, start_time, end_time, buffer_minutes) VALUES (?, ?, ?, ?, ?)`
        )
        .bind(resourceId, h.day_of_week, h.start_time, h.end_time, h.buffer_minutes ?? 0)
    )
  }
  await db.batch(statements)
}

export async function getAvailabilityHoursForResource(db: D1Database, resourceId: number): Promise<ServiceAvailabilityHourRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM service_availability_hours WHERE resource_id = ? ORDER BY day_of_week ASC, start_time ASC')
    .bind(resourceId)
    .all<ServiceAvailabilityHourRow>()
  return results
}

/**
 * Checks whether [startsAt, endsAt) is free for a given resource: within its
 * recurring working hours for that day-of-week AND not overlapping any
 * existing blocked time / booking (spec section 14: "a booked slot must not
 * be offered to another customer"). Reuses the EXISTING
 * booking_availability_blocks table (migration 0024) rather than a
 * duplicate blocking mechanism.
 */
export async function isResourceAvailable(db: D1Database, resourceId: number, startsAt: string, endsAt: string): Promise<boolean> {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  const dayOfWeek = start.getUTCDay()
  const toHHMM = (d: Date) => d.toISOString().slice(11, 16)

  const withinHours = await db
    .prepare(
      `SELECT 1 FROM service_availability_hours
       WHERE resource_id = ? AND day_of_week = ? AND is_active = 1 AND start_time <= ? AND end_time >= ? LIMIT 1`
    )
    .bind(resourceId, dayOfWeek, toHHMM(start), toHHMM(end))
    .first()
  if (!withinHours) return false

  const overlappingBlock = await db
    .prepare(
      `SELECT 1 FROM booking_availability_blocks
       WHERE resource_id = ? AND blocked_from < ? AND blocked_until > ? LIMIT 1`
    )
    .bind(resourceId, endsAt, startsAt)
    .first()
  if (overlappingBlock) return false

  return true
}
