-- Migration 0013: Control Center Foundation
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
-- belonging to migration "0013_control_center_foundation.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS cc_countries (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  iso_code              TEXT NOT NULL UNIQUE,   
  name                  TEXT NOT NULL,
  region                TEXT NOT NULL,          
  currency_code         TEXT NOT NULL,          
  default_language      TEXT NOT NULL,          
  available_languages_json TEXT NOT NULL,       
  status                TEXT NOT NULL DEFAULT 'PLANNED'
                         CHECK (status IN ('PLANNED','PRE-LAUNCH','BETA','LIVE','PAUSED','SUSPENDED')),
  display_order         INTEGER NOT NULL DEFAULT 100,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cc_countries_region ON cc_countries(region);
CREATE INDEX IF NOT EXISTS idx_cc_countries_status ON cc_countries(status);

CREATE TABLE IF NOT EXISTS cc_country_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  country_id    INTEGER NOT NULL REFERENCES cc_countries(id) ON DELETE CASCADE,
  setting_key   TEXT NOT NULL,     
  setting_value TEXT NOT NULL,     
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_user_id INTEGER REFERENCES users(id),
  UNIQUE(country_id, setting_key)
);


CREATE TABLE IF NOT EXISTS cc_permissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,   
  category     TEXT NOT NULL,         
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT ''
);


CREATE TABLE IF NOT EXISTS cc_roles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,   
  name         TEXT NOT NULL,          
  description  TEXT NOT NULL DEFAULT '',
  is_system    INTEGER NOT NULL DEFAULT 1,  
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS cc_role_permissions (
  role_id        INTEGER NOT NULL REFERENCES cc_roles(id) ON DELETE CASCADE,
  permission_id  INTEGER NOT NULL REFERENCES cc_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);


CREATE TABLE IF NOT EXISTS cc_user_roles (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id               INTEGER NOT NULL REFERENCES cc_roles(id) ON DELETE CASCADE,
  assigned_by_user_id   INTEGER REFERENCES users(id),  
  assigned_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_user_roles_user ON cc_user_roles(user_id);

CREATE TABLE IF NOT EXISTS cc_system_health (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  component_key  TEXT NOT NULL UNIQUE,   
  component_name TEXT NOT NULL,
  category       TEXT NOT NULL,          
  status         TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN ('HEALTHY','DEGRADED','FAILED','UNKNOWN')),
  latency_ms     INTEGER,
  last_checked_at TEXT,
  last_error     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS cc_audit_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id    INTEGER REFERENCES users(id),   
  actor_name_snapshot TEXT NOT NULL DEFAULT '',     
  action           TEXT NOT NULL,        
  entity_type      TEXT NOT NULL,        
  entity_id        TEXT,                 
  before_json       TEXT,
  after_json        TEXT,
  ip_address       TEXT,
  context_json     TEXT,                
  success          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cc_audit_logs_actor ON cc_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_cc_audit_logs_created ON cc_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_audit_logs_entity ON cc_audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS cc_alerts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  category         TEXT NOT NULL CHECK (category IN
                     ('FINANCIAL','COMMERCE','SECURITY','FRAUD','LOGISTICS','MARKETING','SOCIAL','SYSTEM','COUNTRY','VENDOR','CUSTOMER')),
  severity         TEXT NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  entity_type      TEXT,
  entity_id        TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','snoozed','escalated')),
  assigned_to_user_id INTEGER REFERENCES users(id),
  snoozed_until    TEXT,
  resolved_at      TEXT,
  resolved_by_user_id INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cc_alerts_created ON cc_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_alerts_status ON cc_alerts(status, severity);

CREATE TABLE IF NOT EXISTS cc_domain_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type    TEXT NOT NULL,     
  entity_type   TEXT NOT NULL,     
  entity_id     TEXT NOT NULL,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  actor_user_id INTEGER REFERENCES users(id),
  occurred_at   TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_cc_domain_events_occurred ON cc_domain_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_domain_events_type ON cc_domain_events(event_type);

