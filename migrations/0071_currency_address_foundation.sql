-- ============================================================
-- Stage 2C: Currency & Address Foundation
--
-- Country -> default currency -> listing currency -> order currency
-- (never "Country -> assume currency everywhere" at read time).
--
-- Scope (authorized 2026-09-19):
--   1. product_listings.currency  — explicit stored fact, not derived
--   2. country_regions            — additive, generalizes nigerian_states
--                                    (nigerian_states is left intact)
--   3. orders.shipping_country    — disambiguates shipping_state
--   4. addresses.country_iso      — same reasoning as orders
--
-- Explicitly NOT in scope: Ghana/Kenya market activation, FX conversion,
-- multi-currency wallet, new payment rails, RBAC changes.
-- ============================================================

-- ---------- 1. LISTING CURRENCY ----------
-- Default 'NGN' so all pre-existing NG rows are correct with zero risk.
ALTER TABLE product_listings ADD COLUMN currency TEXT NOT NULL DEFAULT 'NGN';

-- Backfill: production already has non-NG catalog-seed listings (GH/KE/MA
-- vendors from the Stage 1 catalog import) that must NOT silently inherit
-- the NGN default above. Sourced from the vendor's own country_iso via
-- cc_countries.currency_code — the existing, correct "default currency"
-- asset — applied ONCE here at migration time, never re-derived at read
-- time afterward (per the explicit "stored fact, not derived" mandate).
UPDATE product_listings
SET currency = (
  SELECT cc.currency_code
  FROM vendors v
  JOIN cc_countries cc ON cc.iso_code = v.country_iso
  WHERE v.id = product_listings.vendor_id
)
WHERE vendor_id IN (SELECT id FROM vendors WHERE country_iso != 'NG');

-- ---------- 2. COUNTRY-AWARE REGIONS ----------
-- Generalizes nigerian_states without deleting or altering it — any code
-- not yet migrated keeps working unchanged. This table is the
-- country-parameterized replacement going forward.
CREATE TABLE IF NOT EXISTS country_regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_iso TEXT NOT NULL,
  name TEXT NOT NULL,
  is_capital_region INTEGER NOT NULL DEFAULT 0, -- generalized "is_fct"
  sort_order INTEGER NOT NULL,
  UNIQUE(country_iso, name)
);
CREATE INDEX IF NOT EXISTS idx_country_regions_country ON country_regions(country_iso);

-- Seeded FROM nigerian_states for NG so the data is identical, not re-typed.
INSERT INTO country_regions (country_iso, name, is_capital_region, sort_order)
  SELECT 'NG', name, is_fct, sort_order FROM nigerian_states;

-- Ghana's 16 regions included as reference data ONLY, proving the table
-- design generalizes to a second country. This is NOT a Ghana market
-- activation — cc_countries.status for GH remains 'PLANNED', untouched.
INSERT INTO country_regions (country_iso, name, is_capital_region, sort_order) VALUES
  ('GH', 'Greater Accra', 1, 1), ('GH', 'Ashanti', 0, 2), ('GH', 'Western', 0, 3),
  ('GH', 'Eastern', 0, 4), ('GH', 'Central', 0, 5), ('GH', 'Volta', 0, 6),
  ('GH', 'Northern', 0, 7), ('GH', 'Upper East', 0, 8), ('GH', 'Upper West', 0, 9),
  ('GH', 'Bono', 0, 10), ('GH', 'Bono East', 0, 11), ('GH', 'Ahafo', 0, 12),
  ('GH', 'Western North', 0, 13), ('GH', 'Oti', 0, 14), ('GH', 'North East', 0, 15),
  ('GH', 'Savannah', 0, 16);

-- ---------- 3. ORDER COUNTRY ----------
ALTER TABLE orders ADD COLUMN shipping_country TEXT NOT NULL DEFAULT 'NG';

-- ---------- 4. ADDRESS BOOK COUNTRY ----------
ALTER TABLE addresses ADD COLUMN country_iso TEXT NOT NULL DEFAULT 'NG';
