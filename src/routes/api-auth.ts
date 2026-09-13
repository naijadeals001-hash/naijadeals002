import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { hashPassword, verifyPassword, createSession, destroySession, setSessionCookie, clearSessionCookie, getSessionToken, isAccountStatusBlocked, requireAuth } from '../lib/auth'
import { mergeGuestCartIntoUser } from '../lib/cart'
import { getOrSetGuestToken } from '../lib/guest'
import { checkLoginThrottle, recordLoginAttempt, getClientIp } from '../lib/login-throttle'
import { requestPasswordReset, resetPasswordWithToken, WeakPasswordError, InvalidResetTokenError } from '../lib/password-reset'
import { requestEmailVerification, requestPhoneVerification, confirmVerification, InvalidVerificationTokenError, NoTargetToVerifyError, AlreadyVerifiedError } from '../lib/identity-verification'

export const authApi = new Hono<AppEnv>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^(0|\+234)[789][01]\d{8}$/ // Nigerian mobile format

authApi.post('/register', async (c) => {
  const body = await c.req.json<{ name: string; email?: string; phone?: string; password: string }>().catch(() => null)
  if (!body?.name || !body?.password || (!body.email && !body.phone)) {
    return c.json({ error: 'Name, password and at least one of email/phone are required' }, 400)
  }
  if (body.password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }
  if (body.email && !EMAIL_RE.test(body.email)) {
    return c.json({ error: 'Invalid email format' }, 400)
  }
  if (body.phone && !PHONE_RE.test(body.phone)) {
    return c.json({ error: 'Enter a valid Nigerian mobile number' }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? OR phone = ?')
    .bind(body.email ?? null, body.phone ?? null)
    .first()
  if (existing) {
    return c.json({ error: 'An account with this email or phone already exists' }, 409)
  }

  const { hash, salt } = await hashPassword(body.password)
  const result = await c.env.DB.prepare(
    'INSERT INTO users (email, phone, name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)'
  ).bind(body.email ?? null, body.phone ?? null, body.name, hash, salt).run()

  const userId = result.meta.last_row_id as number

  // Merge any guest cart into the new account
  const guestToken = getOrSetGuestToken(c)
  await mergeGuestCartIntoUser(c.env.DB, guestToken, userId)

  const token = await createSession(c.env.DB, userId, c.req.header('user-agent') ?? null)
  setSessionCookie(c, token)

  // Engine 9 event writer — welcome notification. Fires strictly after
  // the account row + session already committed; never able to block or
  // fail registration itself (see src/lib/notifications.ts's financial/
  // business-safety rationale, applied identically here to auth).
  try {
    const { enqueueAndProcessNow } = await import('../lib/notifications')
    await enqueueAndProcessNow(c.env.DB, {
      idempotencyKey: `account_registered:${userId}`,
      eventType: 'account_registered',
      recipientUserId: userId,
      category: 'transactional',
      payload: { name: body.name },
    })
  } catch (err) {
    console.error('Notification enqueue failed for registration', userId, err)
  }

  return c.json({ success: true, user: { id: userId, name: body.name, email: body.email ?? null, phone: body.phone ?? null } })
})

authApi.post('/login', async (c) => {
  const body = await c.req.json<{ identifier: string; password: string }>().catch(() => null)
  if (!body?.identifier || !body?.password) {
    return c.json({ error: 'Email/phone and password are required' }, 400)
  }

  const ip = getClientIp(c.req.header('cf-connecting-ip') ?? null)

  // Priority 4 — login throttling. Checked BEFORE the (relatively cheap)
  // credential lookup so a throttled request never even reaches
  // verifyPassword — this is deliberately generic/user-safe (429, no
  // credential disclosure) and never distinguishes "this account is
  // throttled" from "this IP is throttled" in the response.
  const throttle = await checkLoginThrottle(c.env.DB, body.identifier, ip)
  if (throttle.throttled) {
    return c.json({ error: 'Too many login attempts. Please try again later.', retryAfterSeconds: throttle.retryAfterSeconds }, 429)
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? OR phone = ?')
    .bind(body.identifier, body.identifier)
    .first<any>()

  if (!user) {
    await recordLoginAttempt(c.env.DB, body.identifier, ip, 'failure')
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const valid = await verifyPassword(body.password, user.password_hash, user.password_salt)
  if (!valid) {
    await recordLoginAttempt(c.env.DB, body.identifier, ip, 'failure')
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  // Priority 1 — users.status enforcement at the LOGIN boundary. This is
  // distinct from (and in addition to) attachUser()'s per-request
  // re-check: a blocked-status account must not even be able to
  // ESTABLISH a new session in the first place, not just have existing
  // sessions invalidated. A correct password for a suspended/disabled/
  // deleted account is deliberately NOT treated as a throttle-relevant
  // "failure" (the credential itself was correct — recording it as a
  // password failure would be dishonest and could mask genuine
  // credential-stuffing signal), but login is still refused.
  if (isAccountStatusBlocked(user.status)) {
    return c.json({ error: 'This account is not available for login. Contact support if you believe this is a mistake.' }, 403)
  }

  await recordLoginAttempt(c.env.DB, body.identifier, ip, 'success')

  const guestToken = getOrSetGuestToken(c)
  await mergeGuestCartIntoUser(c.env.DB, guestToken, user.id)

  const token = await createSession(c.env.DB, user.id, c.req.header('user-agent') ?? null)
  setSessionCookie(c, token)

  return c.json({ success: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone } })
})

authApi.post('/logout', async (c) => {
  const token = getSessionToken(c)
  if (token) await destroySession(c.env.DB, token)
  clearSessionCookie(c)
  return c.json({ success: true })
})

authApi.get('/me', async (c) => {
  const user = c.get('user')
  return c.json({ user })
})

// ---------- Priority 2: Password reset ----------

/**
 * Deliberately returns the SAME 200 response whether or not the
 * identifier matched a real account (account-enumeration protection —
 * an attacker probing emails must not be able to distinguish "this
 * account exists" from "it doesn't" via this endpoint's response).
 */
authApi.post('/password-reset/request', async (c) => {
  const body = await c.req.json<{ identifier: string }>().catch(() => null)
  if (!body?.identifier) return c.json({ error: 'identifier is required' }, 400)

  const user = await c.env.DB.prepare('SELECT id, name FROM users WHERE email = ? OR phone = ?')
    .bind(body.identifier, body.identifier)
    .first<{ id: number; name: string }>()

  if (user) {
    const url = new URL(c.req.url)
    const baseUrl = `${url.protocol}//${url.host}`
    try {
      await requestPasswordReset(c.env.DB, user.id, user.name, baseUrl)
    } catch (err) {
      console.error('requestPasswordReset failed', user.id, err)
    }
  }

  return c.json({ success: true, message: 'If an account matches, a reset link has been sent.' })
})

authApi.post('/password-reset/confirm', async (c) => {
  const body = await c.req.json<{ token: string; new_password: string }>().catch(() => null)
  if (!body?.token || !body?.new_password) {
    return c.json({ error: 'token and new_password are required' }, 400)
  }
  try {
    await resetPasswordWithToken(c.env.DB, body.token, body.new_password)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof InvalidResetTokenError) return c.json({ error: err.message }, 400)
    if (err instanceof WeakPasswordError) return c.json({ error: err.message }, 400)
    console.error('resetPasswordWithToken failed', err)
    return c.json({ error: 'Failed to reset password' }, 500)
  }
})

// ---------- Priority 3: Email / phone verification ----------
// All request/confirm routes require an authenticated session — a
// verification token can only ever be requested for or confirmed against
// the CALLER'S OWN account (c.get('user').id), never a client-supplied
// target user id.

authApi.post('/verify-email/request', requireAuth, async (c) => {
  const user = c.get('user')!
  const url = new URL(c.req.url)
  const baseUrl = `${url.protocol}//${url.host}`
  try {
    await requestEmailVerification(c.env.DB, user.id, baseUrl)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof NoTargetToVerifyError) return c.json({ error: err.message }, 400)
    if (err instanceof AlreadyVerifiedError) return c.json({ error: err.message }, 409)
    console.error('requestEmailVerification failed', user.id, err)
    return c.json({ error: 'Failed to send verification email' }, 500)
  }
})

authApi.post('/verify-email/confirm', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ token: string }>().catch(() => null)
  if (!body?.token) return c.json({ error: 'token is required' }, 400)
  try {
    await confirmVerification(c.env.DB, user.id, 'email', body.token)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof InvalidVerificationTokenError) return c.json({ error: err.message }, 400)
    console.error('confirmVerification(email) failed', user.id, err)
    return c.json({ error: 'Failed to verify email' }, 500)
  }
})

authApi.post('/verify-phone/request', requireAuth, async (c) => {
  const user = c.get('user')!
  try {
    await requestPhoneVerification(c.env.DB, user.id)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof NoTargetToVerifyError) return c.json({ error: err.message }, 400)
    if (err instanceof AlreadyVerifiedError) return c.json({ error: err.message }, 409)
    console.error('requestPhoneVerification failed', user.id, err)
    return c.json({ error: 'Failed to send verification code' }, 500)
  }
})

authApi.post('/verify-phone/confirm', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ code: string }>().catch(() => null)
  if (!body?.code) return c.json({ error: 'code is required' }, 400)
  try {
    await confirmVerification(c.env.DB, user.id, 'phone', body.code)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof InvalidVerificationTokenError) return c.json({ error: err.message }, 400)
    console.error('confirmVerification(phone) failed', user.id, err)
    return c.json({ error: 'Failed to verify phone' }, 500)
  }
})
