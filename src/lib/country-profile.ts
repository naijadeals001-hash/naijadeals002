/**
 * Stage 2A — Africa Catalog & Country Architecture.
 *
 * Country profile assembly (public read) + country-facts admin mutations
 * (Control Center only), backing the new /countries/:iso marketplace page.
 *
 * VERIFICATION WORKFLOW: two-step propose -> verify (Pat's explicit Stage 2A
 * authorization decision). createCountryFact() always creates an
 * 'unverified' row regardless of what the caller passes for
 * verification_status — a Control Center user must take a SEPARATE,
 * explicit verifyCountryFact() action, providing a source_url, to promote a
 * row to 'verified'. This mirrors product_country_origins' own established
 * convention in this codebase and is not a new pattern.
 *
 * THE NON-NEGOTIABLE GUARDRAIL (Pat's explicit Stage 2A rule): a row may
 * NEVER become 'verified' without a non-empty source_url. This is enforced
 * HERE, in code — not merely documented as policy — so it is structurally
 * impossible to mark something verified without evidence, regardless of
 * which route or future caller invokes this function.
 *
 * Leadership specifically (fact_type='government_leadership'): ships as a
 * capability in this unit with ZERO rows for all 54 countries at close.
 * Nothing in this module creates leadership content — it only provides the
 * plumbing for a future admin action to add it, one verified fact at a
 * time. An empty leadership section is the correct, intended state.
 */
import type { CountryRow } from './country'

export class VerificationSourceRequiredError extends Error {
  constructor() {
    super('A source_url is required before a country fact can be marked verified.')
    this.name = 'VerificationSourceRequiredError'
  }
}

export class CountryFactNotFoundError extends Error {
  constructor() {
    super('Country fact not found.')
    this.name = 'CountryFactNotFoundError'
  }
}

export type CountryFactType = 'major_city' | 'history' | 'culture' | 'industry' | 'government_leadership'

export interface CountryFactRow {
  id: number
  country_id: number
  fact_type: CountryFactType
  label: string
  value: string
  sort_order: number
  verification_status: 'unverified' | 'verified' | 'disputed'
  source_url: string | null
  verified_by_user_id: number | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

const VALID_FACT_TYPES: CountryFactType[] = ['major_city', 'history', 'culture', 'industry', 'government_leadership']

/**
 * Public country-page data contract: the country row itself plus every
 * VERIFIED fact, grouped by type. Unverified/disputed facts are never
 * included here — getCountryFactsForAdmin() (below) is the only function
 * that ever returns those, and it is Control-Center-only.
 */
export interface CountryProfile {
  country: CountryRow
  facts: Record<CountryFactType, CountryFactRow[]>
}

/** Single-country lookup by ISO code — the country-detail page's first query. Returns null for an unknown/invalid ISO rather than throwing, so the route can 404 cleanly. */
export async function getCountryByIso(db: D1Database, iso: string): Promise<CountryRow | null> {
  const row = await db
    .prepare(`SELECT id, iso_code, name, region, currency_code, status FROM cc_countries WHERE iso_code = ?`)
    .bind(iso.toUpperCase())
    .first<CountryRow>()
  return row ?? null
}

/**
 * Assembles the full public country profile: the country row + every
 * VERIFIED fact, grouped by fact_type. Used directly by getCountryProfile's
 * cached wrapper in country-detail.tsx — this function itself does no
 * caching (page-cache.ts wraps it at the call site so the caching policy
 * lives with the page, not buried in the data layer).
 */
export async function assembleCountryProfile(db: D1Database, iso: string): Promise<CountryProfile | null> {
  const country = await getCountryByIso(db, iso)
  if (!country) return null

  const { results } = await db
    .prepare(
      `SELECT * FROM cc_country_facts WHERE country_id = ? AND verification_status = 'verified' ORDER BY fact_type ASC, sort_order ASC, id ASC`
    )
    .bind(country.id)
    .all<CountryFactRow>()

  const facts: Record<CountryFactType, CountryFactRow[]> = {
    major_city: [],
    history: [],
    culture: [],
    industry: [],
    government_leadership: [],
  }
  for (const row of results) {
    facts[row.fact_type].push(row)
  }

  return { country, facts }
}

// ---------------------------------------------------------------------------
// Control Center admin mutations — propose -> verify workflow
// ---------------------------------------------------------------------------

export interface CreateCountryFactInput {
  country_id: number
  fact_type: CountryFactType
  label: string
  value: string
  sort_order?: number
  source_url?: string | null
}

/**
 * STEP 1 of the propose -> verify workflow: creates a fact row, always at
 * verification_status='unverified' regardless of any status the caller
 * might attempt to pass (there is no status field in CreateCountryFactInput
 * at all — this is enforced by the type signature, not just a runtime
 * check). A source_url MAY be supplied here as supporting evidence for the
 * later verify step, but supplying one does NOT auto-verify the row.
 */
export async function createCountryFact(db: D1Database, input: CreateCountryFactInput): Promise<number> {
  if (!VALID_FACT_TYPES.includes(input.fact_type)) {
    throw new Error(`Unsupported fact_type "${input.fact_type}". Valid types: ${VALID_FACT_TYPES.join(', ')}`)
  }
  if (!input.label?.trim() || !input.value?.trim()) {
    throw new Error('label and value are required')
  }
  const result = await db
    .prepare(
      `INSERT INTO cc_country_facts (country_id, fact_type, label, value, sort_order, source_url, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, 'unverified')`
    )
    .bind(input.country_id, input.fact_type, input.label.trim(), input.value.trim(), input.sort_order ?? 0, input.source_url ?? null)
    .run()
  return Number(result.meta.last_row_id)
}

export async function updateCountryFact(
  db: D1Database,
  factId: number,
  input: Partial<Pick<CreateCountryFactInput, 'label' | 'value' | 'sort_order' | 'source_url'>>
): Promise<boolean> {
  const fields: string[] = []
  const binds: unknown[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    fields.push(`${key} = ?`)
    binds.push(value)
  }
  if (fields.length === 0) return true
  fields.push(`updated_at = datetime('now')`)
  const result = await db.prepare(`UPDATE cc_country_facts SET ${fields.join(', ')} WHERE id = ?`).bind(...binds, factId).run()
  return (result.meta.rows_written ?? 0) > 0
}

/**
 * STEP 2 of the propose -> verify workflow, and the ONLY function in this
 * codebase permitted to set cc_country_facts.verification_status='verified'.
 *
 * THE GUARDRAIL: throws VerificationSourceRequiredError if sourceUrl is
 * empty/whitespace-only — including the case where the row already has a
 * source_url from creation time but the verifying admin doesn't re-affirm
 * one here. This is deliberate: verification is a distinct administrative
 * act with its own accountability (verified_by_user_id, verified_at), and
 * requiring the source at THIS step (not just at creation) means a fact
 * can never be silently verified by an UPDATE that never actually looked at
 * evidence.
 *
 * verifiedByUserId MUST come from the authenticated Control Center session
 * (c.get('user').id), never from a request body — enforced by the caller
 * (api-control-center.ts), same discipline as every other admin-actor field
 * in this codebase (recordControlCenterAction, applyModerationDecision).
 */
export async function verifyCountryFact(db: D1Database, factId: number, sourceUrl: string, verifiedByUserId: number): Promise<void> {
  if (!sourceUrl?.trim()) {
    throw new VerificationSourceRequiredError()
  }
  const existing = await db.prepare('SELECT id FROM cc_country_facts WHERE id = ?').bind(factId).first<{ id: number }>()
  if (!existing) throw new CountryFactNotFoundError()

  await db
    .prepare(
      `UPDATE cc_country_facts
       SET verification_status = 'verified', source_url = ?, verified_by_user_id = ?, verified_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(sourceUrl.trim(), verifiedByUserId, factId)
    .run()
}

/** Marks a previously-verified (or unverified) fact as 'disputed' — an admin retraction path, e.g. a leadership fact that has gone stale after a real-world change. Disputed rows are excluded from assembleCountryProfile() exactly like unverified ones. */
export async function disputeCountryFact(db: D1Database, factId: number): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE cc_country_facts SET verification_status = 'disputed', updated_at = datetime('now') WHERE id = ?`)
    .bind(factId)
    .run()
  return (result.meta.rows_written ?? 0) > 0
}

export async function deleteCountryFact(db: D1Database, factId: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM cc_country_facts WHERE id = ?').bind(factId).run()
  return (result.meta.rows_written ?? 0) > 0
}

/** Control-Center-only: every fact for a country regardless of verification status — the admin review/management list. Never used by any public-facing route. */
export async function getCountryFactsForAdmin(db: D1Database, countryId: number): Promise<CountryFactRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM cc_country_facts WHERE country_id = ? ORDER BY fact_type ASC, sort_order ASC, id ASC')
    .bind(countryId)
    .all<CountryFactRow>()
  return results
}

/** Control-Center-only: every fact across ALL countries still awaiting verification — the review queue's primary listing. */
export async function getPendingCountryFacts(db: D1Database, limit = 100): Promise<Array<CountryFactRow & { country_name: string; country_iso: string }>> {
  const { results } = await db
    .prepare(
      `SELECT f.*, c.name as country_name, c.iso_code as country_iso
       FROM cc_country_facts f
       JOIN cc_countries c ON c.id = f.country_id
       WHERE f.verification_status = 'unverified'
       ORDER BY f.created_at ASC LIMIT ?`
    )
    .bind(limit)
    .all<CountryFactRow & { country_name: string; country_iso: string }>()
  return results
}
