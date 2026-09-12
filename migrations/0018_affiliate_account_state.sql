-- Migration 0018: Affiliate Account State
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
-- belonging to migration "0018_affiliate_account_state.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS affiliate_accounts (
  affiliate_id           INTEGER PRIMARY KEY REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  cached_available_kobo  INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id           INTEGER NOT NULL REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  attribution_id         INTEGER NOT NULL REFERENCES affiliate_attributions(id),
  campaign_id            INTEGER REFERENCES affiliate_campaigns(id),
  order_id               INTEGER NOT NULL REFERENCES orders(id),
  order_item_id          INTEGER NOT NULL UNIQUE REFERENCES order_items(id), 
  listing_id             INTEGER NOT NULL REFERENCES product_listings(id),
  product_id             INTEGER NOT NULL REFERENCES products(id),
  vendor_id              INTEGER NOT NULL REFERENCES vendors(id),
  customer_user_id       INTEGER NOT NULL REFERENCES users(id),
  commission_basis       TEXT NOT NULL,   
  commission_rate_bps    INTEGER,         
  gross_kobo             INTEGER NOT NULL,       
  commission_kobo        INTEGER NOT NULL CHECK (commission_kobo >= 0),
  status                 TEXT NOT NULL DEFAULT 'pending', 
  approved_by_user_id    INTEGER REFERENCES users(id),
  approved_at            TEXT,
  reversed_at            TEXT,
  reversed_reason        TEXT,
  payout_id              INTEGER REFERENCES affiliate_payouts(id), 
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate ON affiliate_commissions(affiliate_id, status);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_order ON affiliate_commissions(order_id);

CREATE TABLE IF NOT EXISTS affiliate_ledger (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id       INTEGER NOT NULL REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  entry_type         TEXT NOT NULL,          
  amount_kobo        INTEGER NOT NULL CHECK (amount_kobo > 0),
  balance_after_kobo INTEGER NOT NULL,       
  reference_type     TEXT NOT NULL,          
  reference_id       TEXT,
  commission_id      INTEGER REFERENCES affiliate_commissions(id),
  order_id           INTEGER REFERENCES orders(id),
  description        TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_ledger_affiliate ON affiliate_ledger(affiliate_id, id);
CREATE INDEX IF NOT EXISTS idx_affiliate_ledger_order ON affiliate_ledger(order_id);

CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id           INTEGER NOT NULL REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  amount_kobo            INTEGER NOT NULL CHECK (amount_kobo > 0),
  status                 TEXT NOT NULL DEFAULT 'requested', 
  payout_method          TEXT,
  external_reference     TEXT,   
  requested_at           TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by_user_id     INTEGER REFERENCES users(id),
  decided_at             TEXT,
  paid_at                TEXT,
  rejection_reason       TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_affiliate ON affiliate_payouts(affiliate_id, status);

CREATE TABLE IF NOT EXISTS affiliate_fraud_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id       INTEGER REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  event_type         TEXT NOT NULL,  
  severity           TEXT NOT NULL DEFAULT 'LOW', 
  entity_type        TEXT,           
  entity_id          TEXT,
  actor_user_id      INTEGER REFERENCES users(id), 
  detail             TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_fraud_events_affiliate ON affiliate_fraud_events(affiliate_id, created_at);

