/**
 * Account API — Section 18's `/api/account/*` surface.
 *
 * Deliberately additive/non-duplicating:
 *   - register/login/logout/me                -> stay in /api/auth/* (api-auth.ts) — NOT re-implemented here.
 *   - personal delivery addresses (CRUD)       -> stay in /api/addresses/* (api-addresses.ts) — NOT re-implemented here.
 *   - organization-scoped profile/members/etc. -> /api/organizations/* (api-organizations.ts).
 * This file ONLY adds what didn't already exist: a profile-shaped view of
 * "me" beyond the bare auth payload, account preferences, and session
 * listing/revocation (Section 14/18).
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { getCookie } from 'hono/cookie'
import { getAccountPreferences, updateAccountPreferences, getSessionsForUser, revokeSessionById, revokeAllOtherSessions } from '../lib/account'
import { getOrganizationsForUser } from '../lib/organizations'

export const accountApi = new Hono<AppEnv>()

accountApi.use('*', requireAuth)

async function currentTokenHash(c: any): Promise<string | null> {
  const token = getCookie(c, 'nd_session')
  if (!token) return null
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * GET /api/account/me — the authenticated user's identity PLUS the
 * organizations they belong to, in one call. Distinct from GET /api/auth/me
 * (which returns just the bare session user) — this is the richer,
 * account-hub-shaped payload Section 25's "My Account" page needs.
 */
accountApi.get('/me', async (c) => {
  const user = c.get('user')!
  const organizations = await getOrganizationsForUser(c.env.DB, user.id)
  return c.json({ user, organizations })
})

// ---------- Profile ----------

accountApi.get('/profile', async (c) => {
  const user = c.get('user')!
  const row = await c.env.DB
    .prepare('SELECT id, name, email, phone, role, status, country_iso, preferred_language, created_at FROM users WHERE id = ?')
    .bind(user.id)
    .first()
  return c.json({ profile: row })
})

accountApi.patch('/profile', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ name?: string; country_iso?: string }>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  const fields: string[] = []
  const values: any[] = []
  if (typeof body.name === 'string' && body.name.trim()) {
    fields.push('name = ?')
    values.push(body.name.trim())
  }
  if (typeof body.country_iso === 'string' && /^[A-Z]{2}$/.test(body.country_iso)) {
    fields.push('country_iso = ?')
    values.push(body.country_iso)
  }
  if (fields.length === 0) return c.json({ error: 'No valid fields to update' }, 400)

  fields.push(`updated_at = datetime('now')`)
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values, user.id).run()

  const row = await c.env.DB
    .prepare('SELECT id, name, email, phone, role, status, country_iso, preferred_language, created_at FROM users WHERE id = ?')
    .bind(user.id)
    .first()
  return c.json({ success: true, profile: row })
})

// ---------- Preferences ----------

accountApi.get('/preferences', async (c) => {
  const user = c.get('user')!
  const preferences = await getAccountPreferences(c.env.DB, user.id)
  return c.json({ preferences })
})

accountApi.patch('/preferences', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  const input: Record<string, any> = {}
  if (typeof body.language === 'string') input.language = body.language
  if (typeof body.currency_code === 'string') input.currency_code = body.currency_code
  if (typeof body.timezone === 'string') input.timezone = body.timezone
  if (typeof body.marketing_opt_in === 'boolean') input.marketing_opt_in = body.marketing_opt_in
  if (body.notification_prefs && typeof body.notification_prefs === 'object') input.notification_prefs_json = JSON.stringify(body.notification_prefs)
  if (body.privacy_prefs && typeof body.privacy_prefs === 'object') input.privacy_prefs_json = JSON.stringify(body.privacy_prefs)
  if (body.accessibility_prefs && typeof body.accessibility_prefs === 'object') input.accessibility_prefs_json = JSON.stringify(body.accessibility_prefs)

  const preferences = await updateAccountPreferences(c.env.DB, user.id, input)
  return c.json({ success: true, preferences })
})

// ---------- Sessions (Section 14/18) ----------

accountApi.get('/sessions', async (c) => {
  const user = c.get('user')!
  const tokenHash = await currentTokenHash(c)
  const sessions = await getSessionsForUser(c.env.DB, user.id, tokenHash)
  return c.json({ sessions })
})

/** IDOR-guarded by construction: revokeSessionById scopes the DELETE by user_id, so a session id belonging to another user is silently a no-op, never a cross-account revoke. */
accountApi.post('/sessions/:sessionId/revoke', async (c) => {
  const user = c.get('user')!
  const sessionId = Number(c.req.param('sessionId'))
  if (!sessionId || Number.isNaN(sessionId)) return c.json({ error: 'Invalid session id' }, 400)
  await revokeSessionById(c.env.DB, user.id, sessionId)
  const tokenHash = await currentTokenHash(c)
  const sessions = await getSessionsForUser(c.env.DB, user.id, tokenHash)
  return c.json({ success: true, sessions })
})

accountApi.post('/sessions/revoke-all', async (c) => {
  const user = c.get('user')!
  const tokenHash = await currentTokenHash(c)
  await revokeAllOtherSessions(c.env.DB, user.id, tokenHash)
  const sessions = await getSessionsForUser(c.env.DB, user.id, tokenHash)
  return c.json({ success: true, sessions })
})
