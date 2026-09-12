-- Migration 0022: Capability Registry
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
-- belonging to migration "0022_capability_registry.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS cc_capabilities (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  key                TEXT NOT NULL UNIQUE,   
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  category           TEXT NOT NULL CHECK (category IN
                       ('account','commerce','communications','country','ecosystem',
                        'growth','intelligence','logistics','merchant','money','platform','trust')),
  status             TEXT NOT NULL CHECK (status IN ('ACTIVE','CONFIGURATION_REQUIRED','UNIMPLEMENTED')),
  control_type       TEXT NOT NULL CHECK (control_type IN
                       ('toggle','configuration','provider_select','country_toggle','read_only','roadmap')),
  enabled            INTEGER NOT NULL DEFAULT 0,   
  dependencies_json  TEXT NOT NULL DEFAULT '[]',   
  route              TEXT,                          
  sort_order         INTEGER NOT NULL DEFAULT 100,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  
  
  
  
  CHECK (NOT (status = 'UNIMPLEMENTED' AND control_type != 'roadmap')),
  
  
  
  CHECK (NOT (control_type = 'roadmap' AND status != 'UNIMPLEMENTED'))
);

CREATE INDEX IF NOT EXISTS idx_cc_capabilities_category ON cc_capabilities(category);
CREATE INDEX IF NOT EXISTS idx_cc_capabilities_status ON cc_capabilities(status);

CREATE TABLE IF NOT EXISTS cc_capability_country_overrides (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  capability_id      INTEGER NOT NULL REFERENCES cc_capabilities(id) ON DELETE CASCADE,
  country_id         INTEGER NOT NULL REFERENCES cc_countries(id) ON DELETE CASCADE,
  enabled            INTEGER NOT NULL,                 
  reason             TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id INTEGER REFERENCES users(id),
  UNIQUE(capability_id, country_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_cap_country_overrides_capability ON cc_capability_country_overrides(capability_id);
CREATE INDEX IF NOT EXISTS idx_cc_cap_country_overrides_country ON cc_capability_country_overrides(country_id);

