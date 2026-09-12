-- Migration 0015: Naijasend Logistics Foundation
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
-- belonging to migration "0015_naijasend_logistics_foundation.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS logistics_providers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  provider_name      TEXT NOT NULL,
  country_iso        TEXT NOT NULL,          
  contact_phone      TEXT,
  contact_email      TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logistics_providers_country ON logistics_providers(country_iso);
CREATE UNIQUE INDEX IF NOT EXISTS idx_logistics_providers_user_id_unique ON logistics_providers(user_id);

CREATE TABLE IF NOT EXISTS vehicle_types (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  key                TEXT NOT NULL UNIQUE,   
  label_key          TEXT NOT NULL,          
  icon               TEXT NOT NULL,          
  is_active          INTEGER NOT NULL DEFAULT 1,
  display_order      INTEGER NOT NULL DEFAULT 100,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
, transport_mode TEXT NOT NULL DEFAULT 'road' CHECK (transport_mode IN ('road', 'air', 'water')));


CREATE TABLE IF NOT EXISTS vehicles (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id          INTEGER NOT NULL REFERENCES logistics_providers(id),
  vehicle_type_id      INTEGER NOT NULL REFERENCES vehicle_types(id),
  registration_number  TEXT NOT NULL,
  country_iso          TEXT NOT NULL,        
  operational_status   TEXT NOT NULL DEFAULT 'active' CHECK (operational_status IN ('active', 'inactive', 'maintenance')),
  capacity_description TEXT,                 
  documentation_status TEXT NOT NULL DEFAULT 'not_submitted' CHECK (documentation_status IN ('not_submitted', 'pending_review', 'approved', 'rejected')),
  metadata_json        TEXT NOT NULL DEFAULT '{}',  
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
, make TEXT, model TEXT, year INTEGER, weight_capacity_kg REAL, base_city TEXT, cover_image_url TEXT);

CREATE INDEX IF NOT EXISTS idx_vehicles_base_city ON vehicles(base_city);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_country_registration_unique ON vehicles(country_iso, registration_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_provider ON vehicles(provider_id, id);
CREATE INDEX IF NOT EXISTS idx_vehicles_type ON vehicles(vehicle_type_id);

