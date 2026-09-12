-- Migration 0016: Naijasend Driver Foundation
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
-- belonging to migration "0016_naijasend_driver_foundation.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS driver_profiles (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  provider_id        INTEGER REFERENCES logistics_providers(id),  
  license_number     TEXT NOT NULL,
  country_iso        TEXT NOT NULL,          
  status             TEXT NOT NULL DEFAULT 'pending_verification'
                       CHECK (status IN ('pending_verification', 'active', 'suspended', 'deactivated')),
  is_online          INTEGER NOT NULL DEFAULT 0,   
  last_online_at     TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_driver_profiles_country ON driver_profiles(country_iso);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_provider ON driver_profiles(provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_profiles_user_unique ON driver_profiles(user_id);

CREATE TABLE IF NOT EXISTS driver_documents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id           INTEGER NOT NULL REFERENCES driver_profiles(id),
  document_type       TEXT NOT NULL CHECK (document_type IN ('drivers_license', 'national_id', 'background_check', 'other')),
  r2_object_key       TEXT NOT NULL UNIQUE,   
  original_filename   TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  file_size_bytes     INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_driver_documents_driver ON driver_documents(driver_id, id);

CREATE TABLE IF NOT EXISTS driver_vehicle_assignments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id      INTEGER NOT NULL REFERENCES driver_profiles(id),
  vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id),
  assigned_at    TEXT NOT NULL DEFAULT (datetime('now')),
  unassigned_at  TEXT,
  is_current     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_dva_driver_current ON driver_vehicle_assignments(driver_id, is_current);
CREATE INDEX IF NOT EXISTS idx_dva_vehicle_current ON driver_vehicle_assignments(vehicle_id, is_current);

