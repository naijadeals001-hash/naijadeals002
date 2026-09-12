-- Migration 0038: Marketplace Engine 2.0 — Universal Multi-Vendor Commerce Foundation
--
-- NEW APPLICATION FEATURE (not a production-schema reconstruction), built on
-- top of the EXISTING buy-box architecture from migration 0002
-- (products = canonical catalog identity / product_listings = seller offer)
-- and the Identity & Account Engine from migration 0037 (organizations).
--
-- NON-NEGOTIABLE COMPATIBILITY RULES THIS FILE FOLLOWS:
--   - Zero destructive changes. No table is dropped or rebuilt. No existing
--     column is removed, renamed, or has its meaning changed.
--   - products.price_kobo / product_listings.price_kobo semantics are
--     UNCHANGED — every existing retail listing continues to price exactly
--     as before. Tiered/bulk pricing (section 11 of the spec) is a NEW,
--     OPTIONAL, additive table that only applies when a seller opts in.
--   - vendors.organization_id is the bridge migration 0037's own header
--     comment explicitly deferred to "a future, separate, purely-additive
--     migration once a vertical actually needs that bridge" — that need now
--     exists (Marketplace Engine spec section 4), so it is added here,
--     nullable, with zero impact on the 20 pre-seeded catalog vendors or any
--     existing individual/user_id-owned vendor.
--   - Every ALTER TABLE ADD COLUMN below uses a CONSTANT literal default
--     (never datetime('now') or any function call) per the SQLite
--     ALTER-TABLE-ADD-COLUMN restriction discovered/fixed in migration 0027
--     and respected again in migration 0037.
--   - Every new table is additive (CREATE TABLE IF NOT EXISTS) and every new
--     index is additive (CREATE INDEX IF NOT EXISTS).

-- ============================================================
-- 1. VENDOR <-> ORGANIZATION BRIDGE (spec section 4)
-- ============================================================
-- A vendor/store may now optionally be owned by an organization (a
-- multi-user business account from the Identity Engine) instead of, or in
-- addition to, a single user. Nullable and additive: every existing vendor
-- (individual-seller or catalog-seeded) is completely unaffected — it simply
-- has organization_id = NULL, exactly as it does today implicitly.
--
-- Authorization consequence (enforced in application code, never trusted
-- from the client): when organization_id IS NOT NULL, "does this user manage
-- this store" is resolved via organizations.ts's resolveMembership +
-- rbac.ts's requirePermission('store.manage'... use existing 'staff.manage'/
-- 'organization.manage' equivalents), never via vendors.user_id alone.
ALTER TABLE vendors ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE vendors ADD COLUMN store_type TEXT NOT NULL DEFAULT 'individual';
-- store_type is a soft classification (individual/business/organization/
-- manufacturer/distributor/wholesaler/farmer/retailer/brand) per spec
-- section 4 — intentionally NOT a CHECK constraint, since new vertical-
-- specific seller types must be addable without a future migration.

CREATE INDEX IF NOT EXISTS idx_vendors_organization_id ON vendors(organization_id);

-- ============================================================
-- 2. PRODUCT & LISTING MODERATION STATE (spec section 30)
-- ============================================================
-- Additive alongside the existing is_active boolean (which continues to
-- work exactly as before — a moderation status of 'active' plus is_active=1
-- is the default, fully-backward-compatible state for every existing row).
ALTER TABLE products ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE product_listings ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'active';
-- Valid values (enforced in application code, not a CHECK constraint, so
-- new vertical-specific states can be added without another migration):
-- draft | pending_review | active | paused | rejected | archived

CREATE INDEX IF NOT EXISTS idx_products_moderation_status ON products(moderation_status);
CREATE INDEX IF NOT EXISTS idx_product_listings_moderation_status ON product_listings(moderation_status);

-- ============================================================
-- 3. UNITS OF MEASURE + VARIABLE WEIGHT (spec sections 12 & 13)
-- ============================================================
-- Lives on product_listings (the seller-specific offer), because two
-- sellers of the "same" canonical product may legitimately sell it in
-- different units (e.g. Product "Nigerian Rice" -> Seller A lists it per
-- 5kg bag, Seller B lists it per 25kg bag — these are different LISTINGS,
-- not different products, matching section 3's mandate).
ALTER TABLE product_listings ADD COLUMN unit_of_measure TEXT NOT NULL DEFAULT 'piece';
-- piece | pack | box | kg | gram | ton | liter | ml | meter | bundle |
-- dozen | crate | bag | bottle — free-text by design (section 12), not a
-- CHECK constraint, so NaijaFresh/NaijaFarm can introduce new units without
-- a schema migration.
ALTER TABLE product_listings ADD COLUMN unit_quantity REAL NOT NULL DEFAULT 1;
-- e.g. unit_of_measure='kg', unit_quantity=25 means "this listing's single
-- sellable unit is a 25kg bag". price_kobo remains the price of ONE such
-- unit — zero change to existing pricing math for the 100% of listings that
-- default to unit_of_measure='piece', unit_quantity=1.

ALTER TABLE product_listings ADD COLUMN is_variable_weight INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_listings ADD COLUMN variable_weight_tolerance_pct REAL NOT NULL DEFAULT 0;
-- Section 13: when is_variable_weight=1, the customer orders a NOMINAL
-- quantity (e.g. "2kg fish") and the seller fulfils an ACTUAL weight that
-- may differ within variable_weight_tolerance_pct (e.g. 10 => +/-10%). The
-- final charged amount is computed from order_items.fulfilled_quantity (see
-- section 6 below) at fulfillment time, not at checkout time.

-- ============================================================
-- 4. TIERED / BULK / WHOLESALE PRICING (spec sections 10 & 11 — the
--    explicit "known gap")
-- ============================================================
-- Purely additive and OPTIONAL. A listing with zero rows in this table
-- behaves EXACTLY as it does today: one flat price_kobo, no tiers, no
-- change in behaviour whatsoever. A listing that opts in gets progressively
-- cheaper (or otherwise different) per-unit pricing at higher quantities.
-- Generic by design: works for rice, cement, building materials, food,
-- clothing, electronics, auto parts, farm produce, beauty, business
-- supplies — nothing here is rice-specific.
CREATE TABLE IF NOT EXISTS product_pricing_tiers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id        INTEGER NOT NULL REFERENCES product_listings(id) ON DELETE CASCADE,
  min_quantity      INTEGER NOT NULL,          -- inclusive lower bound (units of the listing's unit_of_measure)
  max_quantity      INTEGER,                   -- inclusive upper bound; NULL = unbounded ("100+")
  unit_price_kobo   INTEGER NOT NULL,          -- price PER UNIT at this tier (same kobo-integer convention as price_kobo)
  tier_label        TEXT,                      -- optional display label e.g. "Wholesale (50+ bags)"
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (max_quantity IS NULL OR max_quantity >= min_quantity)
);

CREATE INDEX IF NOT EXISTS idx_pricing_tiers_listing ON product_pricing_tiers(listing_id, min_quantity);

-- ============================================================
-- 5. INVENTORY DEPTH (spec section 9)
-- ============================================================
-- Additive alongside the existing flat `stock` integer (unchanged
-- semantics: stock = total on-hand). New columns add the
-- reserved/available distinction and safety controls without touching how
-- `stock` itself is read/written by any EXISTING code path.
ALTER TABLE product_listings ADD COLUMN reserved_quantity INTEGER NOT NULL DEFAULT 0;
-- available = stock - reserved_quantity (computed in application code, not
-- stored, to avoid a second source of truth that can drift).
ALTER TABLE product_listings ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 5;
ALTER TABLE product_listings ADD COLUMN allow_backorder INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_listings ADD COLUMN sku TEXT;
ALTER TABLE product_listings ADD COLUMN warehouse_location TEXT;

-- Append-only inventory movement ledger — every stock-affecting event
-- (order placed / cancelled / payment failed / fulfilled / returned /
-- manual seller adjustment) writes one row here. This gives sellers real
-- inventory history (section 9) and gives the platform an audit trail for
-- the "no negative inventory unless explicit backorder" rule (section 37).
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id      INTEGER NOT NULL REFERENCES product_listings(id) ON DELETE CASCADE,
  variant_id      INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
  delta           INTEGER NOT NULL,          -- signed change to stock (negative = decrement)
  reason          TEXT NOT NULL,             -- order_placed | order_cancelled | payment_failed | fulfilled | returned | manual_adjustment | restock
  order_id        INTEGER REFERENCES orders(id),
  actor_user_id   INTEGER REFERENCES users(id),  -- NULL for system-driven adjustments (e.g. order lifecycle)
  note            TEXT,
  stock_after     INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_listing ON inventory_adjustments(listing_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_order ON inventory_adjustments(order_id);

-- ============================================================
-- 6. ORDER ITEM EXTENSIONS — variable weight + richer lifecycle
--    (spec sections 13, 18, 19)
-- ============================================================
ALTER TABLE order_items ADD COLUMN fulfilled_quantity REAL;
-- NULL until fulfilled; for is_variable_weight listings this holds the
-- ACTUAL weight/quantity the seller fulfilled (e.g. ordered 2, fulfilled
-- 2.15) and drives the final settlement amount. For ordinary fixed-unit
-- listings this simply mirrors `quantity` once fulfilled.
ALTER TABLE order_items ADD COLUMN final_price_kobo INTEGER;
-- NULL until computed; for variable-weight items this is
-- unit_price_kobo * fulfilled_quantity (rounded), superseding
-- line_total_kobo as the amount actually owed/settled for that item.
ALTER TABLE order_items ADD COLUMN unit_of_measure TEXT NOT NULL DEFAULT 'piece';
-- Historical snapshot of the listing's unit_of_measure at time of purchase
-- (section 19: order items must not depend on the live listing record).

-- ============================================================
-- 7. ORDER LIFECYCLE EXTENSION (spec section 18)
-- ============================================================
-- orders.status already exists (migration 0002) with informal values
-- pending_payment / processing / escrow_held used by the current
-- application code. This is purely additive metadata to support the
-- fuller lifecycle (cancellation reason, timestamps for key transitions)
-- without changing how the existing status column is read or written by
-- any current code path.
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
ALTER TABLE orders ADD COLUMN cancellation_reason TEXT;
ALTER TABLE orders ADD COLUMN cancelled_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE orders ADD COLUMN fulfilled_at TEXT;
ALTER TABLE orders ADD COLUMN delivered_at TEXT;

-- Per-seller fulfillment status already exists as order_items.item_status
-- (migration 0002, default 'processing') — reused here, not duplicated.
-- Valid values extended in application code only (no CHECK, so new
-- vertical-specific fulfillment states don't require a migration):
-- processing | fulfilled | shipped | delivered | completed | cancelled |
-- failed | refunded | partially_refunded | returned | disputed

-- ============================================================
-- 8. STRUCTURED PRODUCT ATTRIBUTES (spec section 7)
-- ============================================================
-- Category-associated, dynamic attribute schema — additive alongside the
-- existing free-form products.specs_json (which continues to render
-- exactly as today; nothing consumes this new structure until UI/API code
-- opts in). This is the foundation for NaijaAuto (Make/Model/Year/OEM),
-- NaijaBeauty (Shade/Skin Type), NaijaHealth (Strength/Form), etc. without
-- ever adding vertical-specific columns to `products`.
CREATE TABLE IF NOT EXISTS category_attributes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id     INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,             -- machine key e.g. "ram_gb", "compatible_model"
  label           TEXT NOT NULL,             -- display label e.g. "RAM (GB)"
  data_type       TEXT NOT NULL DEFAULT 'text', -- text | number | boolean | select | multiselect
  options_json    TEXT,                      -- JSON array of allowed values when data_type is select/multiselect
  requirement     TEXT NOT NULL DEFAULT 'optional', -- required | optional | recommended | conditional
  condition_json  TEXT,                      -- optional JSON rule describing when a 'conditional' attribute applies
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category_id, key)
);

CREATE INDEX IF NOT EXISTS idx_category_attributes_category ON category_attributes(category_id, sort_order);

CREATE TABLE IF NOT EXISTS product_attribute_values (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id  INTEGER NOT NULL REFERENCES category_attributes(id) ON DELETE CASCADE,
  value         TEXT NOT NULL,
  UNIQUE(product_id, attribute_id)
);

CREATE INDEX IF NOT EXISTS idx_product_attribute_values_product ON product_attribute_values(product_id);
CREATE INDEX IF NOT EXISTS idx_product_attribute_values_attribute ON product_attribute_values(attribute_id, value);

-- ============================================================
-- 9. MERCHANDISING COLLECTIONS (spec section 26) — separate from taxonomy
-- ============================================================
-- A product can belong to N collections (Featured, Best Sellers, African
-- Made, Local Favorites, Wholesale, Diaspora Favorites, ...) without ANY
-- change to its canonical category_id/brand_id. This is also the proper,
-- non-hardcoded home for the Africa-first taxonomy tags in spec section 6
-- (African Made, Made in Nigeria/Ghana/Kenya/SA, Local Makers, Traditional,
-- Farm Direct, Market Fresh, Imported, Export Ready, Diaspora Favorites,
-- SME, Wholesale, Bulk, Verified Seller) — each becomes a `collection` row,
-- never hardcoded UI text.
CREATE TABLE IF NOT EXISTS collections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  collection_type TEXT NOT NULL DEFAULT 'merchandising', -- merchandising | africa_first | seasonal | editorial
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_collections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(collection_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_collections_collection ON product_collections(collection_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_collections_product ON product_collections(product_id);

-- Seed the Africa-first taxonomy collections named explicitly in spec
-- section 6, so the feature is immediately usable rather than an empty
-- shell. No products are auto-assigned — sellers/admins populate membership
-- via the marketplace API, never hardcoded.
INSERT OR IGNORE INTO collections (slug, name, collection_type, sort_order) VALUES
  ('african-made', 'African Made', 'africa_first', 1),
  ('made-in-nigeria', 'Made in Nigeria', 'africa_first', 2),
  ('made-in-ghana', 'Made in Ghana', 'africa_first', 3),
  ('made-in-kenya', 'Made in Kenya', 'africa_first', 4),
  ('made-in-south-africa', 'Made in South Africa', 'africa_first', 5),
  ('local-makers', 'Local Makers', 'africa_first', 6),
  ('traditional', 'Traditional', 'africa_first', 7),
  ('farm-direct', 'Farm Direct', 'africa_first', 8),
  ('market-fresh', 'Market Fresh', 'africa_first', 9),
  ('imported', 'Imported', 'africa_first', 10),
  ('export-ready', 'Export Ready', 'africa_first', 11),
  ('diaspora-favorites', 'Diaspora Favorites', 'africa_first', 12),
  ('sme', 'SME', 'africa_first', 13),
  ('wholesale', 'Wholesale', 'africa_first', 14),
  ('bulk', 'Bulk', 'africa_first', 15),
  ('verified-seller', 'Verified Seller', 'africa_first', 16),
  ('featured', 'Featured Products', 'merchandising', 20),
  ('best-sellers', 'Best Sellers', 'merchandising', 21),
  ('new-arrivals', 'New Arrivals', 'merchandising', 22),
  ('editors-picks', 'Editor''s Picks', 'editorial', 23);

-- ============================================================
-- 10. SELLER FINANCE PERMISSION HOOK — organization-owned stores
--     (spec section 4, wiring to the Identity Engine's RBAC)
-- ============================================================
-- The Identity Engine (migration 0037) seeded platform-wide organization
-- permissions but had no concept of a "store" yet. Add the store-management
-- permission now so requirePermission('store.manage') is available to any
-- organization role from day one of this bridge — additive, does not touch
-- any existing permission or role-permission mapping.
INSERT OR IGNORE INTO organization_permissions (key, category, name, description) VALUES
  ('store.manage', 'marketplace', 'Manage Store', 'Create and manage the organization''s marketplace store, products, listings and inventory'),
  ('store.orders.read', 'marketplace', 'View Store Orders', 'View orders placed against the organization''s store'),
  ('store.orders.manage', 'marketplace', 'Manage Store Orders', 'Update fulfillment status of orders placed against the organization''s store');

-- Grant the new store.* permissions to the system Owner/Admin/Manager
-- roles (matching the existing pattern where those roles receive broad
-- operational permissions) — Staff intentionally does NOT get store.manage
-- by default (can view orders only), mirroring the principle of least
-- privilege already used for other 0037-seeded permissions.
INSERT OR IGNORE INTO organization_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM organization_roles r
JOIN organization_permissions p ON p.key IN ('store.manage', 'store.orders.read', 'store.orders.manage')
WHERE r.organization_id IS NULL AND r.key IN ('owner', 'admin', 'manager');

INSERT OR IGNORE INTO organization_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM organization_roles r
JOIN organization_permissions p ON p.key = 'store.orders.read'
WHERE r.organization_id IS NULL AND r.key = 'staff';
