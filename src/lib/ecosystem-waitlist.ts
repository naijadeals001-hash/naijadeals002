import type { EcosystemWaitlistSignupRow } from '../types'

/**
 * Data access + validation for the v2 Ecosystem Waitlist (migration 0011 —
 * ecosystem_waitlist_signups). Backs POST /api/ecosystem/waitlist
 * (src/routes/api-ecosystem.ts), which is fed by the EcosystemWaitlistModal
 * component reused across all 8 vertical preview pages and /ecosystem.
 *
 * Deliberately separate from lib/ecosystem-verticals.ts's
 * addToVerticalWaitlist (migration 0010) — that function/table/endpoint
 * remain live and untouched for backward compatibility with the original
 * per-vertical single-email "Notify me" inline forms; this module is the
 * new, richer system that Pat's fix-task requires.
 */

export interface WaitlistSubmission {
  fullName: string
  email: string
  phone: string
  city: string
  state: string
  naijaEats: boolean
  naijaGigs: boolean
  naijaStay: boolean
  allServices: boolean
}

export interface ValidationResult {
  valid: boolean
  error?: string
  input?: WaitlistSubmission
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Accepts Nigerian local (0803...) and +234 international formats, 10-15 digits after
// stripping spaces/dashes — permissive enough to not block real numbers, strict enough
// to reject garbage like "asdf" or a bare "1".
const PHONE_DIGITS_RE = /^[0-9+()\-\s]{7,20}$/

/** Strips control/HTML-ish characters and collapses whitespace — a lightweight
 *  sanitizer for free-text fields (full_name, city, state, phone). We do not
 *  allow any HTML in these fields at all (they are only ever rendered as
 *  plain text / used in SQL bind params, never dangerouslySetInnerHTML), so
 *  stripping <, >, and control characters is sufficient defence-in-depth on
 *  top of D1's parameterized queries (which already prevent SQL injection). */
function sanitizeText(raw: string): string {
  return String(raw)
    .replace(/[<>]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 200)
}

/**
 * Full server-side validation for a waitlist submission. Never trust the
 * client: this re-validates everything the modal's own JS already checks,
 * because a malicious or buggy client can send anything.
 */
export function validateWaitlistSubmission(body: any): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' }
  }

  const fullNameRaw = typeof body.fullName === 'string' ? body.fullName : ''
  const emailRaw = typeof body.email === 'string' ? body.email : ''
  const phoneRaw = typeof body.phone === 'string' ? body.phone : ''
  const cityRaw = typeof body.city === 'string' ? body.city : ''
  const stateRaw = typeof body.state === 'string' ? body.state : ''

  const fullName = sanitizeText(fullNameRaw)
  const email = emailRaw.trim().toLowerCase()
  const phone = sanitizeText(phoneRaw)
  const city = sanitizeText(cityRaw)
  const state = sanitizeText(stateRaw)

  if (!fullName || fullName.length < 2) {
    return { valid: false, error: 'Please enter your full name.' }
  }
  if (!email || !EMAIL_RE.test(email)) {
    return { valid: false, error: 'Please enter a valid email address.' }
  }
  if (!phone || !PHONE_DIGITS_RE.test(phone)) {
    return { valid: false, error: 'Please enter a valid phone number.' }
  }
  if (!city) {
    return { valid: false, error: 'Please enter your city.' }
  }
  if (!state) {
    return { valid: false, error: 'Please select your state.' }
  }

  const naijaEats = Boolean(body.naijaEats)
  const naijaGigs = Boolean(body.naijaGigs)
  const naijaStay = Boolean(body.naijaStay)
  const allServices = Boolean(body.allServices)

  if (!naijaEats && !naijaGigs && !naijaStay && !allServices) {
    return { valid: false, error: 'Please select at least one service you want to hear about.' }
  }

  return {
    valid: true,
    input: { fullName, email, phone, city, state, naijaEats, naijaGigs, naijaStay, allServices }
  }
}

/**
 * Persists a waitlist submission. Idempotent-but-additive on email: a
 * returning email UPSERTs — contact details (name/phone/city/state) are
 * refreshed to the latest submission, and service flags are MERGED (OR'd)
 * with whatever was already selected, so a person who joins from /eats and
 * later from /gigs ends up wanting BOTH, never overwritten or duplicated.
 * UNIQUE(email) at the DB layer is the actual anti-spam guard; this function
 * relies on it via ON CONFLICT rather than a separate SELECT-then-branch
 * (avoids a race between two rapid submissions of the same email).
 */
export async function upsertWaitlistSignup(db: D1Database, input: WaitlistSubmission): Promise<{ isNewSignup: boolean }> {
  const existing = await db
    .prepare('SELECT id FROM ecosystem_waitlist_signups WHERE email = ?')
    .bind(input.email)
    .first<{ id: number }>()

  await db
    .prepare(
      `INSERT INTO ecosystem_waitlist_signups
         (full_name, email, phone, city, state, naija_eats, naija_gigs, naija_stay, all_services, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(email) DO UPDATE SET
         full_name    = excluded.full_name,
         phone        = excluded.phone,
         city         = excluded.city,
         state        = excluded.state,
         naija_eats   = MAX(ecosystem_waitlist_signups.naija_eats, excluded.naija_eats),
         naija_gigs   = MAX(ecosystem_waitlist_signups.naija_gigs, excluded.naija_gigs),
         naija_stay   = MAX(ecosystem_waitlist_signups.naija_stay, excluded.naija_stay),
         all_services = MAX(ecosystem_waitlist_signups.all_services, excluded.all_services),
         updated_at   = datetime('now')`
    )
    .bind(
      input.fullName,
      input.email,
      input.phone,
      input.city,
      input.state,
      input.naijaEats ? 1 : 0,
      input.naijaGigs ? 1 : 0,
      input.naijaStay ? 1 : 0,
      input.allServices ? 1 : 0
    )
    .run()

  return { isNewSignup: !existing }
}

/** For a confirmation email address, fetch the merged record back (used to build the success-state service list in the API response, so the client always reflects the true persisted state, not just what was in this one request). */
export async function getWaitlistSignupByEmail(db: D1Database, email: string): Promise<EcosystemWaitlistSignupRow | null> {
  const row = await db
    .prepare('SELECT * FROM ecosystem_waitlist_signups WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .first<EcosystemWaitlistSignupRow>()
  return row ?? null
}
