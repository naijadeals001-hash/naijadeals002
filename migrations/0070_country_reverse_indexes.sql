-- Migration 0070: Country reverse-lookup index — vendors
--
-- Stage 2A (Africa Catalog & Country Architecture), design section 1.2.
--
-- The Stage 2 discovery audit proposed reverse-lookup indexes on all three
-- country-relationship tables for the new /countries/:iso page's "products
-- available here" / "products from here" / "vendors based here" queries.
-- A fresh index inventory taken immediately before writing this migration
-- (not assumed from the design doc) found TWO of the three already exist:
--   idx_product_country_origins_country      (created by migration 0067)
--   idx_listing_country_availability_country (pre-existing, before Stage 1)
-- Only vendors.country_iso has no supporting index today. This migration
-- adds exactly that one index — no redundant CREATE INDEX IF NOT EXISTS
-- noise for the two that already exist.
--
-- Zero destructive changes. No existing column/table touched. Purely
-- additive: one new index.

CREATE INDEX IF NOT EXISTS idx_vendors_country_iso ON vendors(country_iso);
