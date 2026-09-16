/**
 * Phase 3A — Recommendation Engine V1: behavior_events write path.
 *
 * This is the ONLY place that inserts into behavior_events (migration 0064).
 * Phase 3C's future candidate-generation/ranking code reads from this table but
 * never writes to it — keeping the write path centralized here so retention,
 * visitor-id resolution and event-shape validation live in exactly one place.
 *
 * WHY wishlist/cart/purchase are NOT event types here: see the migration's own
 * header comment — those already have live, correctly-indexed tables
 * (wishlists, cart_items, order_items). Duplicating them as behavior_events rows
 * would create two disagreeing sources of truth for zero signal gain.
 */
import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { getOrSetVisitorToken } from './visitor'

export type BehaviorEventType = 'product_view' | 'product_click' | 'category_view' | 'search'

export interface RecordBehaviorEventInput {
  eventType: BehaviorEventType
  productId?: number | null
  categoryId?: number | null
  searchQuery?: string | null
  source?: string | null
}

/**
 * Records one behavior_events row for the CURRENT request's visitor (resolved
 * from c.get('user') if authenticated, else the nd_visitor cookie — issuing one
 * if absent). Never throws: a tracking failure must never break the page it's
 * called from (same "logging failure must not fail the operation itself"
 * discipline as order-lifecycle.ts's cc_domain_events writer and
 * notifications.ts's enqueueAndProcessNow — both already established
 * precedents in this codebase for exactly this kind of best-effort side write).
 */
export async function recordBehaviorEvent(c: Context<AppEnv>, input: RecordBehaviorEventInput): Promise<void> {
  try {
    const user = c.get('user')
    const visitorToken = getOrSetVisitorToken(c)
    const visitorId = user ? `user:${user.id}` : visitorToken

    await c.env.DB.prepare(
      `INSERT INTO behavior_events (visitor_id, user_id, event_type, product_id, category_id, search_query, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        visitorId,
        user?.id ?? null,
        input.eventType,
        input.productId ?? null,
        input.categoryId ?? null,
        input.searchQuery ?? null,
        input.source ?? null
      )
      .run()
  } catch (err) {
    console.error('recordBehaviorEvent failed', input.eventType, err)
  }
}

/**
 * Anonymous -> authenticated identity merge, called from api-auth.ts's /login
 * and /register handlers, directly alongside the EXISTING mergeGuestCartIntoUser()
 * call (src/lib/cart.ts) — same call sites, same shape, same proven pattern.
 *
 * This is an UPDATE, not a copy: pre-login anonymous rows become the
 * authenticated user's rows IN PLACE. No pre-login history is discarded, and no
 * duplicate events are created. Idempotent — calling it twice with the same
 * visitorToken is harmless because the WHERE clause only matches rows still
 * carrying the pre-merge visitor_id; after the first call, a second call's
 * WHERE matches zero rows.
 */
export async function mergeVisitorBehaviorIntoUser(db: D1Database, visitorToken: string, userId: number): Promise<void> {
  try {
    await db
      .prepare(`UPDATE behavior_events SET user_id = ?, visitor_id = ? WHERE visitor_id = ? AND user_id IS NULL`)
      .bind(userId, `user:${userId}`, visitorToken)
      .run()
  } catch (err) {
    console.error('mergeVisitorBehaviorIntoUser failed', userId, err)
  }
}

// ---------- Retention purge (lazy — no cron on this deploy target) ----------

/**
 * behavior_events retention: 90 days for product_view/category_view/search,
 * 30 days for product_click (short-lived signal, per the Phase 3 architecture
 * proposal's Section 15). Cloudflare Pages hosted deploy has no Cron Triggers
 * (established project constraint — see homepage-feed.ts's own doc comment
 * making the same point), so this runs LAZILY: at most once per real calendar
 * day, piggybacked opportunistically on a real request, using a marker row in
 * the SAME homepage_feed_cache table already used for exactly this
 * "avoid re-running expensive work every request" purpose elsewhere in this
 * codebase (see homepage-feed.ts). Never blocks or fails its caller.
 */
const RETENTION_MARKER_KEY = 'behavior_events_retention_purge'
const RETENTION_MIN_INTERVAL_HOURS = 24

export async function maybePurgeStaleBehaviorEvents(db: D1Database): Promise<void> {
  try {
    const marker = await db
      .prepare('SELECT generated_at FROM homepage_feed_cache WHERE section_key = ?')
      .bind(RETENTION_MARKER_KEY)
      .first<{ generated_at: string }>()

    if (marker) {
      const ageHours = (Date.now() - new Date(marker.generated_at + 'Z').getTime()) / 1000 / 60 / 60
      if (ageHours < RETENTION_MIN_INTERVAL_HOURS) return
    }

    await db
      .prepare(`DELETE FROM behavior_events WHERE event_type = 'product_click' AND occurred_at < datetime('now', '-30 days')`)
      .run()
    await db
      .prepare(`DELETE FROM behavior_events WHERE event_type != 'product_click' AND occurred_at < datetime('now', '-90 days')`)
      .run()

    await db
      .prepare(
        `INSERT INTO homepage_feed_cache (section_key, payload_json, generated_at) VALUES (?, '{}', datetime('now'))
         ON CONFLICT(section_key) DO UPDATE SET generated_at = excluded.generated_at`
      )
      .bind(RETENTION_MARKER_KEY)
      .run()
  } catch (err) {
    console.error('maybePurgeStaleBehaviorEvents failed', err)
  }
}
