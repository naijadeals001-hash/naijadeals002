-- Migration 0014: Seller Finance Ledger
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
-- belonging to migration "0014_seller_finance_ledger.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS seller_ledger (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id          INTEGER NOT NULL REFERENCES vendors(id),
  entry_type         TEXT NOT NULL,          
  amount_kobo        INTEGER NOT NULL CHECK (amount_kobo > 0),
  balance_after_kobo INTEGER NOT NULL,       
  reference_type     TEXT NOT NULL,          
  reference_id       TEXT,                   
  order_id           INTEGER REFERENCES orders(id),  
  description        TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seller_ledger_order ON seller_ledger(order_id);
CREATE INDEX IF NOT EXISTS idx_seller_ledger_vendor ON seller_ledger(vendor_id, id);

