-- Migration 0034: Naijastay Foundation
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
-- belonging to migration "0034_naijastay_foundation.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS stay_properties (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                      TEXT NOT NULL UNIQUE,
  owner_provider_profile_id INTEGER NOT NULL REFERENCES provider_profiles(id),
  name                      TEXT NOT NULL,
  description               TEXT NOT NULL DEFAULT '',
  property_type             TEXT NOT NULL,   
  country_iso               TEXT NOT NULL,   
  city                       TEXT NOT NULL,
  neighborhood               TEXT,
  address_line1              TEXT,
  latitude                   REAL,
  longitude                  REAL,
  cover_image_url            TEXT,
  gallery_json               TEXT NOT NULL DEFAULT '[]',   
  amenities_json             TEXT NOT NULL DEFAULT '[]',   
  house_rules                TEXT NOT NULL DEFAULT '',
  check_in_info              TEXT NOT NULL DEFAULT '',
  check_out_info             TEXT NOT NULL DEFAULT '',
  cancellation_policy        TEXT NOT NULL DEFAULT '',
  is_active                  INTEGER NOT NULL DEFAULT 1,   
  verification_status        TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  rating_avg                 REAL NOT NULL DEFAULT 0,   
  rating_count                INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stay_properties_active ON stay_properties(is_active);
CREATE INDEX IF NOT EXISTS idx_stay_properties_city ON stay_properties(city);
CREATE INDEX IF NOT EXISTS idx_stay_properties_country ON stay_properties(country_iso);
CREATE INDEX IF NOT EXISTS idx_stay_properties_owner ON stay_properties(owner_provider_profile_id);
CREATE INDEX IF NOT EXISTS idx_stay_properties_type ON stay_properties(property_type);

CREATE TABLE IF NOT EXISTS stay_property_status_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id       INTEGER NOT NULL REFERENCES stay_properties(id),
  status_type       TEXT NOT NULL CHECK (status_type IN ('verification', 'active')),
  status            TEXT NOT NULL,
  actor_user_id     INTEGER REFERENCES users(id),
  note              TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stay_property_status_events_property ON stay_property_status_events(property_id, id);

