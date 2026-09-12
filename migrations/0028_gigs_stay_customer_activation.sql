-- Migration 0028: Gigs Stay Customer Activation
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
-- belonging to migration "0028_gigs_stay_customer_activation.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS gig_service_details (
  listing_id           INTEGER PRIMARY KEY REFERENCES bookable_listings(id) ON DELETE CASCADE,
  duration_minutes     INTEGER NOT NULL CHECK (duration_minutes > 0),
  package_tier         TEXT,     
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS stay_unit_details (
  listing_id           INTEGER PRIMARY KEY REFERENCES bookable_listings(id) ON DELETE CASCADE,
  unit_type            TEXT NOT NULL,    
  max_guests           INTEGER NOT NULL CHECK (max_guests > 0),
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);


