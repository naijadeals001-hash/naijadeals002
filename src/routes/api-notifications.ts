/**
 * Engine 9 — Notification Center + Preferences API.
 *
 * SECURITY (Phase 11's mandate): every route is scoped to the
 * AUTHENTICATED user's id (c.get('user').id) — never a client-supplied
 * user_id/recipient_id. There is no "list another user's notifications"
 * or "mark another user's notification read" path — the WHERE clause on
 * every query includes `user_id = ?` bound to the session user.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { getPreferenceMatrixForUser, setNotificationPreference, PreferenceError } from '../lib/notification-preferences'
import type { NotificationCategory, NotificationChannel } from '../lib/notifications'

export const notificationsApi = new Hono<AppEnv>()

notificationsApi.use('*', requireAuth)

/** Paginated in-app notification list — ownership-scoped, real DB data only (never fabricated/static). */
notificationsApi.get('/', async (c) => {
  const user = c.get('user')!
  const limit = Math.min(Number(c.req.query('limit') ?? 20) || 20, 100)
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0)

  const { results } = await c.env.DB
    .prepare('SELECT id, type, title, body, action_url, reference_type, reference_id, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(user.id, limit, offset)
    .all()

  const unread = await c.env.DB
    .prepare('SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND is_read = 0')
    .bind(user.id)
    .first<{ n: number }>()

  return c.json({ results, unread_count: unread?.n ?? 0 })
})

/** Unread count only — cheap poll target for a bell icon badge. */
notificationsApi.get('/unread-count', async (c) => {
  const user = c.get('user')!
  const row = await c.env.DB.prepare('SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND is_read = 0').bind(user.id).first<{ n: number }>()
  return c.json({ unread_count: row?.n ?? 0 })
})

/** Marks ONE notification read — ownership-scoped: the UPDATE's WHERE clause requires user_id = the session user, so a mismatched id (another user's notification) matches 0 rows, full stop. Never leaks whether the id exists for someone else. */
notificationsApi.post('/:id/read', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  if (!id || Number.isNaN(id)) return c.json({ error: 'Invalid notification id' }, 400)

  const result = await c.env.DB
    .prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .run()
  if ((result.meta.rows_written ?? 0) === 0) return c.json({ error: 'Notification not found' }, 404)
  return c.json({ success: true })
})

/** Marks ALL of the session user's notifications read in one call. */
notificationsApi.post('/read-all', async (c) => {
  const user = c.get('user')!
  await c.env.DB.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`).bind(user.id).run()
  return c.json({ success: true })
})

// ---------- Preferences ----------

/** Full category x channel preference matrix, with mandatory categories flagged (UI should render them non-editable). */
notificationsApi.get('/preferences', async (c) => {
  const user = c.get('user')!
  const matrix = await getPreferenceMatrixForUser(c.env.DB, user.id)
  return c.json({ preferences: matrix })
})

/** Sets ONE (category, channel) preference. Rejects disabling a mandatory category (transactional/security) with a 400, never silently ignored. */
notificationsApi.put('/preferences', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ category?: string; channel?: string; enabled?: boolean }>().catch(() => null)
  if (!body?.category || !body?.channel || typeof body.enabled !== 'boolean') {
    return c.json({ error: 'category, channel and enabled (boolean) are required' }, 400)
  }
  const validCategories: NotificationCategory[] = ['transactional', 'security', 'order', 'booking', 'delivery', 'payment', 'marketing', 'promotional', 'system']
  const validChannels: NotificationChannel[] = ['in_app', 'email', 'sms', 'push']
  if (!validCategories.includes(body.category as NotificationCategory) || !validChannels.includes(body.channel as NotificationChannel)) {
    return c.json({ error: 'Invalid category or channel' }, 400)
  }

  try {
    await setNotificationPreference(c.env.DB, user.id, body.category as NotificationCategory, body.channel as NotificationChannel, body.enabled)
    return c.json({ success: true })
  } catch (err: any) {
    if (err instanceof PreferenceError) return c.json({ error: err.message }, 400)
    throw err
  }
})
