-- Migration 0019: Naijasend Shipment Foundation
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
-- belonging to migration "0019_naijasend_shipment_foundation.sql", as closely as a final-state
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

CREATE TABLE IF NOT EXISTS shipment_rate_cards (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_zone          TEXT NOT NULL,   
  vehicle_type_id      INTEGER NOT NULL REFERENCES vehicle_types(id),
  speed_tier           TEXT NOT NULL CHECK (speed_tier IN ('standard', 'express')),
  base_price_kobo      INTEGER NOT NULL,
  per_kg_price_kobo    INTEGER NOT NULL DEFAULT 0,  
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_cards_unique ON shipment_rate_cards(origin_zone, vehicle_type_id, speed_tier);

CREATE TABLE IF NOT EXISTS shipments (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_number        TEXT NOT NULL UNIQUE,   
  shipment_type          TEXT NOT NULL CHECK (shipment_type IN ('marketplace_order', 'standalone')),
  customer_user_id       INTEGER NOT NULL REFERENCES users(id),   
  order_id               INTEGER REFERENCES orders(id),           
  vendor_id              INTEGER REFERENCES vendors(id),          
  rate_card_id           INTEGER REFERENCES shipment_rate_cards(id),
  vehicle_type_id        INTEGER NOT NULL REFERENCES vehicle_types(id),
  speed_tier             TEXT NOT NULL CHECK (speed_tier IN ('standard', 'express')),
  origin_country_iso     TEXT NOT NULL,           
  destination_country_iso TEXT NOT NULL,
  declared_weight_kg     REAL NOT NULL DEFAULT 1,
  parcel_description     TEXT,                    
  quoted_price_kobo      INTEGER NOT NULL,
  currency               TEXT NOT NULL DEFAULT 'NGN',
  payment_status         TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  
  
  status                 TEXT NOT NULL DEFAULT 'booked' CHECK (status IN (
                           'booked', 'pickup_assigned', 'picked_up', 'in_transit',
                           'out_for_delivery', 'delivered', 'failed_delivery',
                           'returned', 'cancelled'
                         )),
  cancelled_reason       TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
, source_type TEXT CHECK (source_type IN ('naijashop', 'naijafresh', 'naijaeats')), selected_vehicle_id INTEGER REFERENCES vehicles(id));

CREATE INDEX IF NOT EXISTS idx_shipments_customer ON shipments(customer_user_id, id);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_order_vendor_unique
  ON shipments(order_id, vendor_id)
  WHERE shipment_type = 'marketplace_order';
CREATE INDEX IF NOT EXISTS idx_shipments_selected_vehicle ON shipments(selected_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_shipments_source_type ON shipments(source_type);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_tracking_unique ON shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipments_vendor ON shipments(vendor_id, id);

CREATE TABLE IF NOT EXISTS shipment_addresses (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id        INTEGER NOT NULL REFERENCES shipments(id),
  address_role       TEXT NOT NULL CHECK (address_role IN ('pickup', 'dropoff')),
  recipient_name     TEXT NOT NULL,
  phone              TEXT NOT NULL,
  line1              TEXT NOT NULL,
  city               TEXT NOT NULL,
  state              TEXT NOT NULL,
  country_iso        TEXT NOT NULL,
  delivery_instructions TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_addresses_role_unique ON shipment_addresses(shipment_id, address_role);
CREATE INDEX IF NOT EXISTS idx_shipment_addresses_shipment ON shipment_addresses(shipment_id, address_role);

CREATE TABLE IF NOT EXISTS shipment_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id    INTEGER NOT NULL REFERENCES shipments(id),
  order_item_id  INTEGER REFERENCES order_items(id),
  quantity       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shipment_items_order_item ON shipment_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_items(shipment_id);

CREATE TABLE IF NOT EXISTS shipment_status_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id    INTEGER NOT NULL REFERENCES shipments(id),
  status         TEXT NOT NULL,   
  actor_user_id  INTEGER REFERENCES users(id),   
  note           TEXT,
  metadata_json  TEXT NOT NULL DEFAULT '{}',   
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shipment_status_events_shipment ON shipment_status_events(shipment_id, id);

