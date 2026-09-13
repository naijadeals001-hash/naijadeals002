/**
 * Engine 11 (Search & Discovery), Phase 1 — search index event writer.
 *
 * ARCHITECTURE (see docs/ENGINE-11-SEARCH-DISCOVERY-AUDIT.md and
 * migrations/0047_search_index_events.sql's header for the full
 * audit/design rationale):
 *
 *   business write (createProduct/updateProduct/createServiceListing/
 *   updateServiceListing/create+updateBookableListing/adjustStock/
 *   listing create+update)
 *         |
 *         v
 *   enqueueSearchIndexEvent()  -- durable, idempotent INSERT into
 *   |                             search_index_events (UNIQUE idempotency_key)
 *   v
 *   (Phase 2, NOT YET BUILT) an indexer claims pending events (CAS:
 *   pending->processing), re-reads the canonical entity AND its owning
 *   seller/provider's current status via computeSearchEligibility(),
 *   and applies the result to an FTS5 corpus.
 *
 * WHY THIS IS A SEPARATE TABLE FROM notification_outbox (migration 0045):
 * search-index events have no recipient/notifiable-user concept and no
 * notification "category" — see migration 0047's header Finding 2 for
 * the full reasoning. This module deliberately does NOT touch
 * notification_outbox or notifications.ts at all.
 *
 * WHY THIS DOES NOT DEPEND ON cc_domain_events: confirmed by exhaustive
 * grep that cc_domain_events is written by exactly 3 call sites
 * (booking-lifecycle.ts, order-lifecycle.ts, moderation.ts) and read by
 * NOTHING in src/ — a dormant, write-only audit trail, not an event
 * source. See migration 0047's header Finding 1.
 *
 * FINANCIAL/OPERATIONAL SAFETY (non-negotiable, per the user's explicit
 * Phase 1 mandate): enqueueSearchIndexEvent() is a single fast local
 * INSERT with no network calls, no indexer dependency, and is designed
 * to NEVER throw in a way that could abort the caller's business
 * mutation — every call site wraps this in its own try/catch, exactly
 * mirroring the enqueueAndProcessNow() direct-call precedent found in
 * order-lifecycle.ts/booking-lifecycle.ts. A search-index outage or bug
 * must never break a product/listing/stock write.
 *
 * THIN POINTER ONLY: this module never accepts or stores a copy of the
 * searchable record itself (no title/price/description/etc. parameters
 * anywhere in this file). It accepts only entity_type, entity_id,
 * operation, and the entity's own source_updated_at value. A future
 * indexer always re-reads the canonical row (and its owning
 * seller/provider's current status) to decide current eligibility —
 * event writers stay "dumb" by design (see migration 0047 Finding 5).
 *
 * PHASE 1 SCOPE BOUNDARY: this file contains no FTS5 code, no indexer,
 * no "process now" step. Phase 1's acceptance bar (per the user's
 * explicit instruction) is a trustworthy, idempotent, correctly-ordered
 * event stream — not working search. A processSearchIndexEventBatch()-
 * style consumer is explicit Phase 2 scope.
 */

export type SearchEntityType = 'product' | 'product_listing' | 'service_listing' | 'bookable_listing'
export type SearchIndexOperation = 'upsert' | 'delete'

export interface EnqueueSearchIndexEventInput {
  entityType: SearchEntityType
  entityId: number
  operation: SearchIndexOperation
  /**
   * The entity's own updated_at value (ISO/`datetime('now')` string) at
   * the moment this event is enqueued, OR the delete-detection timestamp
   * for a 'delete' operation. Used by a future indexer for stale-event/
   * newer-wins protection — NEVER a copy of any other field.
   */
  sourceUpdatedAt: string
}

export interface EnqueueSearchIndexEventResult {
  eventId: number | null
  /** false when the (entityType, entityId, operation, sourceUpdatedAt) idempotency key already existed — this is the EXPECTED, correct outcome for a duplicate call, not an error. */
  created: boolean
}

/**
 * Deterministic, business-semantic idempotency key: one key per distinct
 * (entity, operation, source_updated_at) real-world occurrence, exactly
 * mirroring notification_outbox's idempotency-key discipline. A retried
 * or duplicate call for the SAME row at the SAME updated_at value always
 * collapses to a single row. A genuinely new change (a later
 * updated_at, or a delete after an upsert) always produces a NEW key.
 */
function buildIdempotencyKey(input: EnqueueSearchIndexEventInput): string {
  return `${input.entityType}:${input.entityId}:${input.operation}:${input.sourceUpdatedAt}`
}

/**
 * Durable, idempotent enqueue. Safe to call multiple times (concurrently
 * or sequentially) for the SAME (entityType, entityId, operation,
 * sourceUpdatedAt) occurrence — only the first call creates a row, every
 * subsequent call is a confirmed no-op (created: false).
 *
 * CAS guard: `INSERT ... ON CONFLICT(idempotency_key) DO NOTHING`, then a
 * SELECT to report which outcome actually happened.
 *
 * IMPORTANT — reuses the Engine 9 bug fix directly rather than
 * re-discovering it: `result.meta.rows_written` is NOT a reliable way to
 * detect an `ON CONFLICT DO NOTHING` no-op on this project's D1/Miniflare
 * version (a no-op conflicting insert still reports `rows_written: 1` due
 * to secondary index bookkeeping — confirmed and documented in
 * notifications.ts's enqueueNotificationEvent() doc comment, verified by
 * Engine 9's idempotency test suite). `result.meta.changes` correctly
 * reports 0 for the no-op and 1 for a genuine insert in every case
 * tested. This function uses `meta.changes` from the outset.
 *
 * Never throws for a duplicate. Only throws for a genuine input error
 * (CHECK constraint violation on entityType/operation) or a real DB
 * failure — callers MUST wrap this in their own try/catch (see module
 * doc comment) so a search-index failure can never break the business
 * mutation that just committed.
 */
export async function enqueueSearchIndexEvent(
  db: D1Database,
  input: EnqueueSearchIndexEventInput
): Promise<EnqueueSearchIndexEventResult> {
  const idempotencyKey = buildIdempotencyKey(input)

  const result = await db
    .prepare(
      `INSERT INTO search_index_events (idempotency_key, entity_type, entity_id, operation, source_updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`
    )
    .bind(idempotencyKey, input.entityType, input.entityId, input.operation, input.sourceUpdatedAt)
    .run()

  const created = (result.meta.changes ?? 0) > 0
  if (!created) {
    const existing = await db
      .prepare('SELECT id FROM search_index_events WHERE idempotency_key = ?')
      .bind(idempotencyKey)
      .first<{ id: number }>()
    return { eventId: existing?.id ?? null, created: false }
  }

  const row = await db
    .prepare('SELECT id FROM search_index_events WHERE idempotency_key = ?')
    .bind(idempotencyKey)
    .first<{ id: number }>()
  return { eventId: row?.id ?? null, created: true }
}
