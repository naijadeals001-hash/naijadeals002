-- Migration 0017: Affiliate Foundation
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
-- belonging to migration "0017_affiliate_foundation.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS affiliate_profiles (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status                    TEXT NOT NULL DEFAULT 'active',   
  display_name              TEXT,
  default_commission_bps    INTEGER NOT NULL DEFAULT 500,     
  payout_threshold_kobo     INTEGER NOT NULL DEFAULT 500000,  
  payout_method             TEXT,                             
  payout_destination_json   TEXT,                             
  suspended_reason          TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
, reviewed_by_user_id INTEGER REFERENCES users(id), reviewed_at TEXT, rejection_reason TEXT);

CREATE INDEX IF NOT EXISTS idx_affiliate_profiles_status ON affiliate_profiles(status);

CREATE TABLE IF NOT EXISTS affiliate_referral_codes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id       INTEGER NOT NULL REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  code               TEXT NOT NULL UNIQUE,   
  is_primary         INTEGER NOT NULL DEFAULT 1,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_referral_codes_affiliate ON affiliate_referral_codes(affiliate_id);

CREATE TABLE IF NOT EXISTS affiliate_campaigns (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id          INTEGER REFERENCES affiliate_profiles(id) ON DELETE CASCADE, 
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active',      
  commission_type       TEXT NOT NULL DEFAULT 'percentage',  
  commission_value      INTEGER NOT NULL,                    
  scope_type            TEXT,                                
  scope_id              INTEGER,                             
  starts_at             TEXT,
  ends_at               TEXT,
  created_by_user_id    INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_campaigns_affiliate ON affiliate_campaigns(affiliate_id);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_code_id   INTEGER NOT NULL REFERENCES affiliate_referral_codes(id) ON DELETE CASCADE,
  affiliate_id       INTEGER NOT NULL REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  campaign_id        INTEGER REFERENCES affiliate_campaigns(id),
  click_token        TEXT NOT NULL UNIQUE, 
  landing_path       TEXT NOT NULL DEFAULT '/',
  referrer           TEXT,
  ip_hash            TEXT,   
  user_agent         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_affiliate ON affiliate_clicks(affiliate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_code ON affiliate_clicks(referral_code_id, created_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_iphash ON affiliate_clicks(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS affiliate_attributions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  click_id             INTEGER REFERENCES affiliate_clicks(id),
  affiliate_id         INTEGER NOT NULL REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
  referral_code_id     INTEGER NOT NULL REFERENCES affiliate_referral_codes(id),
  campaign_id          INTEGER REFERENCES affiliate_campaigns(id),
  attribution_token    TEXT NOT NULL UNIQUE, 
  customer_user_id     INTEGER REFERENCES users(id), 
  status               TEXT NOT NULL DEFAULT 'pending', 
  first_touch_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_touch_at        TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_attributions_affiliate ON affiliate_attributions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_attributions_customer ON affiliate_attributions(customer_user_id, status);

