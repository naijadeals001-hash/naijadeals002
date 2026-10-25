-- NaijaPay Batch 2: provider, biller, country and currency capability registry.
-- Credentials are deliberately absent. Secrets belong in Cloudflare secrets or an
-- approved provider vault, never in these records.

CREATE TABLE IF NOT EXISTS naijapay_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('airtime','data','electricity','cable_tv','internet','water','bank_transfer','fx','lending','crypto')),
  adapter_type TEXT NOT NULL,
  operational_status TEXT NOT NULL DEFAULT 'disabled' CHECK (operational_status IN ('disabled','sandbox','pending_authorization','operational','suspended')),
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','live')),
  configuration_status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (configuration_status IN ('unconfigured','configured','verified')),
  authorization_status TEXT NOT NULL DEFAULT 'not_authorized' CHECK (authorization_status IN ('not_authorized','pending','authorized','expired')),
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','healthy','degraded','unhealthy')),
  last_verified_at TEXT,
  limits_json TEXT NOT NULL DEFAULT '{}',
  fees_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_np_providers_category_status ON naijapay_providers(category, operational_status, is_active);

CREATE TABLE IF NOT EXISTS naijapay_provider_countries (
  provider_id INTEGER NOT NULL REFERENCES naijapay_providers(id) ON DELETE CASCADE,
  iso_code TEXT NOT NULL,
  rollout_status TEXT NOT NULL DEFAULT 'disabled' CHECK (rollout_status IN ('disabled','sandbox','pending_authorization','operational','suspended')),
  min_amount_minor INTEGER,
  max_amount_minor INTEGER,
  supported_operations_json TEXT NOT NULL DEFAULT '[]',
  compliance_status TEXT NOT NULL DEFAULT 'unverified' CHECK (compliance_status IN ('unverified','pending','approved','rejected')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(provider_id, iso_code)
);

CREATE TABLE IF NOT EXISTS naijapay_currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  minor_unit INTEGER NOT NULL DEFAULT 2 CHECK (minor_unit BETWEEN 0 AND 4),
  operational_status TEXT NOT NULL DEFAULT 'disabled' CHECK (operational_status IN ('disabled','sandbox','operational')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS naijapay_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES naijapay_providers(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  country_iso TEXT NOT NULL,
  currency TEXT NOT NULL,
  operation TEXT NOT NULL,
  operational_status TEXT NOT NULL DEFAULT 'disabled' CHECK (operational_status IN ('disabled','sandbox','operational','suspended')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider_id, product_code, country_iso, currency)
);
CREATE INDEX IF NOT EXISTS idx_np_products_lookup ON naijapay_products(country_iso, category, operational_status);

INSERT OR IGNORE INTO naijapay_currencies(code, name, minor_unit, operational_status) VALUES
 ('NGN','Nigerian Naira',2,'operational'), ('GHS','Ghanaian Cedi',2,'sandbox'), ('KES','Kenyan Shilling',2,'sandbox'), ('ZAR','South African Rand',2,'sandbox'), ('USD','United States Dollar',2,'sandbox');

INSERT OR IGNORE INTO naijapay_providers(provider_key, display_name, category, adapter_type, operational_status, environment, configuration_status, authorization_status, health_status, is_active)
VALUES
 ('paystack','Paystack','bank_transfer','paystack','sandbox','sandbox','configured','pending','unknown',1),
 ('airtime-sandbox','Airtime Sandbox','airtime','sandbox','sandbox','sandbox','unconfigured','not_authorized','unknown',0),
 ('utility-sandbox','Utility Sandbox','electricity','sandbox','sandbox','sandbox','unconfigured','not_authorized','unknown',0),
 ('fx-sandbox','FX Sandbox','fx','sandbox','sandbox','sandbox','unconfigured','not_authorized','unknown',0),
 ('crypto-sandbox','Crypto Sandbox','crypto','sandbox','sandbox','sandbox','unconfigured','not_authorized','unknown',0),
 ('lending-sandbox','Lending Sandbox','lending','sandbox','sandbox','sandbox','unconfigured','not_authorized','unknown',0);
