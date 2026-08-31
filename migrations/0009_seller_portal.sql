-- NaijaDeals — Seller Portal Foundation Migration
--
-- Bridges the ONE architectural gap blocking a real seller portal: `vendors` has
-- existed since migration 0001 as a pure catalog/display entity (20 seeded rows,
-- no owner). This migration links a vendor row to a real user account, adds an
-- explicit verification state machine, tracks onboarding progress, and adds the
-- finance/payout structures a seller economy needs — all purely additive
-- (ALTER TABLE ADD COLUMN / CREATE TABLE IF NOT EXISTS). No existing table is
-- dropped, no existing column is removed, no existing query (catalog, cart,
-- checkout, orders, wallet) needs to change to keep working.
--
-- Design precedent followed throughout (same as 0006_brand_merchandising.sql and
-- 0008_hero_campaigns.sql): status/verification columns + display metadata are
-- added so a future Admin Panel can operate on this data directly — nothing here
-- is hardcoded in application TSX, and nothing here is a parallel/duplicate of
-- users, auth, products, listings, orders, or wallet_ledger. Every new table
-- either extends an existing entity or reuses an existing mechanism.
--
-- ============================================================
-- 1. VENDORS: bridge to users + verification state + onboarding progress
-- ============================================================
--
-- user_id is nullable and NOT unique via a plain column constraint (SQLite's
-- ALTER TABLE ADD COLUMN cannot add UNIQUE) — enforced instead via a partial
-- unique index below so the 20 existing catalog vendors (user_id = NULL) are
-- completely unaffected, while a real user can own at most one store (MVP:
-- one user -> one store; nothing here prevents relaxing that later).
--
-- verification_status is the explicit Pending/Verified/Rejected/Suspended state
-- machine Pat required. is_verified (the pre-existing binary flag every catalog
-- query already filters on) is KEPT for backward compatibility — never dropped —
-- and is kept in sync by application code whenever verification_status changes,
-- so getPopularVendors()/getListingsForProduct() etc. continue to work unchanged.
--
-- onboarding_step / onboarding_completed_at let the 6-step onboarding wizard
-- resume exactly where a seller left off, without a second "seller_applications"
-- table duplicating what is fundamentally the same store record. The store row
-- IS the application — it just isn't complete/verified/listed yet.

ALTER TABLE vendors ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE vendors ADD COLUMN business_name TEXT;                    -- legal/registered name; may differ from the public store `name`
ALTER TABLE vendors ADD COLUMN business_type TEXT CHECK (business_type IN ('individual', 'company') OR business_type IS NULL);
ALTER TABLE vendors ADD COLUMN business_email TEXT;
ALTER TABLE vendors ADD COLUMN business_phone TEXT;

ALTER TABLE vendors ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'verified'
  CHECK (verification_status IN ('pending', 'verified', 'rejected', 'suspended'));
ALTER TABLE vendors ADD COLUMN verification_note TEXT;                -- admin-entered reason when rejected/suspended (future Admin Panel field)

ALTER TABLE vendors ADD COLUMN onboarding_step INTEGER NOT NULL DEFAULT 1;   -- which of the 6 wizard steps to resume at
ALTER TABLE vendors ADD COLUMN onboarding_completed_at TEXT;                 -- NULL = onboarding not finished; store is not publicly listed until this is set

ALTER TABLE vendors ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE vendors ADD COLUMN terms_version TEXT;                    -- lets Seller Terms be revised later and force re-acceptance

ALTER TABLE vendors ADD COLUMN store_status TEXT NOT NULL DEFAULT 'active'
  CHECK (store_status IN ('active', 'paused', 'suspended'));          -- seller-controlled "Store status" (pause selling) vs admin-controlled verification_status

-- Enforces "at most one store per user" without touching the 20 existing rows
-- (all of which have user_id = NULL and are therefore excluded by this partial index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_user_id_unique ON vendors(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_verification_status ON vendors(verification_status);

-- Backfill: the 20 pre-seeded catalog vendors are treated as already-complete,
-- already-verified stores (matching their existing is_verified = 1), NOT as
-- fake onboarding activity — they simply predate the onboarding wizard.
UPDATE vendors
SET business_name = name,
    verification_status = 'verified',
    onboarding_completed_at = created_at,
    terms_accepted_at = created_at,
    terms_version = 'v1'
WHERE user_id IS NULL;

-- ============================================================
-- 2. NIGERIAN BANKS: reference table for the payout-account bank selector
-- ============================================================
-- Same precedent as nigerian_states (migration 0007): a genuine DB-backed
-- <select>, never a hardcoded array baked into a .tsx file.

CREATE TABLE IF NOT EXISTS nigerian_banks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  code       TEXT NOT NULL,          -- Nigerian Bankers' Clearing House (NIBSS) bank code
  sort_order INTEGER NOT NULL
);

INSERT INTO nigerian_banks (name, code, sort_order) VALUES
  ('Access Bank', '044', 1),
  ('Citibank Nigeria', '023', 2),
  ('Ecobank Nigeria', '050', 3),
  ('Fidelity Bank', '070', 4),
  ('First Bank of Nigeria', '011', 5),
  ('First City Monument Bank (FCMB)', '214', 6),
  ('Globus Bank', '00103', 7),
  ('Guaranty Trust Bank (GTBank)', '058', 8),
  ('Heritage Bank', '030', 9),
  ('Keystone Bank', '082', 10),
  ('Kuda Microfinance Bank', '50211', 11),
  ('Moniepoint Microfinance Bank', '50515', 12),
  ('Opay (Paycom)', '999992', 13),
  ('Palmpay', '999991', 14),
  ('Polaris Bank', '076', 15),
  ('Providus Bank', '101', 16),
  ('Stanbic IBTC Bank', '221', 17),
  ('Standard Chartered Bank', '068', 18),
  ('Sterling Bank', '232', 19),
  ('SunTrust Bank', '100', 20),
  ('Union Bank of Nigeria', '032', 21),
  ('United Bank for Africa (UBA)', '033', 22),
  ('Unity Bank', '215', 23),
  ('Wema Bank', '035', 24),
  ('Zenith Bank', '057', 25);

-- ============================================================
-- 3. SELLER PAYOUT ACCOUNTS: distinct from buyer saved_payment_methods
-- ============================================================
-- A buyer payment method (saved_payment_methods, migration 0002) is where money
-- comes FROM when the seller-as-a-user shops. A payout account is where money
-- GOES TO when the seller-as-a-store withdraws earnings. These are semantically
-- different and deliberately NOT the same table.
--
-- Security requirements (Pat, this pass):
--   - account_number_encrypted stores the NUBAN encrypted at rest (AES-256-GCM,
--     Web Crypto, key from the PAYOUT_ENCRYPTION_KEY secret — never the plugin's
--     PAYSTACK_SECRET_KEY, a separate secret with a separate blast radius).
--   - account_number_last4 is stored in plaintext ALONGSIDE the encrypted value
--     specifically so the UI can render "••••••1234" without ever decrypting —
--     normal seller-facing reads never touch account_number_encrypted at all.
--   - Ownership is enforced at the query layer (see src/lib/payouts.ts) — every
--     read/write is scoped by vendor_id resolved server-side from the session,
--     never accepted as a client-supplied parameter.
--   - status = 'removed' is a soft delete (never hard-delete a financial
--     instrument row) so the audit trail below stays meaningful forever.

CREATE TABLE IF NOT EXISTS seller_payout_accounts (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id                INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  bank_name                TEXT NOT NULL,
  bank_code                TEXT NOT NULL,
  account_name             TEXT NOT NULL,     -- name on the bank account (self-declared for MVP; Paystack account-resolve verification is a future upgrade, not faked here)
  account_number_encrypted TEXT NOT NULL,     -- format: "<base64 iv>:<base64 ciphertext>", AES-256-GCM
  account_number_last4     TEXT NOT NULL,     -- plaintext, masked-display only — e.g. "1234"
  is_default               INTEGER NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payout_accounts_vendor ON seller_payout_accounts(vendor_id, status);

-- Audit trail: every add/edit/default-change/removal is recorded, never
-- overwritten or deleted, independent of the soft-delete on the account row itself.
CREATE TABLE IF NOT EXISTS seller_payout_account_audit (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  payout_account_id   INTEGER REFERENCES seller_payout_accounts(id),
  vendor_id           INTEGER NOT NULL REFERENCES vendors(id),
  action              TEXT NOT NULL CHECK (action IN ('created', 'updated', 'set_default', 'removed')),
  performed_by_user_id INTEGER NOT NULL REFERENCES users(id),
  detail              TEXT NOT NULL DEFAULT '',   -- human-readable, e.g. "Added GTBank account ending 1234" — never the full account number
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payout_audit_vendor ON seller_payout_account_audit(vendor_id, created_at DESC);

-- ============================================================
-- 4. SELLER FINANCE: cached available-earnings balance, keyed by STORE not user
-- ============================================================
-- Deliberately NOT sharing wallet_accounts.cached_balance_kobo — that table is
-- the BUYER spending wallet. Conflating seller earnings into the same balance
-- would let a seller instantly "spend" escrow-pending money as a shopper, which
-- breaks the escrow model entirely. Instead: seller earnings/payout EVENTS are
-- appended to the SAME wallet_ledger table (new reference_type values
-- 'seller_earning' / 'seller_payout', added in src/lib/wallet.ts — no schema
-- change needed there, reference_type has always been free text), atomically
-- updating THIS cache table via the exact same db.batch() ledger+cache pattern
-- creditWallet()/debitWallet() already use. Keyed by vendor_id (the store),
-- not user_id (the person) — correct scoping for the future where a store may
-- have staff/collaborators beyond a single owning user.
--
-- "Pending earnings" (escrow held, not yet released) is intentionally NOT a
-- column here — it is a live derived query over order_items/orders (see
-- src/lib/seller-finance.ts). No ledger entry — and therefore no cached
-- balance — exists until money has actually moved. This keeps the ₦0-until-real
-- rule mechanically enforced: there is no code path that can credit this table
-- except an actual escrow-release event, which does not exist yet in this phase.

CREATE TABLE IF NOT EXISTS seller_finance_accounts (
  vendor_id             INTEGER PRIMARY KEY REFERENCES vendors(id),
  cached_available_kobo INTEGER NOT NULL DEFAULT 0,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
