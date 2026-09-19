-- Migration 0067: Product Country-of-Origin Relationship
--
-- Purpose: lay the data foundation for "Explore Africa by Country" (Pat's
-- Unit E Phase A directive) WITHOUT fabricating or inferring country
-- provenance for any product. Per Pat's explicit decision, a single
-- `country_of_origin_iso` column on `products` was REJECTED in favor of a
-- proper one-to-many relationship table, because:
--   1. A product can legitimately have more than one country of origin in
--      the future (e.g. a blended product, or components sourced from
--      multiple countries) — a single FK column can't express that.
--   2. Provenance needs its own verification lifecycle independent of the
--      product row itself (unverified/verified/disputed), a source
--      reference, and a timestamp — cramming that onto `products` would
--      violate single-responsibility and force nullable-everything on a
--      row that is otherwise fully populated.
--   3. Origin (where a product is FROM) must stay architecturally separate
--      from `vendors.country_iso` (where the SELLER is based), which
--      already exists and is untouched by this migration. A product can be
--      "Origin: Ghana, Seller: Nigeria" without conflating the two.
--
-- NON-NEGOTIABLE COMPATIBILITY RULES (matching this project's established
-- migration discipline — see migrations 0038/0040/0053 headers):
--   - Zero destructive changes. No table dropped or rebuilt. No existing
--     column removed, renamed, or reinterpreted.
--   - Purely additive: one new table + supporting indexes. No changes to
--     `products`, `vendors`, or `cc_countries` DDL.
--   - This migration inserts ZERO rows. It only creates the structure.
--     0068_catalog_expansion_stage1.sql (the companion data migration) was
--     audited against all 59 products being merged in this unit for
--     genuine provenance language in title/description/specs — ZERO hits.
--     The only "signal" that existed anywhere was inferred from phase1a's
--     category naming (e.g. a product sitting under "Nigerian Fashion"),
--     which is explicitly NOT a valid source per instruction. So 0068 also
--     inserts ZERO rows into this table for this batch. Population is
--     deferred to a future Phase B pass with real, per-product verified
--     provenance — never inferred from category name, brand identity, or
--     seller location.
--   - Every ALTER/CREATE uses IF NOT EXISTS / constant defaults per the
--     SQLite restriction already documented in migrations 0027/0037/0038.

PRAGMA foreign_keys = OFF;

-- ============================================================
-- product_country_origins: many-to-many, verifiable product provenance
-- ============================================================
CREATE TABLE IF NOT EXISTS product_country_origins (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id            INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  country_iso           TEXT NOT NULL REFERENCES cc_countries(iso_code),

  -- origin_type distinguishes WHY this country is attached to the product.
  -- 'manufactured' = physically made/assembled there; 'grown' = agricultural
  -- produce/raw material origin; 'crafted' = handmade/artisanal origin;
  -- 'brand_origin' = the brand's home country (weakest claim, used only when
  -- no stronger signal exists and still explicitly labeled as such, never
  -- silently upgraded to 'manufactured').
  origin_type           TEXT NOT NULL DEFAULT 'unspecified'
                          CHECK (origin_type IN
                            ('manufactured', 'grown', 'crafted', 'brand_origin', 'unspecified')),

  -- verification_status is the honesty gate: nothing with status != 'verified'
  -- may be surfaced on any public "Products From <Country>" page. Rows may
  -- legitimately sit at 'unverified' indefinitely — that is not an error
  -- state, it is the correct default for provenance we have not confirmed.
  verification_status   TEXT NOT NULL DEFAULT 'unverified'
                          CHECK (verification_status IN ('unverified', 'verified', 'disputed')),

  -- source_url: where the provenance claim came from (supplier spec sheet,
  -- vendor-submitted documentation, category taxonomy note, etc.). NULL is
  -- allowed for 'unverified' rows; should be populated before flipping a
  -- row to 'verified'.
  source_url            TEXT,

  -- Free-text note for how/why this origin was assigned — required for
  -- audit trail so a future reviewer (human or Genspark) can see WHY a
  -- product was linked to a country without re-deriving it from scratch.
  note                  TEXT NOT NULL DEFAULT '',

  verified_by_user_id   INTEGER REFERENCES users(id),
  verified_at           TEXT,

  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(product_id, country_iso)
);

CREATE INDEX IF NOT EXISTS idx_product_country_origins_product
  ON product_country_origins(product_id);

CREATE INDEX IF NOT EXISTS idx_product_country_origins_country
  ON product_country_origins(country_iso);

-- The query the future "Explore Africa -> Country -> Products From This
-- Country" page will run: fast lookup of verified origins for one country.
CREATE INDEX IF NOT EXISTS idx_product_country_origins_verified_lookup
  ON product_country_origins(country_iso, verification_status);

PRAGMA foreign_keys = ON;
