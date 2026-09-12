-- Migration 0020: Naijasend Commerce Bridge
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
-- belonging to migration "0020_naijasend_commerce_bridge.sql", as closely as a final-state
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
--
-- SCHEMA-DRIFT ALTER (found by column-level diff against production, not
-- just table-name diff): production's pre-existing "vendors" table (owned
-- by local migration 0009) gained a pickup_address_line1 column. This
-- migration is the most plausible home for that ALTER because pickup_jobs
-- (below) is the first NaijaSend construct that needs a vendor pickup
-- address to originate a shipment from a seller's store. Exact original
-- migration number for this ALTER is UNKNOWN — SOURCE CODE REQUIRED; only
-- the final-state column is recoverable from the schema dump.

ALTER TABLE vendors ADD COLUMN pickup_address_line1 TEXT;

CREATE TABLE IF NOT EXISTS delivery_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id    INTEGER NOT NULL REFERENCES shipments(id),
  provider_id    INTEGER REFERENCES logistics_providers(id),
  driver_id      INTEGER REFERENCES driver_profiles(id),
  status         TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN (
                    'unassigned', 'assigned', 'en_route', 'completed', 'failed', 'cancelled'
                  )),
  scheduled_window_start TEXT,
  scheduled_window_end   TEXT,
  completed_at   TEXT,
  failure_reason TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_jobs_driver ON delivery_jobs(driver_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_jobs_shipment_unique ON delivery_jobs(shipment_id);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_status ON delivery_jobs(status);

CREATE TABLE IF NOT EXISTS pickup_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id    INTEGER NOT NULL REFERENCES shipments(id),
  provider_id    INTEGER REFERENCES logistics_providers(id),
  driver_id      INTEGER REFERENCES driver_profiles(id),
  status         TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN (
                    'unassigned', 'assigned', 'en_route', 'completed', 'failed', 'cancelled'
                  )),
  scheduled_window_start TEXT,
  scheduled_window_end   TEXT,
  completed_at   TEXT,
  failure_reason TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pickup_jobs_driver ON pickup_jobs(driver_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_jobs_shipment_unique ON pickup_jobs(shipment_id);
CREATE INDEX IF NOT EXISTS idx_pickup_jobs_status ON pickup_jobs(status);

