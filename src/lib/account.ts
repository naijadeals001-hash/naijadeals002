/**
 * Account Engine — personal preferences + session management.
 *
 * Deliberately thin: authentication itself (password hashing, session
 * token creation/verification, cookies) stays entirely in src/lib/auth.ts —
 * this module only ADDS the preferences table (migration 0037) and a couple
 * of session-listing/revocation helpers on top of the EXISTING `sessions`
 * table (migration 0001), per Section 22's ownership rule: Identity Engine
 * owns sessions, this file just exposes them safely to the account holder.
 */
import type { AccountPreferencesRow } from '../types'

const DEFAULT_PREFERENCES: Omit<AccountPreferencesRow, 'user_id' | 'updated_at'> = {
  language: 'en',
  currency_code: 'NGN',
  timezone: 'Africa/Lagos',
  notification_prefs_json: '{"order_updates":true,"promotions":true,"security_alerts":true}',
  marketing_opt_in: 1,
  privacy_prefs_json: '{}',
  accessibility_prefs_json: '{}'
}

/** Returns the user's saved preferences, or in-memory defaults if they've never saved any (no row created until first write). */
export async function getAccountPreferences(db: D1Database, userId: number): Promise<AccountPreferencesRow> {
  const row = await db.prepare('SELECT * FROM account_preferences WHERE user_id = ?').bind(userId).first<AccountPreferencesRow>()
  if (row) return row
  return { user_id: userId, updated_at: '', ...DEFAULT_PREFERENCES }
}

export interface AccountPreferencesInput {
  language?: string
  currency_code?: string
  timezone?: string
  notification_prefs_json?: string
  marketing_opt_in?: boolean
  privacy_prefs_json?: string
  accessibility_prefs_json?: string
}

/** Upserts preferences — lazy row creation, same pattern as affiliate_accounts/wallet_accounts elsewhere in this codebase. */
export async function updateAccountPreferences(db: D1Database, userId: number, input: AccountPreferencesInput): Promise<AccountPreferencesRow> {
  const current = await getAccountPreferences(db, userId)
  const merged = {
    language: input.language ?? current.language,
    currency_code: input.currency_code ?? current.currency_code,
    timezone: input.timezone ?? current.timezone,
    notification_prefs_json: input.notification_prefs_json ?? current.notification_prefs_json,
    marketing_opt_in: input.marketing_opt_in !== undefined ? (input.marketing_opt_in ? 1 : 0) : current.marketing_opt_in,
    privacy_prefs_json: input.privacy_prefs_json ?? current.privacy_prefs_json,
    accessibility_prefs_json: input.accessibility_prefs_json ?? current.accessibility_prefs_json
  }

  await db
    .prepare(
      `INSERT INTO account_preferences (user_id, language, currency_code, timezone, notification_prefs_json, marketing_opt_in, privacy_prefs_json, accessibility_prefs_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         language = excluded.language,
         currency_code = excluded.currency_code,
         timezone = excluded.timezone,
         notification_prefs_json = excluded.notification_prefs_json,
         marketing_opt_in = excluded.marketing_opt_in,
         privacy_prefs_json = excluded.privacy_prefs_json,
         accessibility_prefs_json = excluded.accessibility_prefs_json,
         updated_at = datetime('now')`
    )
    .bind(userId, merged.language, merged.currency_code, merged.timezone, merged.notification_prefs_json, merged.marketing_opt_in, merged.privacy_prefs_json, merged.accessibility_prefs_json)
    .run()

  return getAccountPreferences(db, userId)
}

// ---------- Session listing / revocation (Section 14/18) ----------

export interface AccountSessionSummary {
  id: number
  user_agent: string | null
  created_at: string
  expires_at: string
  is_current: boolean
}

/**
 * Lists this user's active sessions WITHOUT ever exposing token_hash (Section
 * 14: "Never expose session secrets through APIs") — only metadata a user
 * needs to recognize/revoke a device ("Chrome on iPhone, signed in 2 days
 * ago") is returned.
 */
export async function getSessionsForUser(db: D1Database, userId: number, currentTokenHash: string | null): Promise<AccountSessionSummary[]> {
  const { results } = await db
    .prepare(`SELECT id, token_hash, user_agent, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC`)
    .bind(userId)
    .all<{ id: number; token_hash: string; user_agent: string | null; created_at: string; expires_at: string }>()

  return results.map((r) => ({
    id: r.id,
    user_agent: r.user_agent,
    created_at: r.created_at,
    expires_at: r.expires_at,
    is_current: currentTokenHash !== null && r.token_hash === currentTokenHash
  }))
}

/** Revokes a single session by id, scoped by user_id so a user can never revoke someone else's session by guessing an id (IDOR guard). */
export async function revokeSessionById(db: D1Database, userId: number, sessionId: number): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').bind(sessionId, userId).run()
}

/** Revokes every session for a user EXCEPT the current one (the "log out all other devices" action). */
export async function revokeAllOtherSessions(db: D1Database, userId: number, currentTokenHash: string | null): Promise<void> {
  if (currentTokenHash) {
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(userId, currentTokenHash).run()
  } else {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
  }
}
