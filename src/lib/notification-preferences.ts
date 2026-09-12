/**
 * Engine 9 — Notification preferences resolution.
 *
 * DESIGN (per audit finding #4 in migrations/0045's header): this is a
 * NEW, normalized (user, category, channel) -> enabled model, deliberately
 * separate from account_preferences.notification_prefs_json (the existing
 * free-form JSON blob the Account page already reads/writes — left
 * completely untouched, still governs whatever it already governs in the
 * UI). Engine 9's actual enforcement/consent logic lives HERE, in the new
 * notification_preferences table, not in the legacy blob.
 *
 * MANDATORY CATEGORY ENFORCEMENT (non-negotiable — see notifications.ts's
 * MANDATORY_CATEGORIES): 'transactional' and 'security' notifications are
 * ALWAYS delivered on their default channels regardless of any
 * notification_preferences row a user might have (or a client might try
 * to set via the preferences API — see api-notifications.ts's explicit
 * rejection of attempts to disable these categories). This function
 * enforces that at the read/resolve layer, which is the ONLY place fan-out
 * decisions are made — so there is no code path that could bypass it.
 */
import { MANDATORY_CATEGORIES, DEFAULT_CHANNELS_BY_CATEGORY, type NotificationCategory, type NotificationChannel } from './notifications'

/** Resolves the exact set of channels a given recipient should receive a notification of `category` on, applying mandatory-category enforcement and explicit user preference overrides. */
export async function resolveChannelsForRecipient(db: D1Database, userId: number, category: NotificationCategory): Promise<NotificationChannel[]> {
  const defaults = DEFAULT_CHANNELS_BY_CATEGORY[category] ?? ['in_app']

  if (MANDATORY_CATEGORIES.has(category)) {
    // Security/transactional: always the default set, never suppressible.
    return defaults
  }

  const { results } = await db
    .prepare('SELECT channel, enabled FROM notification_preferences WHERE user_id = ? AND category = ?')
    .bind(userId, category)
    .all<{ channel: NotificationChannel; enabled: number }>()

  if (results.length === 0) return defaults // no explicit preference rows -> use the honest default

  const explicit = new Map(results.map((r) => [r.channel, r.enabled === 1]))
  // A channel with no explicit row for this category falls back to the
  // default's membership (i.e. "on" if it was a default channel).
  const allChannels: NotificationChannel[] = ['in_app', 'email', 'sms', 'push']
  return allChannels.filter((ch) => (explicit.has(ch) ? explicit.get(ch) : defaults.includes(ch)))
}

export interface PreferenceRow {
  category: NotificationCategory
  channel: NotificationChannel
  enabled: boolean
  mandatory: boolean
}

/** Full preference matrix for a user's settings UI — includes mandatory categories (shown but flagged non-editable), and every category x channel combination with its EFFECTIVE (not just stored) enabled state. */
export async function getPreferenceMatrixForUser(db: D1Database, userId: number): Promise<PreferenceRow[]> {
  const categories: NotificationCategory[] = ['transactional', 'security', 'order', 'booking', 'delivery', 'payment', 'marketing', 'promotional', 'system']
  const channels: NotificationChannel[] = ['in_app', 'email', 'sms', 'push']

  const { results } = await db
    .prepare('SELECT category, channel, enabled FROM notification_preferences WHERE user_id = ?')
    .bind(userId)
    .all<{ category: NotificationCategory; channel: NotificationChannel; enabled: number }>()
  const stored = new Map(results.map((r) => [`${r.category}:${r.channel}`, r.enabled === 1]))

  const matrix: PreferenceRow[] = []
  for (const category of categories) {
    const mandatory = MANDATORY_CATEGORIES.has(category)
    const defaults = DEFAULT_CHANNELS_BY_CATEGORY[category] ?? ['in_app']
    for (const channel of channels) {
      const key = `${category}:${channel}`
      const enabled = mandatory ? true : stored.has(key) ? stored.get(key)! : defaults.includes(channel)
      matrix.push({ category, channel, enabled, mandatory })
    }
  }
  return matrix
}

export class PreferenceError extends Error {}

/**
 * Sets ONE (category, channel) preference for the AUTHENTICATED user
 * (userId must come from c.get('user').id — never client-supplied,
 * exactly like every other ownership-scoped mutation in this codebase).
 * Rejects any attempt to disable a mandatory category — this is the
 * write-side half of the enforcement (resolveChannelsForRecipient is the
 * read-side half; both independently enforce it so a bug in one layer
 * cannot silently bypass the other).
 */
export async function setNotificationPreference(db: D1Database, userId: number, category: NotificationCategory, channel: NotificationChannel, enabled: boolean): Promise<void> {
  if (MANDATORY_CATEGORIES.has(category) && !enabled) {
    throw new PreferenceError(`The "${category}" category cannot be disabled — it covers security and transactional notifications you must receive.`)
  }
  await db
    .prepare(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, category, channel) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`
    )
    .bind(userId, category, channel, enabled ? 1 : 0)
    .run()
}
