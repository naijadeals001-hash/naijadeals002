-- Migration 0041: Booking Engine 2.0 — Universal Availability, Reservations,
-- Appointments, Capacity & Booking Foundation
--
-- NEW APPLICATION FEATURE, built on top of EXISTING infrastructure that was
-- already reconstructed into this database but had ZERO application code
-- and ZERO rows using it (confirmed during inspection):
--   - bookable_listings / booking_availability_blocks / bookings /
--     booking_status_events (migration 0024) — the pre-existing generic
--     booking foundation. Confirmed via direct D1 query: all four tables
--     have 0 rows in production/local. service_orders.booking_id (added by
--     migration 0039, this same rebuild's Service Engine 2.0 work) is a
--     schema-only bridge column, never populated by any current code path
--     (service_orders id=1 has booking_id=NULL, confirmed live) — this
--     migration's application code (see src/lib/bookings.ts) is what
--     finally wires that bridge for real.
--   - organization_permissions already seeded 'bookings.manage' /
--     'bookings.read' and granted them to owner/admin/manager (manage) and
--     staff (read) (migration 0037) — reused AS-IS for org-owned bookings,
--     no new RBAC system.
--   - cc_countries (migration 0013, seeded migration 0040) — reused for
--     country-neutral timezone defaulting (new default_timezone column
--     added below) rather than hardcoding Africa/Lagos anywhere in
--     application logic.
--
-- NON-NEGOTIABLE COMPATIBILITY RULES (mirrors 0038/0039/0040's own headers):
--   - Zero destructive changes to any OTHER table. No existing table
--     dropped/rebuilt except `bookings` itself (see below), which currently
--     holds ZERO rows anywhere (verified live) — rebuilding it to widen its
--     status CHECK constraint is a zero-data-risk, schema-only operation,
--     using the exact same CREATE-rebuild -> INSERT SELECT -> DROP -> RENAME
--     pattern already used by migration 0027 for the `reviews` table.
--   - bookable_listings.listing_type/booking_mode/pricing_unit CHECK
--     constraints are UNCHANGED — 'gig_service'/'stay_unit' remain the only
--     values, reused as-is by every future vertical exactly like the
--     Service Engine already does. New verticals add new listing_type
--     values only if genuinely needed later; this migration adds no new
--     listing_type value.
--   - Every ALTER TABLE ADD COLUMN uses a CONSTANT literal default (never
--     datetime('now') or any function call) per the SQLite restriction
--     already documented in 0027/0037/0038/0039.
--   - Every new table is CREATE TABLE IF NOT EXISTS, every new index is
--     CREATE INDEX IF NOT EXISTS.
--   - No new payment/ledger table. Booking payments (escrow hold/release/
--     refund) route through the EXISTING wallet_ledger via
--     src/lib/wallet.ts's creditWallet/debitWallet — this migration only
--     adds the BOOKING-side commerce fields (cancellation fee, refund
--     amount) that reference the financial operation, never a competing
--     ledger, exactly mirroring migration 0040's refunds/disputes pattern.
--   - Double-booking prevention is enforced by ATOMIC single-statement
--     INSERT...SELECT...WHERE NOT EXISTS capacity checks in application
--     code (src/lib/booking-holds.ts / src/lib/bookings.ts), not by a
--     table constraint alone (SQLite has no native "no overlapping ranges"
--     constraint) — documented in those files' header comments.

-- ============================================================
-- 1. COUNTRY-NEUTRAL TIMEZONE (extends the EXISTING cc_countries table,
--    migration 0013 / seeded 0040) — spec's explicit requirement that
--    "a booking made in Lagos must not shift on a server in a different
--    timezone" AND "must support future African markets", without
--    hardcoding Africa/Lagos anywhere in the generic booking tables below.
-- ============================================================
ALTER TABLE cc_countries ADD COLUMN default_timezone TEXT NOT NULL DEFAULT 'Africa/Lagos';

UPDATE cc_countries SET default_timezone = 'Africa/Lagos'   WHERE iso_code = 'NG';
UPDATE cc_countries SET default_timezone = 'Africa/Accra'   WHERE iso_code = 'GH';
UPDATE cc_countries SET default_timezone = 'Africa/Nairobi' WHERE iso_code = 'KE';
UPDATE cc_countries SET default_timezone = 'Africa/Johannesburg' WHERE iso_code = 'ZA';
UPDATE cc_countries SET default_timezone = 'Africa/Kampala' WHERE iso_code = 'UG';
UPDATE cc_countries SET default_timezone = 'Africa/Dar_es_Salaam' WHERE iso_code = 'TZ';
UPDATE cc_countries SET default_timezone = 'Africa/Kigali' WHERE iso_code = 'RW';
UPDATE cc_countries SET default_timezone = 'Africa/Dakar'  WHERE iso_code = 'SN';
UPDATE cc_countries SET default_timezone = 'Africa/Abidjan' WHERE iso_code = 'CI';
UPDATE cc_countries SET default_timezone = 'Africa/Douala' WHERE iso_code = 'CM';

-- ============================================================
-- 2. BOOKABLE_LISTINGS extensions — generic resource/capacity/pricing
--    metadata that migration 0024 did not anticipate (single-capacity,
--    no timezone, no org ownership, no cancellation policy link).
-- ============================================================
ALTER TABLE bookable_listings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Africa/Lagos';
ALTER TABLE bookable_listings ADD COLUMN capacity_model TEXT NOT NULL DEFAULT 'single';
ALTER TABLE bookable_listings ADD COLUMN is_date_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookable_listings ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE bookable_listings ADD COLUMN cancellation_policy_id INTEGER;
ALTER TABLE bookable_listings ADD COLUMN vertical TEXT;
ALTER TABLE bookable_listings ADD COLUMN deposit_percentage INTEGER NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_bookable_listings_org ON bookable_listings(organization_id);

-- ============================================================
-- 3. BOOKING_RESOURCES — explicit resource/capacity model (spec's core
--    requirement: "capacity is never assumed to be 1"). Every
--    bookable_listing gets >=1 resource row (mirrors Service Engine's
--    "every provider gets one implicit Primary resource" pattern in
--    src/lib/providers.ts) so downstream availability/allocation logic
--    never special-cases "listing has no resources yet".
--    capacity_units models: a single room (1), a pooled inventory of N
--    identical units (N), or a named individually-schedulable resource
--    (staff member, equipment unit, seat) with its own capacity (usually 1).
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_resources (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id       INTEGER NOT NULL REFERENCES bookable_listings(id) ON DELETE CASCADE,
  name             TEXT NOT NULL DEFAULT 'Default',
  resource_type    TEXT NOT NULL DEFAULT 'pooled' CHECK (resource_type IN ('physical', 'staff', 'equipment', 'virtual', 'pooled')),
  capacity_units   INTEGER NOT NULL DEFAULT 1 CHECK (capacity_units > 0),
  is_active        INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_booking_resources_listing ON booking_resources(listing_id, is_active);

-- ============================================================
-- 4. BOOKING_AVAILABILITY_RULES — recurring weekly schedule, DISTINCT from
--    the existing one-off booking_availability_blocks (which remains the
--    override/blackout mechanism — a rule says "generally open Mon 9-17",
--    a block says "but NOT this specific Monday 10-12"). Not hardcoded per
--    vertical: a rule can optionally cap capacity below the resource's
--    full capacity_units for that window (e.g. reduced weekend capacity).
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_availability_rules (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id         INTEGER NOT NULL REFERENCES booking_resources(id) ON DELETE CASCADE,
  day_of_week         INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time          TEXT NOT NULL,
  end_time            TEXT NOT NULL,
  capacity_override   INTEGER,
  effective_from      TEXT,
  effective_until     TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_booking_availability_rules_resource ON booking_availability_rules(resource_id, day_of_week, is_active);

-- ============================================================
-- 5. BOOKING_HOLDS — temporary, auto-expiring reservation holds (spec's
--    "Search -> Availability -> Select -> Hold -> Price -> Confirm ->
--    Payment -> Created" flow). expires_at is checked LAZILY on read
--    (no cron trigger on hosted deploy — same documented pattern as
--    src/lib/service-requests.ts's expireQuoteIfNeeded), never trusted to
--    a frontend timer alone (spec's explicit "not frontend-timer-only"
--    requirement) — see src/lib/booking-holds.ts's expireHoldIfNeeded.
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_holds (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id            INTEGER NOT NULL REFERENCES bookable_listings(id),
  resource_id           INTEGER NOT NULL REFERENCES booking_resources(id),
  customer_user_id      INTEGER NOT NULL REFERENCES users(id),
  starts_at             TEXT NOT NULL,
  ends_at               TEXT NOT NULL,
  capacity_requested    INTEGER NOT NULL DEFAULT 1 CHECK (capacity_requested > 0),
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'converted', 'released')),
  expires_at            TEXT NOT NULL,
  converted_to_booking_id INTEGER REFERENCES bookings(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_booking_holds_resource_window ON booking_holds(resource_id, starts_at, ends_at, status);
CREATE INDEX IF NOT EXISTS idx_booking_holds_customer ON booking_holds(customer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_booking_holds_expiry ON booking_holds(status, expires_at);

-- ============================================================
-- 6. BOOKING_RESOURCE_ALLOCATIONS — the explicit "what exactly is
--    unavailable" record (spec's core CRITICAL requirement), separate from
--    the mutable bookings.status column: one row per booking<->resource
--    time-window<->capacity-consumed. Released (status='released') on
--    cancellation rather than deleted, preserving history.
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_resource_allocations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id         INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  resource_id        INTEGER NOT NULL REFERENCES booking_resources(id),
  capacity_consumed  INTEGER NOT NULL DEFAULT 1 CHECK (capacity_consumed > 0),
  starts_at          TEXT NOT NULL,
  ends_at            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_booking_allocations_resource_window ON booking_resource_allocations(resource_id, starts_at, ends_at, status);
CREATE INDEX IF NOT EXISTS idx_booking_allocations_booking ON booking_resource_allocations(booking_id);

-- ============================================================
-- 7. BOOKING_CANCELLATION_POLICIES — reusable named structures, not
--    hardcoded policy names per vertical. policy_type is a semantic label
--    (flexible/moderate/strict/custom); the actual enforceable numbers are
--    cutoff_hours_before_start + the two refund percentages + flat fee.
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_cancellation_policies (
  id                              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id                   INTEGER REFERENCES users(id),
  organization_id                 INTEGER REFERENCES organizations(id),
  name                            TEXT NOT NULL,
  policy_type                     TEXT NOT NULL DEFAULT 'moderate' CHECK (policy_type IN ('flexible', 'moderate', 'strict', 'custom')),
  cutoff_hours_before_start       INTEGER NOT NULL DEFAULT 24 CHECK (cutoff_hours_before_start >= 0),
  refund_percentage_before_cutoff INTEGER NOT NULL DEFAULT 100 CHECK (refund_percentage_before_cutoff BETWEEN 0 AND 100),
  refund_percentage_after_cutoff  INTEGER NOT NULL DEFAULT 0 CHECK (refund_percentage_after_cutoff BETWEEN 0 AND 100),
  flat_fee_kobo                   INTEGER NOT NULL DEFAULT 0 CHECK (flat_fee_kobo >= 0),
  is_active                       INTEGER NOT NULL DEFAULT 1,
  created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (owner_user_id IS NOT NULL OR organization_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cancellation_policies_owner ON booking_cancellation_policies(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_policies_org ON booking_cancellation_policies(organization_id);

-- ============================================================
-- 8. BOOKING_STATUS_EVENTS extension (migration 0024's table reused
--    as-is, additively) — actor_role + metadata_json for full auditability
--    (spec's "created_by/confirmed_by/cancelled_by/... via booking status
--    events" requirement), mirroring order_item_status_events (0040).
-- ============================================================
ALTER TABLE booking_status_events ADD COLUMN actor_role TEXT;
ALTER TABLE booking_status_events ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

-- ============================================================
-- 9. BOOKINGS table rebuild — migration 0024's status CHECK constraint
--    ('pending_request','confirmed','declined','cancelled','completed',
--    'no_show') is too narrow for the spec's universal lifecycle
--    (draft/held/pending_payment/confirmed/checked_in/in_progress/
--    completed/cancelled/expired/no_show/refunded/disputed). SQLite cannot
--    ALTER a CHECK constraint in place. This table has ZERO rows anywhere
--    (verified live via direct D1 query before writing this migration) —
--    a full rebuild is a zero-data-risk, schema-only operation, using the
--    EXACT same CREATE-rebuild -> INSERT SELECT -> DROP -> RENAME pattern
--    migration 0027 already used for `reviews`. New columns added at the
--    same time: resource_id/capacity_booked/hold_id (capacity model),
--    timezone (country-neutral time handling), cancellation_policy_id +
--    cancellation_fee_kobo + refund_amount_kobo (policy-driven
--    cancellation), rescheduled_from_booking_id (reschedule history),
--    checked_in_at/checked_out_at (generic check-in/out, not hotel-only
--    terminology), confirmed_by/cancelled_by/completed_by_user_id
--    (auditability), organization_id (org-owned bookings), booking_group_id
--    (future multi-booking trip grouping, spec's explicit "not fully built
--    initially" allowance).
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings__rebuild_0041 (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_number          TEXT NOT NULL UNIQUE,
  listing_id              INTEGER NOT NULL REFERENCES bookable_listings(id),
  resource_id             INTEGER REFERENCES booking_resources(id),
  listing_type_snapshot   TEXT NOT NULL,
  customer_user_id        INTEGER NOT NULL REFERENCES users(id),
  provider_user_id        INTEGER NOT NULL REFERENCES users(id),
  organization_id         INTEGER REFERENCES organizations(id),
  hold_id                 INTEGER REFERENCES booking_holds(id),
  starts_at               TEXT NOT NULL,
  ends_at                 TEXT NOT NULL,
  timezone                TEXT NOT NULL DEFAULT 'Africa/Lagos',
  capacity_booked         INTEGER NOT NULL DEFAULT 1 CHECK (capacity_booked > 0),
  guests_count            INTEGER,
  total_price_kobo        INTEGER NOT NULL CHECK (total_price_kobo > 0),
  currency                TEXT NOT NULL DEFAULT 'NGN',
  payment_status          TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'escrow_held', 'released', 'refunded', 'partially_refunded')),
  payment_reference       TEXT,
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft', 'held', 'pending_payment', 'confirmed', 'checked_in', 'in_progress',
                            'completed', 'cancelled', 'expired', 'no_show', 'refunded', 'disputed', 'declined'
                          )),
  cancellation_policy_id  INTEGER REFERENCES booking_cancellation_policies(id),
  cancellation_fee_kobo   INTEGER NOT NULL DEFAULT 0,
  refund_amount_kobo      INTEGER NOT NULL DEFAULT 0,
  cancelled_reason        TEXT,
  rescheduled_from_booking_id INTEGER REFERENCES bookings(id),
  booking_group_id        TEXT,
  checked_in_at           TEXT,
  checked_out_at          TEXT,
  confirmed_by_user_id    INTEGER REFERENCES users(id),
  cancelled_by_user_id    INTEGER REFERENCES users(id),
  completed_by_user_id    INTEGER REFERENCES users(id),
  metadata_json           TEXT NOT NULL DEFAULT '{}',
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO bookings__rebuild_0041
  (id, booking_number, listing_id, listing_type_snapshot, customer_user_id, provider_user_id,
   starts_at, ends_at, guests_count, total_price_kobo, currency, payment_status, payment_reference,
   status, cancelled_reason, created_at, updated_at)
SELECT id, booking_number, listing_id, listing_type_snapshot, customer_user_id, provider_user_id,
       starts_at, ends_at, guests_count, total_price_kobo, currency, payment_status, payment_reference,
       status, cancelled_reason, created_at, updated_at
FROM bookings;

DROP TABLE bookings;
ALTER TABLE bookings__rebuild_0041 RENAME TO bookings;

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_user_id, id);
CREATE INDEX IF NOT EXISTS idx_bookings_listing_window ON bookings(listing_id, starts_at, ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_number_unique ON bookings(booking_number);
CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_user_id, id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_resource_window ON bookings(resource_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_bookings_organization ON bookings(organization_id);
CREATE INDEX IF NOT EXISTS idx_bookings_group ON bookings(booking_group_id);

-- ============================================================
-- 10. SERVICE ENGINE RETROFIT BRIDGE — the confirmed dead schema-only
--     bridge (service_orders.booking_id, migration 0039) needs no new
--     column here (it already exists and already references bookings(id),
--     which still exists post-rebuild), only application code
--     (src/lib/service-orders.ts) to actually populate it. Left as a
--     documented follow-up wiring step, not a schema change.
-- ============================================================
-- (intentionally no DDL in this section — see REMAINING GAP in final report)
