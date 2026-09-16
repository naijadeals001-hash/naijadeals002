import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

/**
 * Phase 3A — dedicated BEHAVIORAL identity cookie for the Recommendation Engine.
 *
 * Pat's decision #1 (locked at approval): this is deliberately a SEPARATE cookie
 * from `nd_guest` (src/lib/guest.ts, which exists ONLY to scope anonymous carts —
 * see getOrSetGuestToken there). Cart identity and behavioral identity are
 * different concerns with different lifecycles: a customer clearing their cart
 * (or a cart expiring) must not reset 90 days of category-affinity history, and
 * vice versa. Reusing nd_guest for both would conflate them.
 *
 * Mirrors getOrSetGuestToken()'s exact token-generation/cookie-attribute pattern
 * (same crypto.getRandomValues shape, same httpOnly/secure/sameSite=Lax/90-day
 * maxAge) — deliberately not reinvented, per this codebase's established
 * "copy the proven pattern" discipline (see hero-campaigns-admin.ts's own doc
 * comment making the same point about itself).
 */
const VISITOR_COOKIE = 'nd_visitor'
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90 // 90 days — matches behavior_events' retention window (see behavior-events.ts)

function randomToken(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Returns the existing behavioral-visitor token from the cookie, or issues a new
 * one. Called on every page/route that records a behavior_events row — safe to
 * call multiple times per request (idempotent: returns the same value if the
 * cookie is already set on this request's incoming headers).
 */
export function getOrSetVisitorToken(c: Context): string {
  let token = getCookie(c, VISITOR_COOKIE)
  if (!token) {
    token = randomToken()
    setCookie(c, VISITOR_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS
    })
  }
  return token
}

/** Read-only accessor — returns null if no visitor cookie exists yet (never issues one). Used where we must not set a cookie on a response that might be cached (none currently, but kept honest). */
export function getVisitorToken(c: Context): string | null {
  return getCookie(c, VISITOR_COOKIE) ?? null
}
