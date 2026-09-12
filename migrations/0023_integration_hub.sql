-- Migration 0023: Integration Hub
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
-- belonging to migration "0023_integration_hub.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS cc_integrations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key       TEXT NOT NULL UNIQUE,   
  provider_name      TEXT NOT NULL,
  category           TEXT NOT NULL,          
  country_availability_json TEXT NOT NULL DEFAULT '[]',  
  status             TEXT NOT NULL DEFAULT 'not_configured'
                      CHECK (status IN ('not_configured','configured','healthy','degraded','failed')),
  config_json        TEXT NOT NULL DEFAULT '{}',
  last_success_at    TEXT,
  last_failure_at    TEXT,
  last_checked_at    TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
, enabled INTEGER NOT NULL DEFAULT 1, environment TEXT NOT NULL DEFAULT 'production', selected_provider_key TEXT, priority INTEGER NOT NULL DEFAULT 100, fallback_provider_key TEXT, verification_status TEXT NOT NULL DEFAULT 'not_configured', verified_at TEXT, last_verification_error TEXT);

CREATE INDEX IF NOT EXISTS idx_cc_integrations_enabled ON cc_integrations(enabled);
CREATE INDEX IF NOT EXISTS idx_cc_integrations_verification_status ON cc_integrations(verification_status);

CREATE TABLE IF NOT EXISTS cc_integration_providers (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key              TEXT NOT NULL UNIQUE,
  integration_key           TEXT NOT NULL REFERENCES cc_integrations(provider_key) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  enabled                   INTEGER NOT NULL DEFAULT 1,
  capabilities_json         TEXT NOT NULL DEFAULT '[]',   
  config_schema_json        TEXT NOT NULL DEFAULT '{}',   
  priority                  INTEGER NOT NULL DEFAULT 100,
  country_availability_json TEXT NOT NULL DEFAULT '[]',   
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cc_integration_providers_integration_key ON cc_integration_providers(integration_key);

CREATE TABLE IF NOT EXISTS cc_integration_country_overrides (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id     INTEGER NOT NULL REFERENCES cc_integrations(id) ON DELETE CASCADE,
  country_id         INTEGER NOT NULL REFERENCES cc_countries(id) ON DELETE CASCADE,
  enabled            INTEGER NOT NULL,                 
  selected_provider_key TEXT,                            
  reason             TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id INTEGER REFERENCES users(id),
  UNIQUE(integration_id, country_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_integration_country_overrides_country ON cc_integration_country_overrides(country_id);
CREATE INDEX IF NOT EXISTS idx_cc_integration_country_overrides_integration ON cc_integration_country_overrides(integration_id);

