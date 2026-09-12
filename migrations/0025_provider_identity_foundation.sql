-- Migration 0025: Provider Identity Foundation
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
-- belonging to migration "0025_provider_identity_foundation.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS provider_organizations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  organization_type    TEXT NOT NULL CHECK (organization_type IN ('individual_business', 'company', 'agency')),
  country_iso          TEXT NOT NULL,       
  contact_email        TEXT,
  contact_phone        TEXT,
  verification_status  TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_organizations_country ON provider_organizations(country_iso);

CREATE TABLE IF NOT EXISTS "provider_profiles" (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL REFERENCES users(id),
  provider_type        TEXT NOT NULL CHECK (provider_type IN ('gig_provider', 'host', 'driver_operator', 'restaurant_operator')),
  organization_id      INTEGER REFERENCES provider_organizations(id),
  display_name         TEXT NOT NULL,
  bio                  TEXT NOT NULL DEFAULT '',
  contact_email        TEXT,
  contact_phone        TEXT,
  country_iso          TEXT NOT NULL,
  service_area_json    TEXT NOT NULL DEFAULT '{}',
  verification_status  TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  operational_status   TEXT NOT NULL DEFAULT 'active' CHECK (operational_status IN ('active', 'paused', 'suspended')),
  onboarding_completed_at TEXT,
  payout_method        TEXT,
  payout_destination_json TEXT,
  rating_avg           REAL NOT NULL DEFAULT 0,
  rating_count         INTEGER NOT NULL DEFAULT 0,
  metadata_json        TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  avatar_url           TEXT   
);

CREATE INDEX IF NOT EXISTS idx_provider_profiles_country ON provider_profiles(country_iso);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_organization ON provider_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_type_status ON provider_profiles(provider_type, operational_status);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_user ON provider_profiles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_profiles_user_type_unique ON provider_profiles(user_id, provider_type);

CREATE TABLE IF NOT EXISTS "provider_profile_status_events" (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_profile_id INTEGER NOT NULL REFERENCES "provider_profiles"(id),
  status_type         TEXT NOT NULL CHECK (status_type IN ('verification', 'operational')),
  status              TEXT NOT NULL,
  actor_user_id       INTEGER REFERENCES users(id),
  note                TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_profile_status_events_profile ON provider_profile_status_events(provider_profile_id, id);

