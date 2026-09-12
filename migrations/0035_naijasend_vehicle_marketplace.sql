-- Migration 0035: Naijasend Vehicle Marketplace
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
-- belonging to migration "0035_naijasend_vehicle_marketplace.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id         INTEGER NOT NULL REFERENCES vehicles(id),
  document_type      TEXT NOT NULL CHECK (document_type IN ('registration', 'insurance', 'inspection', 'other')),
  r2_object_key      TEXT NOT NULL UNIQUE,   
  original_filename  TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  file_size_bytes    INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id, id);

CREATE TABLE IF NOT EXISTS vehicle_photos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id),
  photo_type     TEXT NOT NULL CHECK (photo_type IN ('front', 'side', 'rear', 'cargo', 'other')),
  image_url      TEXT NOT NULL,
  display_order  INTEGER NOT NULL DEFAULT 100,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle ON vehicle_photos(vehicle_id, display_order);

