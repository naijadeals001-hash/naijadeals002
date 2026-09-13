/**
 * Engine 1 Identity Completion — Password reset (Priority 2).
 *
 * Same token discipline as sessions.token_hash (src/lib/auth.ts) and
 * organization_invitations.token_hash (src/lib/organizations.ts): a
 * random raw token is generated, only its SHA-256 hash is ever persisted
 * (password_reset_tokens.token_hash, migration 0048), and the raw token
 * is NEVER logged — it exists only in the outgoing notification payload
 * (handed to Engine 9's enqueueAndProcessNow, which itself only logs
 * event_type/recipient/category, never payload contents at info level —
 * confirmed via notifications.ts's own logging calls, all of which log
 * error objects/ids, never a payload blob).
 *
 * Delivery MUST go through Engine 9's existing outbox
 * (enqueueAndProcessNow) — no second notification mechanism.
 */
import { hashPassword } from './auth'
import { revokeAllSessionsForUser } from './account'

const RESET_TOKEN_TTL_MINUTES = 30

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return toHex(arr.buffer)
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return toHex(digest)
}

export class WeakPasswordError extends Error {
  constructor() {
    super('Password must be at least 8 characters')
    this.name = 'WeakPasswordError'
  }
}

export class InvalidResetTokenError extends Error {
  constructor() {
    super('This password reset link is invalid or has expired')
    this.name = 'InvalidResetTokenError'
  }
}

/**
 * Creates a password reset token for the given user and enqueues the
 * Engine 9 notification carrying the raw token as a URL. Deliberately
 * does NOT check whether the user exists at the ROUTE layer (see
 * api-auth.ts's /password-reset/request handler) — this function itself
 * assumes userId is already a resolved, real user id, so the
 * account-enumeration protection (always return 200 regardless of
 * whether the identifier matched anyone) lives at the route, not here.
 *
 * `baseUrl` is passed in explicitly (derived from the request's own
 * origin at the route layer) rather than hardcoded, since this app runs
 * both from a Cloudflare Pages preview URL and, in the sandbox, from
 * whatever GetServiceUrl currently maps to — no single constant would be
 * durably correct in every environment this code runs in.
 */
export async function requestPasswordReset(db: D1Database, userId: number, userName: string, baseUrl: string): Promise<void> {
  const rawToken = randomHex(32)
  const tokenHash = await sha256Hex(rawToken)
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000).toISOString()

  await db
    .prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .bind(userId, tokenHash, expiresAt)
    .run()

  const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`

  try {
    const { enqueueAndProcessNow } = await import('./notifications')
    await enqueueAndProcessNow(db, {
      // Idempotency key includes the token hash (not the raw token, and
      // not just userId) so a user requesting reset twice in quick
      // succession gets TWO distinct notification events (one per
      // distinct token issued) rather than the second request being
      // silently swallowed as a "duplicate" of the first — each token is
      // a genuinely distinct real-world occurrence.
      idempotencyKey: `password_reset_requested:${tokenHash}`,
      eventType: 'password_reset_requested',
      recipientUserId: userId,
      category: 'security',
      payload: { name: userName, reset_url: resetUrl },
    })
  } catch (err) {
    // Never let a notification-dispatch failure block the token from
    // having been created — the token row already committed above, so a
    // user who somehow already has the raw token (e.g. a retried request
    // on the client that captured the URL from network devtools during
    // development) is not blocked. In production the token is USELESS
    // without the email actually arriving, so this failure mode is
    // "reset silently doesn't work" rather than "security hole".
    console.error('Notification enqueue failed for password_reset_requested', userId, err)
  }
}

/**
 * Validates and consumes a password reset token, replacing the user's
 * password hash and invalidating ALL of their existing sessions (a
 * password reset is a legitimate "I may have lost control of my
 * previous credential" signal — every existing session, including any an
 * attacker may have established, must stop working; the user will need
 * to log in again with the new password, which is the correct UX for
 * this specific flow, unlike a routine profile update).
 *
 * Single-use enforcement: the UPDATE that sets consumed_at is scoped by
 * `consumed_at IS NULL AND expires_at > datetime('now')` and its
 * `meta.changes` is checked — if 0 rows changed, the token was invalid,
 * expired, or already consumed by an earlier call (including a
 * concurrent replay), and this function throws InvalidResetTokenError in
 * all of those cases identically (never distinguishes "expired" from
 * "already used" in the response, so an attacker probing tokens learns
 * nothing about WHY a token failed).
 */
export async function resetPasswordWithToken(db: D1Database, rawToken: string, newPassword: string): Promise<{ userId: number }> {
  if (newPassword.length < 8) throw new WeakPasswordError()

  const tokenHash = await sha256Hex(rawToken)

  const row = await db
    .prepare(`SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > datetime('now')`)
    .bind(tokenHash)
    .first<{ id: number; user_id: number }>()

  if (!row) throw new InvalidResetTokenError()

  // Atomically claim this token (CAS: only succeeds if still unconsumed —
  // closes the race window between the SELECT above and this UPDATE for
  // two concurrent requests replaying the exact same raw token).
  const claim = await db
    .prepare(`UPDATE password_reset_tokens SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL`)
    .bind(row.id)
    .run()
  if (!claim.meta.changes) throw new InvalidResetTokenError()

  const { hash, salt } = await hashPassword(newPassword)
  await db
    .prepare(`UPDATE users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(hash, salt, row.user_id)
    .run()

  await revokeAllSessionsForUser(db, row.user_id)

  const user = await db.prepare('SELECT name FROM users WHERE id = ?').bind(row.user_id).first<{ name: string }>()
  try {
    const { enqueueAndProcessNow } = await import('./notifications')
    await enqueueAndProcessNow(db, {
      idempotencyKey: `password_reset_completed:${row.id}`,
      eventType: 'password_reset_completed',
      recipientUserId: row.user_id,
      category: 'security',
      payload: { name: user?.name ?? '' },
    })
  } catch (err) {
    console.error('Notification enqueue failed for password_reset_completed', row.user_id, err)
  }

  return { userId: row.user_id }
}
