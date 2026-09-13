-- ============================================================
-- Migration 0047: Engine 11 (Search & Discovery) — search_index_events
-- ============================================================
--
-- FORENSIC AUDIT FINDINGS THIS MIGRATION IS BUILT ON
-- ----------------------------------------------------------
-- See docs/ENGINE-11-SEARCH-DISCOVERY-AUDIT.md (Phase 0, committed 7da96e4)
-- and docs/ENGINE-11-GEO-COVERAGE-MEASUREMENT.md (committed 9a0f9d2) for
-- the full evidence trail. Summary of the findings this table encodes:
--
-- Finding 1 — cc_domain_events is real but UNSUITABLE as an event source.
--   It is written by exactly 3 call sites (booking-lifecycle.ts,
--   order-lifecycle.ts, moderation.ts) and read by NOTHING anywhere in
--   src/ (confirmed by exhaustive grep for any SELECT against it). It is
--   a write-only audit trail, not a pub/sub or outbox mechanism. Zero
--   commerce/catalog write paths (products, listings, services,
--   bookable_listings, inventory) write to it at all.
--   DECISION: Engine 11 does NOT depend on cc_domain_events. Search index
--   events are enqueued via a direct, dedicated call
--   (enqueueSearchIndexEvent(), src/lib/search-index-events.ts) placed
--   inline at each real write path — mirroring the ACTUAL Engine 9
--   precedent found by reading order-lifecycle.ts/booking-lifecycle.ts:
--   a separate, independent, try/catch-wrapped direct call to
--   enqueueAndProcessNow(), not a consumer reading a shared events table.
--
-- Finding 2 — notification_outbox (migration 0045) is real, proven, and
--   operationally sound (idempotency_key UNIQUE + CAS claim lifecycle
--   pending->processing->processed|failed + attempts/last_error), but its
--   schema is NOT reusable for search indexing:
--     - recipient_user_id INTEGER NOT NULL: search-index events have no
--       recipient/notifiable-user concept at all.
--     - category TEXT NOT NULL CHECK (...'transactional','marketing'...):
--       none of these values describe "a catalog/listing entity changed
--       and needs re-indexing."
--   DECISION: a NEW, purpose-built table — search_index_events — carries
--   forward notification_outbox's proven OPERATIONAL properties
--   (idempotency, CAS claim state, bounded retries via an attempts
--   counter, timestamps, failure information) without inheriting its
--   notification-specific columns.
--
-- Finding 3 — updated_at is a reliable, already-existing monotonic signal.
--   Direct inspection of createProduct()/updateProduct()
--   (src/lib/seller-products.ts), createServiceListing()/
--   updateServiceListing() (src/lib/services.ts), and the bookable
--   listing create/updateBookableListing() functions (src/lib/bookings.ts)
--   confirms updated_at is set via a table-level
--   `DEFAULT (datetime('now'))` on INSERT and explicitly bumped
--   (`updated_at = datetime('now')`) on every UPDATE, for all of:
--   products, product_listings, service_listings, bookable_listings.
--   DECISION: no new version-integer column is introduced anywhere.
--   source_updated_at (captured from the entity at enqueue time) is the
--   stale-event/newer-wins signal a future indexer compares against the
--   canonical row's current updated_at at processing time. No entity in
--   this migration's scope lacks a reliable signal, so none is flagged.
--
-- Finding 4 — nine real write paths require instrumentation (locked,
--   not to be reduced): sellerApi POST/PATCH /products (createProduct/
--   updateProduct), sellerApi POST/PATCH /listings, providerApi
--   POST/PATCH /providers/me/services (createServiceListing/
--   updateServiceListing), bookingsApi POST/PATCH .../bookable-listings
--   (create/updateBookableListing), and adjustStock() (src/lib/
--   inventory.ts:51) — the previously-missed 9th path, which mutates
--   product_listings.stock/updated_at but emits zero events today.
--   DECISION: entity_type is constrained to exactly the canonical
--   entities these 9 paths touch: 'product', 'product_listing',
--   'service_listing', 'bookable_listing'. Adding a new vertical's
--   entity type later (e.g. a future NaijaShop migration target) is a
--   new migration, matching this codebase's existing CHECK-constrained
--   enum discipline (see notification_outbox.category, .channel, etc.)
--   rather than an open-ended TEXT column that silently accepts typos.
--
-- Finding 5 — visibility/eligibility must NOT be decided by the writer.
--   The audit found two pre-existing, unrelated correctness gaps:
--   searchPublicListings() (src/lib/bookings.ts) never joins
--   provider_profiles.operational_status, and bookable_listings has no
--   moderation.ts-equivalent hook (unlike products). Both must be fixed
--   in a shared eligibility helper BEFORE any indexer exists — not
--   compensated for inside search_index_events.
--   DECISION: operation is constrained to exactly two values —
--   'upsert' (create/update/publish/unpublish/price-change/
--   stock-change/availability-change/moderation-change/verification-
--   change/suspension-change/location-change — anything requiring
--   re-evaluation) and 'delete' (hard deletion only). The row NEVER
--   carries an embedded copy of the searchable record. A future indexer
--   always re-reads the canonical entity AND its owning
--   seller/provider's current status to decide current eligibility —
--   event writers stay "dumb": they only signal "something changed,
--   re-check me."
--
-- Finding 6 — geo is measured, not assumed, to be out of scope here.
--   0 of 1,501 bookable_listings (0.0%) resolve to a real coordinate
--   through any existing join path (5 paths measured exhaustively).
--   DECISION: this migration adds no geo/location columns whatsoever.
--   Geo remains a Phase 4 (later) concern, gated on an upstream data/
--   onboarding decision, and is not referenced by this table at all.
--
-- SCHEMA-ONLY INVARIANT (carried forward from migrations 0005/0045):
-- this file applies cleanly to a completely empty D1 database and
-- inserts zero application-data rows.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO (Phase 1 scope boundary):
--   - No FTS5 virtual table is created here. FTS5 was directly tested
--     and confirmed working against this project's local D1 (see audit
--     §9), but the indexer/corpus itself is explicit Phase 2 scope.
--     Phase 1's acceptance bar is a trustworthy event stream with
--     correct visibility semantics — not working search.
--   - No trigger-based auto-enqueue. Event emission is an explicit,
--     inline function call at each of the 9 confirmed write paths
--     (enqueueSearchIndexEvent()), matching the direct-call precedent
--     found in order-lifecycle.ts/booking-lifecycle.ts, not a D1/SQLite
--     AFTER-UPDATE trigger (which would hide the side effect from the
--     application code that owns the business transaction, and cannot
--     itself be wrapped in an isolating try/catch the way an explicit
--     call site can).
--
-- NEW TABLE (additive only):
--   search_index_events — durable, idempotent, thin-pointer change
--   signal for the future search indexer. One row per distinct
--   (entity, operation, source_updated_at) business occurrence.

-- ============================================================
-- 1. SEARCH INDEX EVENTS — the durable idempotent thin-pointer queue
-- ============================================================
--
-- Idempotency model (identical discipline to notification_outbox,
-- migration 0045): idempotency_key is DERIVED FROM BUSINESS SEMANTICS —
-- `${entity_type}:${entity_id}:${operation}:${source_updated_at}` — one
-- key per real-world (entity, change) occurrence, not per enqueue call.
-- This means a client-side retry, a duplicate call from an already-
-- committed transaction, or an accidental double-invocation of the same
-- write path for the same row at the same updated_at value all collapse
-- to a single row via `INSERT ... ON CONFLICT(idempotency_key) DO
-- NOTHING` — the exact same CAS-guard discipline as Engine 9 and
-- Engine 7 before it. A GENUINELY new change (a later updated_at, or a
-- delete after an upsert) always produces a NEW idempotency_key and
-- therefore a new row — this table is an append-only change log per
-- entity, not a single mutable "latest state" row.
CREATE TABLE IF NOT EXISTS search_index_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key     TEXT NOT NULL UNIQUE,

  -- Thin pointer only — never an embedded copy of the searchable record.
  -- A future indexer always re-reads the canonical entity (and its
  -- owning seller/provider's current status) at processing time.
  entity_type         TEXT NOT NULL CHECK (entity_type IN
                        ('product','product_listing','service_listing','bookable_listing')),
  entity_id           INTEGER NOT NULL,

  -- Exactly two values (locked design decision — see Finding 5 above).
  -- 'upsert' = re-evaluate canonical state; eligibility is decided by
  -- the indexer's re-read, never by the writer. 'delete' = hard
  -- deletion of the canonical row only (never used for "became
  -- ineligible" — that is an 'upsert' that the indexer will resolve to
  -- "remove from index" after re-reading current state).
  operation           TEXT NOT NULL CHECK (operation IN ('upsert','delete')),

  -- Stale-event / newer-wins protection (Finding 3): the entity's own
  -- updated_at value at the moment this event was enqueued. A future
  -- indexer compares this against the canonical row's CURRENT
  -- updated_at before applying the event — an older event for the same
  -- entity that arrives/is-claimed after a newer one has already been
  -- processed is stale and should be marked 'superseded', never applied
  -- out of order. For 'delete' events (no post-delete updated_at
  -- exists) this is the delete-detection timestamp instead.
  source_updated_at   TEXT NOT NULL,

  -- Processing lifecycle. 'pending' -> 'processing' -> 'processed' |
  -- 'failed' | 'superseded'. 'processing' is a CAS claim state
  -- (mirrors notification_outbox / Engine 7's "claim once" discipline)
  -- so two indexer workers can never both act on the same event.
  -- 'superseded' is a DISTINCT terminal state from 'failed' — a
  -- superseded event is not an error, it is a legitimate skip because a
  -- newer event for the same entity already represents current truth.
  -- Conflating it with 'failed' would make stale-event protection
  -- indistinguishable from a real processing error in monitoring/alerts.
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                        ('pending','processing','processed','failed','superseded')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  next_retry_at       TEXT,          -- backoff scheduling for 'failed' events awaiting retry (app-layer computed)
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at        TEXT
);

-- Polling index for the future indexer: "give me pending events in
-- enqueue order" — mirrors idx_notification_outbox_status exactly.
CREATE INDEX IF NOT EXISTS idx_search_index_events_status
  ON search_index_events(status, created_at);

-- Retry-scheduling index: "give me failed events whose backoff has
-- elapsed" — separate from the status index above because next_retry_at
-- is only meaningful for a subset of 'failed' rows, not the whole table.
CREATE INDEX IF NOT EXISTS idx_search_index_events_retry
  ON search_index_events(status, next_retry_at);

-- Entity lookup index: "what is the latest event for this entity" —
-- used both by enqueueSearchIndexEvent() (to reason about superseding
-- prior pending events for the same entity, if that optimization is
-- added later) and by tests verifying ordering/idempotency behavior.
CREATE INDEX IF NOT EXISTS idx_search_index_events_entity
  ON search_index_events(entity_type, entity_id, created_at DESC);
