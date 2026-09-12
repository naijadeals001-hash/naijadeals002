-- Migration 0040: Marketplace Engine 2.1 — Completion Pass
--
-- NEW APPLICATION FEATURE. Purely additive on top of migration 0038
-- (Marketplace Engine 2.0) and migration 0013's dormant Control Center
-- foundation (cc_countries / cc_domain_events / cc_audit_logs / cc_alerts —
-- all reused here rather than duplicated, per the Master Ecosystem
-- Directive's "integrate, don't duplicate" rule).
--
-- NON-NEGOTIABLE COMPATIBILITY RULES (mirrors 0038's own header):
--   - Zero destructive changes. No DROP, no DELETE of existing rows, no
--     rewriting of any historical migration.
--   - orders.status / order_items.item_status remain free-text columns
--     (no CHECK constraint added) — new lifecycle values are introduced by
--     application-code convention only, exactly like moderation_status was
--     in 0038. This migration does NOT touch those two columns at all.
--   - Every ALTER TABLE ADD COLUMN uses a CONSTANT literal default (never
--     datetime('now') or any function call) per the SQLite restriction
--     already documented in 0027/0037/0038.
--   - Every new table is CREATE TABLE IF NOT EXISTS, every new index is
--     CREATE INDEX IF NOT EXISTS.
--   - No new wallet/ledger table. Refunds route through the EXISTING
--     wallet_ledger via src/lib/wallet.ts's creditWallet — this migration
--     only adds the Marketplace-side COMMERCE CONTEXT tables (refunds,
--     disputes, additional charges) that reference the financial
--     operation, never a competing ledger.

-- ============================================================
-- 1. ORDER ITEM STATUS EVENTS (spec sections 3/4 — transition history)
-- ============================================================
-- The append-only audit trail for the new centralized
-- transitionOrderItemStatus() state machine (src/lib/order-lifecycle.ts).
-- Every legal transition writes exactly one row here — this is what makes
-- "who changed this, from what, to what, when, why" answerable for every
-- order item without inspecting application logs.
CREATE TABLE IF NOT EXISTS order_item_status_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id   INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status     TEXT NOT NULL,
  to_status       TEXT NOT NULL,
  actor_user_id   INTEGER REFERENCES users(id),
  actor_role      TEXT NOT NULL DEFAULT 'system',   -- customer | seller | admin | system
  reason          TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_item_status_events_item ON order_item_status_events(order_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_item_status_events_order ON order_item_status_events(order_id, created_at);

-- ============================================================
-- 2. REFUNDS — commerce context only (spec section 6)
-- ============================================================
-- Marketplace owns WHY/WHAT was refunded. The actual money movement is
-- executed by src/lib/wallet.ts's creditWallet (the existing, authoritative
-- Payment & Finance ledger) — this table never mutates a balance itself,
-- it only records the commerce-side request/outcome and stores the
-- resulting wallet_ledger row id as `wallet_ledger_id` so every refund is
-- traceable back to its financial transaction, and vice versa.
CREATE TABLE IF NOT EXISTS refunds (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id              INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id         INTEGER REFERENCES order_items(id) ON DELETE CASCADE,   -- NULL = whole-order refund
  vendor_id             INTEGER REFERENCES vendors(id),
  amount_kobo           INTEGER NOT NULL CHECK (amount_kobo > 0),
  reason                TEXT NOT NULL,
  refund_type           TEXT NOT NULL DEFAULT 'full',   -- full | partial | item | quantity | cancellation
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
  initiated_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  initiated_by_role     TEXT NOT NULL,    -- customer | seller | admin | system
  approved_by_user_id   INTEGER REFERENCES users(id),
  wallet_ledger_id      INTEGER REFERENCES wallet_ledger(id),   -- set once the financial credit is executed
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order_item ON refunds(order_item_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);

-- ============================================================
-- 3. DISPUTES — commerce context only (spec section 6)
-- ============================================================
-- No standalone Trust/Safety/Review engine exists yet in this repository
-- (confirmed via exhaustive grep during Engine 2.1 inspection — only a
-- `reviews` table exists, no dispute-specific table anywhere in 0001-0039).
-- Per the spec's explicit instruction ("if it does not yet exist, create
-- only the Marketplace integration boundary required for future
-- connection"), this table is that boundary: Marketplace-owned commerce
-- context (which order/item, who raised it, against which seller) that a
-- future Trust & Safety Engine can adopt/extend without a breaking change
-- — never a full case-management system.
CREATE TABLE IF NOT EXISTS disputes (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id              INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id         INTEGER REFERENCES order_items(id) ON DELETE CASCADE,
  raised_by_user_id     INTEGER NOT NULL REFERENCES users(id),
  against_vendor_id     INTEGER REFERENCES vendors(id),
  reason                TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'rejected')),
  resolution_note       TEXT,
  resolved_by_user_id   INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

-- ============================================================
-- 4. ADDITIONAL CHARGES — variable-weight "final > estimated" path
--    (spec sections 12/13)
-- ============================================================
-- When a fulfilled variable-weight item's final amount is HIGHER than what
-- was already captured, the difference is NEVER silently added to an
-- already-settled transaction (spec section 12's explicit prohibition).
-- Instead it is recorded here as a pending charge the customer must
-- explicitly pay (via wallet debit or a future card flow) — mirrors the
-- Service Engine's confirmAdditionalCharge pattern (migration 0039),
-- applied to Marketplace orders.
CREATE TABLE IF NOT EXISTS order_additional_charges (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id              INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id         INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  amount_kobo           INTEGER NOT NULL CHECK (amount_kobo > 0),
  reason                TEXT NOT NULL DEFAULT 'variable_weight_adjustment',
  status                TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'paid', 'cancelled')),
  requested_by_user_id  INTEGER REFERENCES users(id),
  wallet_ledger_id      INTEGER REFERENCES wallet_ledger(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at               TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_additional_charges_order ON order_additional_charges(order_id);
CREATE INDEX IF NOT EXISTS idx_order_additional_charges_item ON order_additional_charges(order_item_id);

-- ============================================================
-- 5. VARIABLE-WEIGHT FULFILLMENT AUDIT COLUMNS (spec section 13)
-- ============================================================
-- "Seller/browser must not be able to arbitrarily claim ordered=2kg,
-- actual=20kg without authorization/validation." These columns record who
-- fulfilled the item, when, and why the quantity differs — on top of the
-- existing fulfilled_quantity/final_price_kobo from migration 0038.
ALTER TABLE order_items ADD COLUMN fulfilled_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE order_items ADD COLUMN fulfilled_at TEXT;
ALTER TABLE order_items ADD COLUMN weight_adjustment_reason TEXT;
ALTER TABLE order_items ADD COLUMN shipped_at TEXT;
ALTER TABLE order_items ADD COLUMN delivered_at TEXT;
ALTER TABLE order_items ADD COLUMN completed_at TEXT;
-- settlement_status tracks the variable-weight financial reconciliation
-- separately from item_status (fulfillment progress): none = no
-- variable-weight adjustment needed or not yet computed; settled = final
-- amount matched the captured amount exactly; refund_issued /
-- additional_payment_pending / additional_payment_paid = an adjustment was
-- required and its outcome.
ALTER TABLE order_items ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'none';

-- ============================================================
-- 6. COUNTRY / LOCATION INTEGRATION BOUNDARY (spec section 11)
-- ============================================================
-- Do NOT build a competing Country Engine — migration 0013 already
-- reconstructed a full `cc_countries` / `cc_country_settings` foundation
-- from production, currently unused by any application code (confirmed
-- via grep + row-count query during inspection: 0 rows, 0 references).
-- This section (a) seeds it with real starter data so it becomes usable,
-- and (b) adds ONLY the Marketplace-side boundary — per-listing country
-- availability — needed to make "a seller listing may be available in
-- Nigeria but not Ghana" real without duplicating cc_countries itself.
ALTER TABLE vendors ADD COLUMN country_iso TEXT NOT NULL DEFAULT 'NG';
-- Vendor's operating/home country. Every existing vendor defaults to 'NG'
-- (matches production's Nigeria-only history exactly) — zero behavior
-- change for any existing row.

CREATE TABLE IF NOT EXISTS listing_country_availability (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id    INTEGER NOT NULL REFERENCES product_listings(id) ON DELETE CASCADE,
  country_iso   TEXT NOT NULL,
  is_available  INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(listing_id, country_iso)
);
-- ABSENCE of any row for a listing means "available only in the vendor's
-- own country_iso" (the safe, honest default — never fake global reach).
-- A seller who wants their listing visible in additional/fewer countries
-- inserts explicit rows. No GPS, no fake location matching — purely a
-- declared availability boundary, exactly as spec section 11 requires.
CREATE INDEX IF NOT EXISTS idx_listing_country_availability_listing ON listing_country_availability(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_country_availability_country ON listing_country_availability(country_iso);

-- Seed cc_countries with real starter data (was 0 rows before this
-- migration — confirmed during inspection). Nigeria is the only LIVE
-- market (matches actual current operations); the other 9 African markets
-- named explicitly in the Master Ecosystem Directive's Section 12 are
-- seeded as PLANNED so the Country Engine foundation has real rows to
-- build on, without pretending any of them are actually live today.
INSERT OR IGNORE INTO cc_countries (iso_code, name, region, currency_code, default_language, available_languages_json, status, display_order) VALUES
  ('NG', 'Nigeria',       'West Africa',    'NGN', 'en', '["en","ha","yo","ig"]', 'LIVE',    10),
  ('GH', 'Ghana',         'West Africa',    'GHS', 'en', '["en"]',                'PLANNED', 20),
  ('KE', 'Kenya',         'East Africa',    'KES', 'en', '["en","sw"]',           'PLANNED', 30),
  ('ZA', 'South Africa',  'Southern Africa','ZAR', 'en', '["en","af","zu"]',      'PLANNED', 40),
  ('UG', 'Uganda',        'East Africa',    'UGX', 'en', '["en","sw"]',           'PLANNED', 50),
  ('TZ', 'Tanzania',      'East Africa',    'TZS', 'sw', '["sw","en"]',           'PLANNED', 60),
  ('RW', 'Rwanda',        'East Africa',    'RWF', 'en', '["en","fr","rw"]',      'PLANNED', 70),
  ('SN', 'Senegal',       'West Africa',    'XOF', 'fr', '["fr","wo"]',           'PLANNED', 80),
  ('CI', 'Côte d''Ivoire','West Africa',    'XOF', 'fr', '["fr"]',                'PLANNED', 90),
  ('CM', 'Cameroon',      'Central Africa', 'XAF', 'fr', '["fr","en"]',           'PLANNED', 100);

-- ============================================================
-- 7. MERCHANDISING COLLECTION SCHEDULING (spec section 10)
-- ============================================================
-- Purely additive on top of the existing `collections` table (migration
-- 0038) — every existing collection row defaults to NULL/NULL, meaning
-- "always active whenever is_active=1", exactly today's behavior.
ALTER TABLE collections ADD COLUMN starts_at TEXT;
ALTER TABLE collections ADD COLUMN ends_at TEXT;
ALTER TABLE collections ADD COLUMN created_by_user_id INTEGER REFERENCES users(id);

-- ============================================================
-- 8. ADMIN PLATFORM ROLE — make requirePlatformRole('admin') real
-- ============================================================
-- src/lib/rbac.ts's requirePlatformRole() has existed since migration 0037
-- but had ZERO callers anywhere (confirmed via grep) because no admin-only
-- endpoint existed yet to gate. This migration does not need a schema
-- change for that (users.role is already a free-text column per migration
-- 0001) — noted here only for provenance: Engine 2.1 is the first feature
-- to actually call requirePlatformRole('admin').
