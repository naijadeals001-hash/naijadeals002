/**
 * Service Engine 2.0 — Service requests, provider matching, and quotes
 * (spec sections 8, 9, 10, 11).
 *
 * OWNERSHIP RULES:
 *  - A service_requests row belongs to its customer_user_id — every
 *    customer-facing read/write here is scoped `AND customer_user_id = ?`,
 *    making "Customer A cannot read Customer B's request" true by
 *    construction (spec section 43).
 *  - A service_quotes row belongs to its provider_profile_id for WRITE
 *    purposes (only the quoting provider may edit/withdraw their own
 *    quote), but is READABLE by the request's owning customer once sent —
 *    quote comparison requires the customer to see all quotes on their
 *    own request. "Provider A cannot read Provider B's quote on a request
 *    neither of them owns the customer side of" is enforced by never
 *    exposing quotes across providers in the PROVIDER-facing endpoints
 *    (getQuotesSentByProvider is scoped by provider_profile_id).
 */
import type { ServiceRequestRow, ServiceQuoteRow, ServiceRequestStatus, ServiceUrgency, ServiceQuoteStatus } from '../types'

export class NotOwnedError extends Error {
  constructor(entity: string, id: number) {
    super(`${entity} ${id} not found or not owned by this user`)
  }
}

export class QuoteStateError extends Error {}

function generateRequestNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `SR-${ts}-${rand}`
}

// ---------- Service requests (spec section 8) ----------

export interface CreateServiceRequestInput {
  category_id: number
  service_listing_id?: number | null
  title: string
  description?: string
  country_iso?: string
  city?: string | null
  address_line1?: string | null
  latitude?: number | null
  longitude?: number | null
  preferred_date?: string | null
  preferred_time?: string | null
  budget_kobo?: number | null
  urgency?: ServiceUrgency
  requirements?: { key: string; label: string; value: string | null }[]
  attachment_urls?: string[]
}

export async function createServiceRequest(db: D1Database, customerUserId: number, input: CreateServiceRequestInput): Promise<number> {
  const requestNumber = generateRequestNumber()
  const result = await db
    .prepare(
      `INSERT INTO service_requests
        (request_number, customer_user_id, category_id, service_listing_id, title, description, country_iso, city,
         address_line1, latitude, longitude, preferred_date, preferred_time, budget_kobo, urgency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`
    )
    .bind(
      requestNumber,
      customerUserId,
      input.category_id,
      input.service_listing_id ?? null,
      input.title,
      input.description ?? '',
      input.country_iso ?? 'NG',
      input.city ?? null,
      input.address_line1 ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.preferred_date ?? null,
      input.preferred_time ?? null,
      input.budget_kobo ?? null,
      input.urgency ?? 'normal'
    )
    .run()

  const requestId = Number(result.meta.last_row_id)

  const statements = []
  for (const req of input.requirements ?? []) {
    statements.push(
      db
        .prepare(`INSERT OR IGNORE INTO service_request_requirements (service_request_id, key, label, value) VALUES (?, ?, ?, ?)`)
        .bind(requestId, req.key, req.label, req.value ?? null)
    )
  }
  for (const url of input.attachment_urls ?? []) {
    statements.push(db.prepare(`INSERT INTO service_request_attachments (service_request_id, url) VALUES (?, ?)`).bind(requestId, url))
  }
  if (statements.length > 0) await db.batch(statements)

  return requestId
}

/** Fetches a request ONLY if owned by customerUserId — the "does not exist for you" pattern (spec section 43). */
export async function getOwnedServiceRequest(db: D1Database, customerUserId: number, requestId: number): Promise<ServiceRequestRow | null> {
  return db
    .prepare('SELECT * FROM service_requests WHERE id = ? AND customer_user_id = ?')
    .bind(requestId, customerUserId)
    .first<ServiceRequestRow>()
}

export async function getRequestsForCustomer(db: D1Database, customerUserId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT sr.*, c.name AS category_name, c.slug AS category_slug
       FROM service_requests sr
       JOIN categories c ON c.id = sr.category_id
       WHERE sr.customer_user_id = ?
       ORDER BY sr.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(customerUserId, limit, offset)
    .all()
  return results
}

export async function getRequirementsForRequest(db: D1Database, requestId: number) {
  const { results } = await db.prepare('SELECT * FROM service_request_requirements WHERE service_request_id = ?').bind(requestId).all()
  return results
}

export async function getAttachmentsForRequest(db: D1Database, requestId: number) {
  const { results } = await db.prepare('SELECT * FROM service_request_attachments WHERE service_request_id = ?').bind(requestId).all()
  return results
}

async function updateRequestStatus(db: D1Database, requestId: number, status: ServiceRequestStatus): Promise<void> {
  await db.prepare(`UPDATE service_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, requestId).run()
}

// ---------- Provider matching (spec section 9) ----------

/**
 * Extensible matching layer — intentionally simple for this build (category
 * + location + verification + rating), NOT one hard-coded ranking formula.
 * Returns candidate providers a customer's request could be broadcast to /
 * or that a provider searching for open requests would see. Aura AI may
 * eventually replace/augment this function's internals without changing its
 * signature (spec section 9/37).
 */
export async function findMatchingProviders(db: D1Database, requestId: number, limit = 20) {
  const request = await db.prepare('SELECT * FROM service_requests WHERE id = ?').bind(requestId).first<ServiceRequestRow>()
  if (!request) return []

  const { results } = await db
    .prepare(
      `SELECT pp.id, pp.display_name, pp.rating_avg, pp.rating_count, pp.verification_status, pp.country_iso,
              sl.id AS service_listing_id, sl.title AS service_listing_title, sl.base_price_kobo, sl.pricing_model
       FROM provider_profiles pp
       JOIN service_listings sl ON sl.provider_profile_id = pp.id
       WHERE sl.category_id = ? AND sl.status = 'active' AND sl.is_active = 1
         AND pp.operational_status = 'active' AND pp.country_iso = ?
       ORDER BY pp.verification_status = 'verified' DESC, pp.rating_avg DESC, pp.rating_count DESC
       LIMIT ?`
    )
    .bind(request.category_id, request.country_iso, limit)
    .all()

  if (results.length > 0) await updateRequestStatus(db, requestId, 'matching')
  return results
}

/** Open ("broadcast") requests a provider can see and quote on for their category — never exposes a request's private customer contact details (spec section 28: don't expose private contact info unnecessarily). */
export async function getOpenRequestsForProvider(db: D1Database, providerCategoryId: number | null, countryIso: string, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const clauses = [`sr.status IN ('submitted', 'matching')`, `sr.country_iso = ?`]
  const binds: unknown[] = [countryIso]
  if (providerCategoryId) {
    clauses.push('sr.category_id = ?')
    binds.push(providerCategoryId)
  }
  binds.push(limit, offset)
  const { results } = await db
    .prepare(
      `SELECT sr.id, sr.request_number, sr.title, sr.description, sr.city, sr.preferred_date, sr.preferred_time,
              sr.budget_kobo, sr.urgency, sr.status, sr.created_at, c.name AS category_name
       FROM service_requests sr
       JOIN categories c ON c.id = sr.category_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY sr.urgency = 'emergency' DESC, sr.urgency = 'urgent' DESC, sr.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds)
    .all()
  return results
}

// ---------- Quotes (spec sections 10 & 11) ----------

export interface CreateQuoteInput {
  price_kobo: number
  currency?: string
  estimated_duration_minutes?: number | null
  proposed_date?: string | null
  proposed_time?: string | null
  scope?: string
  materials_included?: boolean
  travel_fee_kobo?: number
  notes?: string
  expires_at?: string | null
}

/**
 * Creates a quote from providerProfileId on a request. If the SAME provider
 * already has an active (sent/viewed) quote on this request, the new quote
 * is linked via supersedes_quote_id and the old one is marked 'withdrawn' —
 * NEVER silently overwritten in place (spec section 11's explicit
 * requirement). providerProfileId must be server-resolved by the caller,
 * never client-supplied.
 */
export async function createQuote(db: D1Database, providerProfileId: number, requestId: number, input: CreateQuoteInput): Promise<number> {
  if (input.price_kobo <= 0) throw new Error('price_kobo must be > 0')

  const request = await db.prepare('SELECT * FROM service_requests WHERE id = ?').bind(requestId).first<ServiceRequestRow>()
  if (!request) throw new NotOwnedError('ServiceRequest', requestId)
  if (['completed', 'cancelled', 'disputed'].includes(request.status)) {
    throw new QuoteStateError(`Cannot quote on a request that is already ${request.status}`)
  }

  const previousQuote = await db
    .prepare(
      `SELECT * FROM service_quotes WHERE service_request_id = ? AND provider_profile_id = ? AND status IN ('draft','sent','viewed') ORDER BY version DESC LIMIT 1`
    )
    .bind(requestId, providerProfileId)
    .first<ServiceQuoteRow>()

  const version = previousQuote ? previousQuote.version + 1 : 1

  const result = await db
    .prepare(
      `INSERT INTO service_quotes
        (service_request_id, provider_profile_id, price_kobo, currency, estimated_duration_minutes, proposed_date, proposed_time,
         scope, materials_included, travel_fee_kobo, notes, status, expires_at, version, supersedes_quote_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?)`
    )
    .bind(
      requestId,
      providerProfileId,
      input.price_kobo,
      input.currency ?? 'NGN',
      input.estimated_duration_minutes ?? null,
      input.proposed_date ?? null,
      input.proposed_time ?? null,
      input.scope ?? '',
      input.materials_included ? 1 : 0,
      input.travel_fee_kobo ?? 0,
      input.notes ?? '',
      input.expires_at ?? null,
      version,
      previousQuote?.id ?? null
    )
    .run()

  const quoteId = Number(result.meta.last_row_id)

  if (previousQuote) {
    await db.prepare(`UPDATE service_quotes SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?`).bind(previousQuote.id).run()
  }

  if (request.status === 'submitted' || request.status === 'matching') {
    await updateRequestStatus(db, requestId, 'quoted')
  }

  return quoteId
}

/** All (non-withdrawn-superseded-noise) quotes on a request, newest version per provider first — the customer's "compare quotes" data source. Scoped by requestId + verified customer ownership by the CALLER before invoking this. */
export async function getQuotesForRequest(db: D1Database, requestId: number): Promise<ServiceQuoteRow[]> {
  const { results } = await db
    .prepare(
      `SELECT sq.*, pp.display_name AS provider_display_name, pp.rating_avg AS provider_rating_avg
       FROM service_quotes sq
       JOIN provider_profiles pp ON pp.id = sq.provider_profile_id
       WHERE sq.service_request_id = ? AND sq.status != 'withdrawn'
       ORDER BY sq.created_at DESC`
    )
    .bind(requestId)
    .all<ServiceQuoteRow>()
  return results
}

/** A specific quote, scoped to belonging to a request owned by customerUserId — prevents a customer from reading/acting on a quote for someone else's request by guessing a quote id. */
export async function getQuoteForCustomer(db: D1Database, customerUserId: number, quoteId: number): Promise<ServiceQuoteRow | null> {
  return db
    .prepare(
      `SELECT sq.* FROM service_quotes sq
       JOIN service_requests sr ON sr.id = sq.service_request_id
       WHERE sq.id = ? AND sr.customer_user_id = ?`
    )
    .bind(quoteId, customerUserId)
    .first<ServiceQuoteRow>()
}

/** A specific quote, scoped to being OWNED (sent) by providerProfileId — the provider-side ownership guard mirroring getOwnedServiceListing. */
export async function getOwnedQuote(db: D1Database, providerProfileId: number, quoteId: number): Promise<ServiceQuoteRow | null> {
  return db.prepare('SELECT * FROM service_quotes WHERE id = ? AND provider_profile_id = ?').bind(quoteId, providerProfileId).first<ServiceQuoteRow>()
}

export async function getQuotesSentByProvider(db: D1Database, providerProfileId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT sq.*, sr.title AS request_title, sr.request_number
       FROM service_quotes sq
       JOIN service_requests sr ON sr.id = sq.service_request_id
       WHERE sq.provider_profile_id = ?
       ORDER BY sq.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(providerProfileId, limit, offset)
    .all()
  return results
}

function isQuoteExpired(quote: ServiceQuoteRow): boolean {
  return !!quote.expires_at && new Date(quote.expires_at).getTime() < Date.now()
}

/**
 * Marks a quote 'expired' if past expires_at and still in a non-terminal
 * state — called lazily on read (no cron trigger available on hosted
 * deploy; spec section 42's "expired quote cannot be accepted" is enforced
 * here AND re-checked at accept-time for safety).
 */
export async function expireQuoteIfNeeded(db: D1Database, quote: ServiceQuoteRow): Promise<ServiceQuoteRow> {
  if (isQuoteExpired(quote) && (quote.status === 'sent' || quote.status === 'viewed')) {
    await db.prepare(`UPDATE service_quotes SET status = 'expired', updated_at = datetime('now') WHERE id = ?`).bind(quote.id).run()
    return { ...quote, status: 'expired' }
  }
  return quote
}

/**
 * Accepts a quote on behalf of the customer. Server-side guards (spec
 * section 42): quote must belong to a request owned by customerUserId,
 * must not be expired, must be in 'sent'/'viewed' state, and a request may
 * only ever produce ONE accepted quote (checked via the request's status —
 * once 'accepted' no further accept is possible). Returns the quote row;
 * the caller (route handler) is responsible for creating the service_order
 * (src/lib/service-orders.ts) — this function does not create side effects
 * beyond the quote/request status transition, keeping single responsibility.
 */
export async function acceptQuote(db: D1Database, customerUserId: number, quoteId: number): Promise<ServiceQuoteRow> {
  const quote = await getQuoteForCustomer(db, customerUserId, quoteId)
  if (!quote) throw new NotOwnedError('Quote', quoteId)

  const fresh = await expireQuoteIfNeeded(db, quote)
  if (fresh.status === 'expired') throw new QuoteStateError('This quote has expired and can no longer be accepted')
  if (fresh.status !== 'sent' && fresh.status !== 'viewed') throw new QuoteStateError(`Cannot accept a quote that is ${fresh.status}`)

  const request = await db.prepare('SELECT * FROM service_requests WHERE id = ?').bind(fresh.service_request_id).first<ServiceRequestRow>()
  if (!request) throw new NotOwnedError('ServiceRequest', fresh.service_request_id)
  if (request.status === 'accepted' || request.status === 'scheduled' || request.status === 'in_progress' || request.status === 'completed') {
    throw new QuoteStateError('This request already has an accepted quote')
  }

  await db.batch([
    db.prepare(`UPDATE service_quotes SET status = 'accepted', updated_at = datetime('now') WHERE id = ?`).bind(quoteId),
    db.prepare(`UPDATE service_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?`).bind(request.id)
  ])

  return { ...fresh, status: 'accepted' }
}

export async function rejectQuote(db: D1Database, customerUserId: number, quoteId: number): Promise<boolean> {
  const quote = await getQuoteForCustomer(db, customerUserId, quoteId)
  if (!quote) return false
  if (quote.status !== 'sent' && quote.status !== 'viewed') throw new QuoteStateError(`Cannot reject a quote that is ${quote.status}`)
  await db.prepare(`UPDATE service_quotes SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`).bind(quoteId).run()
  return true
}

/** Provider withdraws their own pending quote. Ownership enforced via provider_profile_id in the WHERE clause. */
export async function withdrawQuote(db: D1Database, providerProfileId: number, quoteId: number): Promise<boolean> {
  // Same fix as updateServiceListing (src/lib/services.ts): D1's
  // result.success is true even for a 0-row UPDATE, so it must never be
  // used as a stand-in for "ownership matched and a row actually changed".
  const result = await db
    .prepare(`UPDATE service_quotes SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ? AND provider_profile_id = ? AND status IN ('draft','sent','viewed')`)
    .bind(quoteId, providerProfileId)
    .run()
  return (result.meta.rows_written ?? 0) > 0
}
