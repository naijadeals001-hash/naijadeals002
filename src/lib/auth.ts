import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { AppEnv, AuthUser } from '../types'
import { resolveLocale } from '../i18n'

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
      `SELECT u.id, u.email, u.phone, u.name, u.role, u.preferred_language
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

/**
 * Hono middleware: resolves the request's language/dir/source and attaches
 * it to c.get('locale'). MUST run after attachUser (reads c.get('user') for
 * the logged-in "saved preference" priority level — see src/i18n/detector.ts
 * for the full 5-step chain). Never blocks the request; a resolution failure
 * of any kind falls through to English by construction (resolveLocale always
 * returns a value, never throws).
 *
 * When the resolved source is 'manual' (an explicit ?lang= on THIS request —
 * i.e. the user just clicked the language selector), this middleware ALSO
 * persists that choice immediately, per TASK N Section 12's requirement that
 * a manual choice "save preference... immediately... do not require the
 * user to repeatedly select it":
 *   - guest: sets the nd_lang cookie (1 year, httpOnly — server-read only,
 *     the app has no client-side need to read it via JS)
 *   - logged-in: also writes users.preferred_language so the choice follows
 *     the account across devices, not just this browser
 * A future country-driven page reload (Section 12: "do not overwrite it
 * because IP changes") can never undo this — detector.ts checks the saved
 * cookie/DB value at priority level 2, strictly above country/IP at level 4.
 */
export async function attachLocale(c: Context<AppEnv>, next: () => Promise<void>) {
  const user = c.get('user')
  const locale = resolveLocale(c, { userSavedLang: user?.preferred_language ?? null })
  c.set('locale', locale)

  if (locale.source === 'manual') {
    setCookie(c, 'nd_lang', locale.language, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365
    })
    if (user) {
      // Fire-and-forget-safe: awaited, but never blocks/fails the request —
      // a write error here must not prevent the page from rendering in the
      // newly-selected language for THIS request.
      try {
        await c.env.DB.prepare('UPDATE users SET preferred_language = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .bind(locale.language, user.id)
          .run()
      } catch {
        // Swallow: cookie persistence already succeeded, which is enough for
        // this request and this browser. Next login elsewhere will simply
        // not carry the preference — not a functional break.
      }
    }
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
