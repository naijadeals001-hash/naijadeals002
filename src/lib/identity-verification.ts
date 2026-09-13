/**
 * Engine 1 Identity Completion — Email/phone verification (Priority 3).
 *
 * Uses the EXISTING users.is_email_verified / users.is_phone_verified
 * columns (migration 0001, present since the very first schema) — this
 * module is the first thing in the codebase that ever transitions them
 * false -> true through a legitimate, ownership-checked, single-use,
 * short-lived-token flow (confirmed absent by the Engine 1 gap-matrix
 * audit's exhaustive grep).
 *
 * Email verification uses a long opaque token in a clickable link (same
 * shape as password reset — see requestEmailVerification below). Phone
 * verification uses a short numeric code, since that's what an SMS OTP
 * flow actually needs (see requestPhoneVerification). Both channels share
 * identity_verification_tokens (migration 0048) and the SAME
 * confirmVerification() consume/validate logic — only how the secret is
 * generated and delivered differs per channel.
 */

const VERIFICATION_TTL_MINUTES = 15

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return toHex(arr.buffer)
}

/** 6-digit numeric code — suitable for SMS/voice readback, unlike a hex token. */
function randomNumericCode(digits: number): string {
  const arr = new Uint8Array(digits)
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => (b % 10).toString()).join('')
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return toHex(digest)
}

export type VerificationChannel = 'email' | 'phone'

export class InvalidVerificationTokenError extends Error {
  constructor() {
    super('This verification code/link is invalid or has expired')
    this.name = 'InvalidVerificationTokenError'
  }
}

export class NoTargetToVerifyError extends Error {
  constructor(channel: VerificationChannel) {
    super(`No ${channel} address is on file for this account`)
    this.name = 'NoTargetToVerifyError'
  }
}

export class AlreadyVerifiedError extends Error {
  constructor(channel: VerificationChannel) {
    super(`${channel} is already verified`)
    this.name = 'AlreadyVerifiedError'
  }
}

interface IssuedTokenRow {
  name: string
  email: string | null
  phone: string | null
  is_email_verified: number
  is_phone_verified: number
}

async function loadUserForVerification(db: D1Database, userId: number): Promise<IssuedTokenRow | null> {
  return db
    .prepare('SELECT name, email, phone, is_email_verified, is_phone_verified FROM users WHERE id = ?')
    .bind(userId)
    .first<IssuedTokenRow>()
}

/**
 * Issues an email verification token for the AUTHENTICATED user's own
 * email (userId must come from the session — c.get('user').id — never a
 * client-supplied target, mirroring Section 17's server-side-resolved-
 * ownership rule). `baseUrl` is supplied by the route layer (derived from
 * the request's own origin) since this app runs from multiple different
 * base URLs across environments — no single hardcoded constant would be
 * durably correct.
 */
export async function requestEmailVerification(db: D1Database, userId: number, baseUrl: string): Promise<void> {
  const user = await loadUserForVerification(db, userId)
  if (!user) throw new NoTargetToVerifyError('email')
  if (!user.email) throw new NoTargetToVerifyError('email')
  if (user.is_email_verified === 1) throw new AlreadyVerifiedError('email')

  const rawToken = randomHex(32)
  const tokenHash = await sha256Hex(rawToken)
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60_000).toISOString()

  await db
    .prepare('INSERT INTO identity_verification_tokens (user_id, channel, target_value, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, 'email', user.email, tokenHash, expiresAt)
    .run()

  const verifyUrl = `${baseUrl}/verify-email?token=${rawToken}`

  // Notification delivery failure must NEVER corrupt identity state
  // (Priority 3's explicit requirement): this happens entirely AFTER the
  // token row already committed, and any failure here is swallowed — no
  // is_email_verified column has been touched yet (that only happens in
  // confirmVerification, on a SUCCESSFUL confirm).
  try {
    const { enqueueAndProcessNow } = await import('./notifications')
    await enqueueAndProcessNow(db, {
      idempotencyKey: `email_verification_requested:${tokenHash}`,
      eventType: 'email_verification_requested',
      recipientUserId: userId,
      category: 'security',
      payload: { name: user.name, verify_url: verifyUrl },
    })
  } catch (err) {
    console.error('Notification enqueue failed for email_verification_requested', userId, err)
  }
}

/** Issues a phone verification code (SMS) for the AUTHENTICATED user's own phone. Same ownership/ttl/single-use discipline as requestEmailVerification, delivered as a 6-digit code via the sms channel instead of a link. */
export async function requestPhoneVerification(db: D1Database, userId: number): Promise<void> {
  const user = await loadUserForVerification(db, userId)
  if (!user) throw new NoTargetToVerifyError('phone')
  if (!user.phone) throw new NoTargetToVerifyError('phone')
  if (user.is_phone_verified === 1) throw new AlreadyVerifiedError('phone')

  const code = randomNumericCode(6)
  const tokenHash = await sha256Hex(code)
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60_000).toISOString()

  await db
    .prepare('INSERT INTO identity_verification_tokens (user_id, channel, target_value, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, 'phone', user.phone, tokenHash, expiresAt)
    .run()

  try {
    const { enqueueAndProcessNow } = await import('./notifications')
    await enqueueAndProcessNow(db, {
      idempotencyKey: `phone_verification_requested:${tokenHash}`,
      eventType: 'phone_verification_requested',
      recipientUserId: userId,
      category: 'security',
      payload: { name: user.name, code },
    })
  } catch (err) {
    console.error('Notification enqueue failed for phone_verification_requested', userId, err)
  }
}

/**
 * Confirms a pending verification token/code for the AUTHENTICATED user
 * (ownership check: the token row's user_id must match the caller —
 * never trusts a client-supplied user id, so another user's in-flight
 * token can never be confirmed by someone else even if they somehow
 * learned the raw secret). Flips the appropriate is_*_verified column
 * false->true, single-use + expiry enforced via the same CAS-claim
 * pattern as password-reset (UPDATE ... WHERE consumed_at IS NULL,
 * meta.changes checked — closes the concurrent-replay race window).
 */
export async function confirmVerification(db: D1Database, userId: number, channel: VerificationChannel, rawSecret: string): Promise<void> {
  const tokenHash = await sha256Hex(rawSecret)

  const row = await db
    .prepare(
      `SELECT id, user_id FROM identity_verification_tokens
       WHERE token_hash = ? AND channel = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > datetime('now')`
    )
    .bind(tokenHash, channel, userId)
    .first<{ id: number; user_id: number }>()

  if (!row) throw new InvalidVerificationTokenError()

  const claim = await db
    .prepare(`UPDATE identity_verification_tokens SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL`)
    .bind(row.id)
    .run()
  if (!claim.meta.changes) throw new InvalidVerificationTokenError()

  const column = channel === 'email' ? 'is_email_verified' : 'is_phone_verified'
  await db.prepare(`UPDATE users SET ${column} = 1, updated_at = datetime('now') WHERE id = ?`).bind(userId).run()
}
