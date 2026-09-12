-- Migration 0026: Maps Gps Foundation
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
-- belonging to migration "0026_maps_gps_foundation.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS gps_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id         INTEGER NOT NULL REFERENCES driver_profiles(id),   
  shipment_id       INTEGER REFERENCES shipments(id),                  
  client_event_id   TEXT NOT NULL,                                     
  latitude          REAL NOT NULL,
  longitude         REAL NOT NULL,
  accuracy_m        REAL,                                              
  recorded_at       TEXT NOT NULL,                                     
  received_at       TEXT NOT NULL DEFAULT (datetime('now')),           
  source            TEXT NOT NULL DEFAULT 'driver_app' CHECK (source IN ('driver_app', 'system_test')),
  metadata_json     TEXT NOT NULL DEFAULT '{}'                         
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gps_events_driver_client_event_unique ON gps_events(driver_id, client_event_id);
CREATE INDEX IF NOT EXISTS idx_gps_events_driver_received ON gps_events(driver_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_events_shipment_received ON gps_events(shipment_id, received_at DESC) WHERE shipment_id IS NOT NULL;

