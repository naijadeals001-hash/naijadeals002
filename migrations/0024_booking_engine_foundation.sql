-- Migration 0024: Booking Engine Foundation
--
-- RECONSTRUCTED MIGRATION (not original production source code).
--
-- Provenance: This file was generated from PRODUCTION's live D1 schema,
-- captured read-only via `gsk hosted d1_schema` against naijadeals.com's
-- hosted database (project 393ef41c-f7b9-4ded-996a-2f5265e3280d, db uuid
-- bbbd12bf-e8cd-4e14-8413-76ed8b96ed1e) on 2026-09-12. Production's own
-- git_sha (99b1664df552ce1cd707330e17207d8869f12a4e) and its ORIGINAL
-- migrations/0013-0036 source files were never recovered (see
-- docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md). This file reproduces
-- the FINAL OBSERVED table structure (columns, types, defaults, foreign
-- keys, indexes) for the tables production's own /api/version reports as
-- belonging to migration "0024_booking_engine_foundation.sql", as closely as a final-state
-- schema dump allows.
--
-- Table-to-migration-number attribution beyond what /api/version's own
-- filenames imply is INFERRED (semantic grouping by subject area and
-- foreign-key dependency order), not independently confirmed against a
-- migration-by-migration production history (which does not exist to
-- inspect -- D1 does not retain per-migration column-level diffs, only
-- the current CREATE TABLE state). See
-- docs/NAIJADEALS-PRODUCTION-SCHEMA-MAP.md for the full mapping rationale
-- and confidence notes per table.
--

-- DO NOT apply this migration to production. Local/dev D1 only, per the
-- explicit read-only production-safety rule for this reconstruction phase.

CREATE TABLE IF NOT EXISTS bookable_listings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_type         TEXT NOT NULL CHECK (listing_type IN ('gig_service', 'stay_unit')),
  provider_user_id     INTEGER NOT NULL REFERENCES users(id),   
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  country_iso          TEXT NOT NULL,       
  city                 TEXT,
  booking_mode         TEXT NOT NULL CHECK (booking_mode IN ('instant', 'request')),
  pricing_unit         TEXT NOT NULL CHECK (pricing_unit IN ('per_booking', 'per_hour', 'per_night')),
  base_price_kobo      INTEGER NOT NULL CHECK (base_price_kobo > 0),
  currency             TEXT NOT NULL DEFAULT 'NGN',
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
, category TEXT, cover_image_url TEXT, stay_property_id INTEGER REFERENCES stay_properties(id));

CREATE INDEX IF NOT EXISTS idx_bookable_listings_category ON bookable_listings(listing_type, category);
CREATE INDEX IF NOT EXISTS idx_bookable_listings_country ON bookable_listings(country_iso);
CREATE INDEX IF NOT EXISTS idx_bookable_listings_provider ON bookable_listings(provider_user_id, id);
CREATE INDEX IF NOT EXISTS idx_bookable_listings_stay_property ON bookable_listings(stay_property_id);
CREATE INDEX IF NOT EXISTS idx_bookable_listings_type_active ON bookable_listings(listing_type, is_active);

CREATE TABLE IF NOT EXISTS booking_availability_blocks (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id           INTEGER NOT NULL REFERENCES bookable_listings(id) ON DELETE CASCADE,
  blocked_from         TEXT NOT NULL,
  blocked_until        TEXT NOT NULL,
  reason               TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_booking_availability_listing ON booking_availability_blocks(listing_id, blocked_from, blocked_until);

CREATE TABLE IF NOT EXISTS bookings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_number        TEXT NOT NULL UNIQUE,   
  listing_id            INTEGER NOT NULL REFERENCES bookable_listings(id),
  listing_type_snapshot TEXT NOT NULL,           
  customer_user_id      INTEGER NOT NULL REFERENCES users(id),   
  provider_user_id      INTEGER NOT NULL REFERENCES users(id),   
  starts_at             TEXT NOT NULL,   
  ends_at               TEXT NOT NULL,   
  guests_count          INTEGER,         
  total_price_kobo      INTEGER NOT NULL CHECK (total_price_kobo > 0),   
  currency              TEXT NOT NULL DEFAULT 'NGN',
  payment_status        TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'escrow_held', 'released', 'refunded')),  
  payment_reference      TEXT,
  status                TEXT NOT NULL DEFAULT 'pending_request' CHECK (status IN (
                           'pending_request', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show'
                         )),
  cancelled_reason       TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_user_id, id);
CREATE INDEX IF NOT EXISTS idx_bookings_listing_window ON bookings(listing_id, starts_at, ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_number_unique ON bookings(booking_number);
CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_user_id, id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS booking_status_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id     INTEGER NOT NULL REFERENCES bookings(id),
  status         TEXT NOT NULL,   
  actor_user_id  INTEGER REFERENCES users(id),   
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_booking_status_events_booking ON booking_status_events(booking_id, id);

