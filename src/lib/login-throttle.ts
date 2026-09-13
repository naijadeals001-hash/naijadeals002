/**
 * Engine 1 Identity Completion — D1-based login throttling (Priority 4).
 *
 * Explicit constraint honored: no KV binding is introduced (this
 * project's wrangler.jsonc is hosted-deploy-compliant with zero
 * kv_namespaces — adding one purely for this would break that
 * compliance). login_attempts (migration 0048) is a plain D1 append-only
 * ledger, matching the append-only pattern already used elsewhere in this
 * codebase (wallet_ledger, inventory_adjustments) rather than a mutable
 * counter column, which would need read-modify-write locking to stay
 * correct under concurrent attempts.
 *
 * THROTTLE SEMANTICS (bounded, never a permanent lockout — Priority 4's
 * explicit requirement): a rolling WINDOW_MINUTES time window is checked
 * on both the submitted identifier AND the source IP independently;
 * either axis alone crossing MAX_ATTEMPTS_PER_WINDOW throttles the
 * request. Once the oldest failing attempt in the window ages out, the
 * count naturally drops — no manual reset endpoint needed, no
 * unbounded/forever block. A single successful login does NOT retroactively
 * erase prior failures (that would let an attacker "launder" a lockout by
 * guessing correctly once) — the window is purely time-based, which also
 * keeps the read side a single indexed range query rather than a
 * stateful "count since last success" query.
 */

const WINDOW_MINUTES = 15
const MAX_ATTEMPTS_PER_WINDOW = 5

export interface ThrottleCheckResult {
  throttled: boolean
  retryAfterSeconds: number | null
}

/**
 * Checks whether either the identifier or the IP has hit the failure cap
 * within the rolling window. Read-only — does NOT record anything itself
 * (call recordLoginAttempt separately, after the actual credential check,
 * so a successful login and a failed one both leave an honest ledger
 * entry). Never throws; a DB error here fails OPEN (does not block login)
 * since throttling is a defense-in-depth control, not the primary
 * authentication boundary — a transient throttle-table outage must never
 * become a platform-wide login outage.
 */
export async function checkLoginThrottle(db: D1Database, identifier: string, ipAddress: string | null): Promise<ThrottleCheckResult> {
  try {
    const normalizedIdentifier = identifier.trim().toLowerCase()
    const windowStart = `-${WINDOW_MINUTES} minutes`

    const byIdentifier = await db
      .prepare(
        `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM login_attempts
         WHERE identifier = ? AND outcome = 'failure' AND created_at > datetime('now', ?)`
      )
      .bind(normalizedIdentifier, windowStart)
      .first<{ n: number; oldest: string | null }>()

    const byIp = ipAddress
      ? await db
          .prepare(
            `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM login_attempts
             WHERE ip_address = ? AND outcome = 'failure' AND created_at > datetime('now', ?)`
          )
          .bind(ipAddress, windowStart)
          .first<{ n: number; oldest: string | null }>()
      : null

    const identifierCount = byIdentifier?.n ?? 0
    const ipCount = byIp?.n ?? 0

    if (identifierCount >= MAX_ATTEMPTS_PER_WINDOW || ipCount >= MAX_ATTEMPTS_PER_WINDOW) {
      // Approximate retry-after: WINDOW_MINUTES since the oldest attempt
      // still counted in whichever axis tripped the cap. Bounded by
      // WINDOW_MINUTES*60 so the value is always sane even if clock skew
      // makes the arithmetic go negative.
      const oldest = identifierCount >= MAX_ATTEMPTS_PER_WINDOW ? byIdentifier?.oldest : byIp?.oldest
      let retryAfterSeconds = WINDOW_MINUTES * 60
      if (oldest) {
        const elapsedMs = Date.now() - new Date(oldest + 'Z').getTime()
        const remainingMs = WINDOW_MINUTES * 60_000 - elapsedMs
        retryAfterSeconds = Math.max(1, Math.min(WINDOW_MINUTES * 60, Math.round(remainingMs / 1000)))
      }
      return { throttled: true, retryAfterSeconds }
    }

    return { throttled: false, retryAfterSeconds: null }
  } catch (err) {
    console.error('checkLoginThrottle failed open (treating as not-throttled)', err)
    return { throttled: false, retryAfterSeconds: null }
  }
}

/** Records one login attempt (success or failure) for both throttle axes. Always awaited but never allowed to fail the parent login flow — wrapped in try/catch by the caller is NOT required since this function swallows its own errors (mirrors notifications.ts's fire-and-forget-safe rationale: an audit-ledger write must never break the actual login path). */
export async function recordLoginAttempt(db: D1Database, identifier: string, ipAddress: string | null, outcome: 'success' | 'failure'): Promise<void> {
  try {
    const normalizedIdentifier = identifier.trim().toLowerCase()
    await db
      .prepare('INSERT INTO login_attempts (identifier, ip_address, outcome) VALUES (?, ?, ?)')
      .bind(normalizedIdentifier, ipAddress, outcome)
      .run()
  } catch (err) {
    console.error('recordLoginAttempt failed (non-fatal, login flow continues)', err)
  }
}

/** Best-effort client IP extraction for Cloudflare Workers (CF-Connecting-IP is the trustworthy header Cloudflare itself sets at the edge — never trust a client-supplied X-Forwarded-For alone). Returns null if unavailable (e.g. local dev without CF's edge in front). */
export function getClientIp(headerValue: string | null): string | null {
  return headerValue ?? null
}
