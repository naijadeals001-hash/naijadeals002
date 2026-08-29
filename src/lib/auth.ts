import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { AppEnv, AuthUser } from '../types'

const SESSION_COOKIE = 'nd_session'
const SESSION_DAYS = 30

// ---------- Password hashing (PBKDF2 via Web Crypto — no native deps, Workers-safe) ----------

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return toHex(arr.buffer)
}

async function pbkdf2(password: string, saltHex: string, iterations = 100_000): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return toHex(derived)
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomHex(16)
  const hash = await pbkdf2(password, salt)
  return { hash, salt }
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const computed = await pbkdf2(password, salt)
  // Constant-time-ish comparison
  if (computed.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i)
  }
  return diff === 0
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return toHex(digest)
}

// ---------- Session management ----------

export async function createSession(
  db: D1Database,
  userId: number,
  userAgent: string | null
): Promise<string> {
  const token = randomHex(32) // raw token sent to client
  const tokenHash = await sha256Hex(token) // only the hash is stored server-side
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  await db
    .prepare('INSERT INTO sessions (user_id, token_hash, user_agent, expires_at) VALUES (?, ?, ?, ?)')
    .bind(userId, tokenHash, userAgent, expiresAt)
    .run()

  return token
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token)
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}

export async function getUserFromToken(db: D1Database, token: string): Promise<AuthUser | null> {
  const tokenHash = await sha256Hex(token)
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.phone, u.name, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
    )
    .bind(tokenHash)
    .first<AuthUser>()
  return row ?? null
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60
  })
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export function getSessionToken(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null
}

/** Hono middleware: attaches c.get('user') if a valid session cookie is present. Never blocks the request. */
export async function attachUser(c: Context<AppEnv>, next: () => Promise<void>) {
  const token = getSessionToken(c)
  if (token) {
    const user = await getUserFromToken(c.env.DB, token)
    c.set('user', user)
  } else {
    c.set('user', null)
  }
  await next()
}

/** Hono middleware: 401s if no authenticated user. Use on protected JSON API routes. */
export async function requireAuth(c: Context<AppEnv>, next: () => Promise<void>) {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  await next()
}

/** Hono middleware: redirects to /login?next=<path> if no authenticated user. Use on protected SSR page routes. */
export async function requireAuthPage(c: Context<AppEnv>, next: () => Promise<void>) {
  const user = c.get('user')
  if (!user) {
    const next_ = encodeURIComponent(c.req.path)
    return c.redirect(`/login?next=${next_}`)
  }
  await next()
}
