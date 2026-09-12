/**
 * Engine 9 — Communication & Notification Engine: core outbox + fan-out.
 *
 * ARCHITECTURE (see docs/ENGINE-9-COMMUNICATION-NOTIFICATION-AUDIT.md and
 * migrations/0045_communication_notification_engine.sql's header for the
 * full audit/design rationale):
 *
 *   business event (order/payment/booking/...)
 *         |
 *         v
 *   enqueueNotificationEvent()  -- durable, idempotent INSERT into
 *   |                              notification_outbox (UNIQUE idempotency_key)
 *   v
 *   processOutboxOnce()  -- claims ONE pending event (CAS: pending->processing),
 *   |                        fans it out to notification_deliveries rows per
 *   |                        enabled channel, dispatches each via the
 *   |                        Integration Hub provider abstraction, marks the
 *   |                        outbox event 'processed' (or 'failed' + requeued)
 *   v
 *   notification_deliveries rows (one per channel), each independently
 *   tracking queued -> attempted -> accepted/delivered/failed/unavailable
 *
 * FINANCIAL SAFETY (non-negotiable, per the Engine 9 prompt's explicit
 * mandate): enqueueNotificationEvent() is a single fast local INSERT with
 * no network calls, no provider dependency, and NEVER throws in a way
 * that could abort a caller's financial transaction — it is designed to
 * be called as a "fire and forget, but durable" step strictly AFTER a
 * financial state transition has already committed. The actual delivery
 * fan-out (processOutboxOnce) runs on a COMPLETELY SEPARATE code path
 * (lazily, on request, via Control Center or a lightweight endpoint —
 * this is Cloudflare Pages/Workers, no background cron/queue available
 * per the platform's own hosted-deploy constraint), so a slow/broken
 * email provider can NEVER block or roll back an order/payment/booking.
 *
 * WHY A CLOUDFLARE-COMPATIBLE "PROCESS ON REQUEST" MODEL, NOT A QUEUE:
 * this repo's wrangler.jsonc has no `triggers`/cron (confirmed via audit —
 * and Cloudflare hosted-deploy explicitly REJECTS `triggers`). Real Queue
 * bindings are a Workers Paid-plan feature this project does not have
 * configured. The lowest-cost architecture compatible with what's
 * actually available: outbox rows accumulate durably in D1; a bounded
 * "process next N pending events" pass runs opportunistically (a) inline
 * after enqueue for immediate in-app delivery, and (b) via an idempotent
 * admin-triggered/catch-up endpoint for anything that didn't complete
 * inline (e.g. a transient provider failure). No fake "queue" is claimed
 * — this is a durable-outbox-with-catch-up pattern, documented honestly.
 */
import type { AuthUser } from '../types'

export type NotificationCategory =
  | 'transactional'
  | 'security'
  | 'order'
  | 'booking'
  | 'delivery'
  | 'payment'
  | 'marketing'
  | 'promotional'
  | 'system'

export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'push'

/** Categories that can NEVER be suppressed by user preference — see notification-preferences.ts's enforcement note. */
export const MANDATORY_CATEGORIES: ReadonlySet<NotificationCategory> = new Set(['transactional', 'security'])

/** Application-layer default channel set per category, used when no explicit notification_preferences row exists for (user, category, channel). */
export const DEFAULT_CHANNELS_BY_CATEGORY: Record<NotificationCategory, NotificationChannel[]> = {
  transactional: ['in_app', 'email'],
  security: ['in_app', 'email'],
  order: ['in_app', 'email'],
  booking: ['in_app', 'email'],
  delivery: ['in_app'],
  payment: ['in_app', 'email'],
  marketing: ['in_app'],
  promotional: ['in_app'],
  system: ['in_app'],
}

export interface EnqueueEventInput {
  /** Deterministic, business-semantic key — e.g. `order_item_settled:${orderItemId}`. NEVER a bare autoincrement id or a random UUID (would defeat the whole idempotency point). */
  idempotencyKey: string
  eventType: string
  recipientUserId: number
  category: NotificationCategory
  payload?: Record<string, unknown>
  referenceType?: string | null
  referenceId?: string | null
}

export interface EnqueueResult {
  outboxId: number | null
  /** false when idempotencyKey already existed — this is the EXPECTED, correct outcome for a duplicate event, not an error. */
  created: boolean
}

/**
 * Durable, idempotent enqueue. Safe to call multiple times (concurrently or
 * sequentially) with the SAME idempotencyKey for the SAME real-world
 * business occurrence — only the first call creates a row, every
 * subsequent call is a confirmed no-op (created: false). This is the CAS
 * guard: `INSERT ... ON CONFLICT(idempotency_key) DO NOTHING`, then a
 * SELECT to report which outcome actually happened.
 *
 * BUG FOUND AND FIXED (Engine 9 continuation session, evidence-based
 * diagnosis — see docs/ENGINE-9-COMMUNICATION-NOTIFICATION-AUDIT.md's
 * "Bugs Found And Fixed" section for the full repro): this function
 * originally checked `result.meta.rows_written`, copying the CAS idiom
 * Engine 7 uses for conditional UPDATE statements (wallet.ts/orders.ts/
 * refunds.ts/order-settlement.ts, where `rows_written` genuinely is 0 for
 * a no-op UPDATE — verified by direct repro). That idiom does NOT hold
 * for `INSERT ... ON CONFLICT DO NOTHING` on this project's D1/Miniflare
 * version: a no-op conflicting insert still reports `rows_written: 1`
 * (secondary index bookkeeping, confirmed via a minimal getPlatformProxy()
 * repro), while `meta.changes` correctly reports 0 for the no-op and 1 for
 * a genuine insert in every case tested. Fixed by checking `meta.changes`
 * instead — verified by the idempotency test suite
 * (02.idempotency-concurrency.test.mjs) that originally caught this bug
 * failing before the fix and passing after.
 *
 * Never throws for a duplicate. Only throws for a genuine input error
 * (unknown recipient — FK violation) or a real DB failure, and even then
 * is designed to be called from a try/catch that does NOT let a
 * notification failure roll back the caller's financial transaction (see
 * module doc comment).
 */
export async function enqueueNotificationEvent(db: D1Database, input: EnqueueEventInput): Promise<EnqueueResult> {
  const result = await db
    .prepare(
      `INSERT INTO notification_outbox (idempotency_key, event_type, recipient_user_id, category, payload_json, reference_type, reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`
    )
    .bind(
      input.idempotencyKey,
      input.eventType,
      input.recipientUserId,
      input.category,
      JSON.stringify(input.payload ?? {}),
      input.referenceType ?? null,
      input.referenceId ?? null
    )
    .run()

  const created = (result.meta.changes ?? 0) > 0
  if (!created) {
    // Duplicate key — return the EXISTING row's id so callers that need it
    // (e.g. immediately processing it inline) still get a valid outboxId.
    const existing = await db
      .prepare('SELECT id FROM notification_outbox WHERE idempotency_key = ?')
      .bind(input.idempotencyKey)
      .first<{ id: number }>()
    return { outboxId: existing?.id ?? null, created: false }
  }

  const row = await db
    .prepare('SELECT id FROM notification_outbox WHERE idempotency_key = ?')
    .bind(input.idempotencyKey)
    .first<{ id: number }>()
  return { outboxId: row?.id ?? null, created: true }
}

/**
 * Claims exactly one pending outbox row for processing (CAS:
 * `UPDATE ... SET status='processing' WHERE id=? AND status='pending'`),
 * mirroring Engine 7 Phase 3's transient-state CAS pattern applied to the
 * notification domain — two concurrent callers processing the outbox can
 * never both fan out the SAME event.
 */
async function claimOutboxEvent(db: D1Database, outboxId: number): Promise<boolean> {
  const claim = await db
    .prepare(`UPDATE notification_outbox SET status = 'processing' WHERE id = ? AND status = 'pending'`)
    .bind(outboxId)
    .run()
  return (claim.meta.rows_written ?? 0) > 0
}

interface OutboxRow {
  id: number
  idempotency_key: string
  event_type: string
  recipient_user_id: number
  category: NotificationCategory
  payload_json: string
  reference_type: string | null
  reference_id: string | null
  attempts: number
}

/**
 * Processes ONE claimed outbox event: resolves which channels this
 * recipient should receive it on (preferences, mandatory-category
 * override), creates a notification_deliveries row per channel (CAS via
 * UNIQUE(outbox_id, channel) — safe under concurrent double-processing
 * attempts), dispatches each channel through the Integration Hub, and
 * writes the in-app `notifications` row directly (the ONE channel this
 * repo can deliver synchronously and truthfully call "delivered").
 *
 * On any per-channel dispatch failure, that channel's delivery row is
 * marked failed/unavailable — it does NOT fail the whole outbox event.
 * The outbox event itself is marked 'processed' once every channel has
 * reached a terminal state (delivered/failed/unavailable/not_configured/
 * skipped) — 'failed' outbox status is reserved for a hard failure BEFORE
 * fan-out even started (e.g. recipient no longer exists).
 */
export async function processOutboxEvent(db: D1Database, outboxId: number): Promise<{ processed: boolean; channels: NotificationChannel[] }> {
  const claimed = await claimOutboxEvent(db, outboxId)
  if (!claimed) return { processed: false, channels: [] }

  try {
    const event = await db
      .prepare('SELECT * FROM notification_outbox WHERE id = ?')
      .bind(outboxId)
      .first<OutboxRow>()

    if (!event) {
      await db.prepare(`UPDATE notification_outbox SET status = 'failed', last_error = 'event disappeared after claim' WHERE id = ?`).bind(outboxId).run()
      return { processed: false, channels: [] }
    }

    const { resolveChannelsForRecipient } = await import('./notification-preferences')
    const channels = await resolveChannelsForRecipient(db, event.recipient_user_id, event.category)
    const payload = JSON.parse(event.payload_json || '{}') as Record<string, unknown>

    for (const channel of channels) {
      try {
        await dispatchChannel(db, event, channel, payload)
      } catch (channelErr: any) {
        // A single channel's dispatch failure (e.g. template render error)
        // must not abort fan-out to the OTHER channels for this event —
        // record it on that channel's delivery row and continue.
        console.error(`notifications: dispatchChannel(${channel}) failed for outbox ${event.id} (isolated, other channels continue)`, channelErr)
        await db
          .prepare(
            `INSERT INTO notification_deliveries (outbox_id, channel, status, last_error, updated_at) VALUES (?, ?, 'failed', ?, datetime('now'))
             ON CONFLICT(outbox_id, channel) DO UPDATE SET status = 'failed', last_error = excluded.last_error, updated_at = datetime('now')`
          )
          .bind(event.id, channel, String(channelErr?.message ?? channelErr))
          .run()
      }
    }

    await db
      .prepare(`UPDATE notification_outbox SET status = 'processed', processed_at = datetime('now'), attempts = attempts + 1 WHERE id = ?`)
      .bind(outboxId)
      .run()

    return { processed: true, channels }
  } catch (err: any) {
    await db
      .prepare(`UPDATE notification_outbox SET status = 'pending', attempts = attempts + 1, last_error = ? WHERE id = ?`)
      .bind(String(err?.message ?? err), outboxId)
      .run()
    // Roll back to 'pending' (not 'failed') so a transient failure gets a
    // future catch-up pass — 'failed' is reserved for terminal/unrecoverable.
    return { processed: false, channels: [] }
  }
}

/**
 * Retry scheduler decision (Phase 8, explicitly resolved — see
 * docs/ENGINE-9-COMMUNICATION-NOTIFICATION-AUDIT.md): this repo has no
 * cron/Queue binding available (hosted-deploy rejects `triggers`), so a
 * background retry worker is not implementable here. Instead, retry is a
 * BOUNDED, request-triggered catch-up exactly like the outbox's own
 * catch-up pattern (processOutboxBatch) — `retryFailedDeliveries()` below
 * is called from the same admin-triggered endpoint. Bounded by
 * MAX_DELIVERY_ATTEMPTS (never infinite), backs off exponentially per
 * attempt, and re-uses the SAME notification_deliveries row (never inserts
 * a duplicate — UNIQUE(outbox_id, channel) plus a CAS claim on retry).
 * Only 'transient' failures are ever retried; 'permanent' failures and
 * anything that has exhausted MAX_DELIVERY_ATTEMPTS get no next_retry_at
 * and are left as a genuinely terminal 'failed' delivery.
 */
const MAX_DELIVERY_ATTEMPTS = 5
const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240]

function nextRetryDelayMinutes(attemptCountAfterThisFailure: number): number | null {
  if (attemptCountAfterThisFailure >= MAX_DELIVERY_ATTEMPTS) return null
  return RETRY_BACKOFF_MINUTES[Math.min(attemptCountAfterThisFailure - 1, RETRY_BACKOFF_MINUTES.length - 1)]
}

/**
 * Performs the actual render+dispatch for one already-claimed delivery
 * row and writes the outcome back to that SAME row (deliveryId is fixed
 * up front — this function never inserts, so it is safe to call from
 * both the initial fan-out path and the later retry path without risking
 * a duplicate delivery row for the same (outbox_id, channel) pair).
 */
async function performDispatchAndRecord(db: D1Database, event: OutboxRow, channel: NotificationChannel, payload: Record<string, unknown>, deliveryId: number, attemptCountBefore: number): Promise<void> {
  const { renderTemplate } = await import('./notification-templates')
  const rendered = await renderTemplate(db, event.event_type, channel, payload)

  if (channel === 'in_app') {
    // The ONE channel that is genuinely synchronous and truthfully
    // "delivered" the moment this INSERT commits — writes the real
    // notifications table row (closing the audit's "zero writers" gap).
    await db
      .prepare(
        `INSERT INTO notifications (user_id, type, title, body, action_url, reference_type, reference_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        event.recipient_user_id,
        event.event_type,
        rendered?.subject ?? event.event_type,
        rendered?.body ?? '',
        rendered?.actionUrl ?? null,
        event.reference_type,
        event.reference_id
      )
      .run()
    await db
      .prepare(`UPDATE notification_deliveries SET status = 'delivered', delivered_at = datetime('now'), attempt_count = 1, updated_at = datetime('now') WHERE id = ?`)
      .bind(deliveryId)
      .run()
    return
  }

  // email / sms / push: route through the Integration Hub provider
  // abstraction (src/lib/notification-providers.ts). This project has NO
  // real external provider credentials configured anywhere (confirmed via
  // audit) — every dispatch here uses the deterministic TEST adapter,
  // truthfully recorded as such. A real provider integration would be
  // added to notification-providers.ts's PROVIDER_REGISTRY without
  // touching this function.
  const { dispatchViaProvider } = await import('./notification-providers')
  const outcome = await dispatchViaProvider(db, channel, {
    recipientUserId: event.recipient_user_id,
    subject: rendered?.subject ?? null,
    body: rendered?.body ?? '',
    actionUrl: rendered?.actionUrl ?? null,
  })

  const attemptCountAfter = attemptCountBefore + 1
  const retryDelayMinutes = outcome.status === 'failed' && outcome.failureClass === 'transient' ? nextRetryDelayMinutes(attemptCountAfter) : null

  await db
    .prepare(
      `UPDATE notification_deliveries
       SET status = ?, provider_key = ?, attempt_count = ?, last_attempted_at = datetime('now'),
           delivered_at = CASE WHEN ? = 'delivered' THEN datetime('now') ELSE delivered_at END,
           last_error = ?, failure_class = ?, provider_response_json = ?,
           next_retry_at = ${retryDelayMinutes !== null ? `datetime('now', '+${retryDelayMinutes} minutes')` : 'NULL'},
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(outcome.status, outcome.providerKey, attemptCountAfter, outcome.status, outcome.error ?? null, outcome.failureClass ?? null, JSON.stringify(outcome.raw ?? {}), deliveryId)
    .run()
}

/** Dispatches ONE channel for ONE outbox event. Creates its notification_deliveries row (CAS-safe). Never throws — every failure mode is recorded as delivery-row state. */
async function dispatchChannel(db: D1Database, event: OutboxRow, channel: NotificationChannel, payload: Record<string, unknown>): Promise<void> {
  // CAS-safe delivery row creation: UNIQUE(outbox_id, channel) means a
  // concurrent re-processing attempt can never create a second row for the
  // same (event, channel) pair. Uses meta.changes, not meta.rows_written —
  // see enqueueNotificationEvent's doc comment for the evidence-based
  // reason (INSERT...ON CONFLICT DO NOTHING no-ops report rows_written>0
  // on this D1/Miniflare version; changes is the one that's actually 0).
  const insert = await db
    .prepare(`INSERT INTO notification_deliveries (outbox_id, channel, status) VALUES (?, ?, 'queued') ON CONFLICT(outbox_id, channel) DO NOTHING`)
    .bind(event.id, channel)
    .run()
  if ((insert.meta.changes ?? 0) === 0) return // already dispatched (or in flight) — no-op, not an error

  const deliveryRow = await db
    .prepare('SELECT id FROM notification_deliveries WHERE outbox_id = ? AND channel = ?')
    .bind(event.id, channel)
    .first<{ id: number }>()
  if (!deliveryRow) return

  await performDispatchAndRecord(db, event, channel, payload, deliveryRow.id, 0)
}

export interface RetryOutcome {
  attempted: number
  retried: number
}

/**
 * Bounded catch-up pass for TRANSIENTLY-failed deliveries whose
 * next_retry_at has arrived. CAS-claims each row (UPDATE ... WHERE
 * status='failed' — a racing concurrent retry pass that already claimed
 * it sees 0 rows_written and safely skips), so two concurrent retry
 * passes can never double-dispatch the same delivery row. Reuses the
 * SAME row via performDispatchAndRecord — never creates a duplicate
 * delivery for the same (outbox_id, channel) pair. Called from the same
 * admin-triggered "process on request" endpoint as processOutboxBatch —
 * no cron, no fake background worker.
 */
export async function retryFailedDeliveries(db: D1Database, limit = 25): Promise<RetryOutcome> {
  const { results } = await db
    .prepare(
      `SELECT id, outbox_id, channel, attempt_count FROM notification_deliveries
       WHERE status = 'failed' AND failure_class = 'transient' AND next_retry_at IS NOT NULL
             AND next_retry_at <= datetime('now') AND attempt_count < ?
       ORDER BY next_retry_at ASC LIMIT ?`
    )
    .bind(MAX_DELIVERY_ATTEMPTS, limit)
    .all<{ id: number; outbox_id: number; channel: NotificationChannel; attempt_count: number }>()

  let retried = 0
  for (const row of results) {
    // CAS claim: only proceed if this row is STILL 'failed' at the moment
    // we flip it — a concurrent retry pass that got here first already
    // moved it off 'failed', so this UPDATE affects 0 rows and we skip.
    const claim = await db
      .prepare(`UPDATE notification_deliveries SET status = 'queued', updated_at = datetime('now') WHERE id = ? AND status = 'failed'`)
      .bind(row.id)
      .run()
    if ((claim.meta.rows_written ?? 0) === 0) continue

    const event = await db.prepare('SELECT * FROM notification_outbox WHERE id = ?').bind(row.outbox_id).first<OutboxRow>()
    if (!event) continue
    const payload = JSON.parse(event.payload_json || '{}') as Record<string, unknown>

    try {
      await performDispatchAndRecord(db, event, row.channel, payload, row.id, row.attempt_count)
      retried++
    } catch (err) {
      // Never let a retry-pass failure propagate — record it and move on
      // to the next row; this delivery keeps its now-'queued' state only
      // transiently (a future retry pass will see it as neither 'failed'
      // nor eligible until manually reconciled — acceptable because this
      // is a rare in-process-exception case, not the normal path).
      console.error(`notifications: retryFailedDeliveries dispatch failed for delivery ${row.id} (isolated)`, err)
      await db
        .prepare(`UPDATE notification_deliveries SET status = 'failed', failure_class = 'transient', next_retry_at = NULL, last_error = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(String((err as any)?.message ?? err), row.id)
        .run()
    }
  }
  return { attempted: results.length, retried }
}

/**
 * Bounded catch-up pass: processes up to `limit` pending outbox events.
 * This is the "lazy periodic work on incoming request" pattern this
 * project's own operating constraints require (no cron/triggers/Queue
 * binding available under hosted deploy) — called from a lightweight
 * admin-triggered endpoint, never a background timer.
 */
export async function processOutboxBatch(db: D1Database, limit = 25): Promise<{ attempted: number; processed: number }> {
  const { results } = await db
    .prepare(`SELECT id FROM notification_outbox WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`)
    .bind(limit)
    .all<{ id: number }>()

  let processed = 0
  for (const row of results) {
    const outcome = await processOutboxEvent(db, row.id)
    if (outcome.processed) processed++
  }
  return { attempted: results.length, processed }
}

/**
 * Convenience wrapper for the common "enqueue then immediately try to
 * deliver in-app right away" path most event writers want (so a user sees
 * the in-app notification without waiting for a separate catch-up pass).
 * Still fully safe to call from inside a financial transaction's
 * post-commit step — enqueueNotificationEvent's INSERT and this
 * immediate processOutboxEvent call are BOTH local D1 operations with no
 * external network dependency for the in_app channel; any email/sms/push
 * channel failure inside processOutboxEvent is caught and recorded, never
 * thrown back to this caller.
 */
export async function enqueueAndProcessNow(db: D1Database, input: EnqueueEventInput): Promise<EnqueueResult> {
  const result = await enqueueNotificationEvent(db, input)
  if (result.outboxId && result.created) {
    try {
      await processOutboxEvent(db, result.outboxId)
    } catch (err) {
      // Never let a delivery-fanout failure propagate to the financial/
      // business caller — the event is durably enqueued either way and a
      // future catch-up pass (processOutboxBatch) will retry it.
      console.error('notifications: inline processOutboxEvent failed (non-fatal, event remains durable for catch-up)', err)
    }
  }
  return result
}

export type { AuthUser }
