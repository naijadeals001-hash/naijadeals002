import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { hashPassword, verifyPassword, createSession, destroySession, setSessionCookie, clearSessionCookie, getSessionToken } from '../lib/auth'
import { mergeGuestCartIntoUser } from '../lib/cart'
import { getOrSetGuestToken } from '../lib/guest'

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

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? OR phone = ?')
    .bind(body.identifier, body.identifier)
    .first<any>()

  if (!user) return c.json({ error: 'Invalid credentials' }, 401)

  const valid = await verifyPassword(body.password, user.password_hash, user.password_salt)
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401)

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
