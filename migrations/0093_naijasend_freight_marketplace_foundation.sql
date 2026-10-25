-- Migration 0093: NaijaSend freight load and bid foundation
-- Additive local/dev schema. Carrier eligibility still requires a real logistics provider row.

CREATE TABLE IF NOT EXISTS freight_loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open_for_bids','matching','awarded','in_transit','delivered','cancelled','disputed')),
  dispatch_method TEXT NOT NULL DEFAULT 'competitive_bidding' CHECK (dispatch_method IN ('competitive_bidding','automated_dispatch')),
  transport_mode TEXT NOT NULL CHECK (transport_mode IN ('road','air','water','rail','intermodal')),
  origin_country_iso TEXT NOT NULL,
  destination_country_iso TEXT NOT NULL,
  pickup_address_json TEXT NOT NULL,
  delivery_address_json TEXT NOT NULL,
  pickup_window_start TEXT,
  pickup_window_end TEXT,
  delivery_window_start TEXT,
  delivery_window_end TEXT,
  cargo_category TEXT NOT NULL,
  cargo_description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  weight_kg REAL NOT NULL CHECK (weight_kg > 0),
  volume_m3 REAL,
  declared_value_kobo INTEGER,
  is_fragile INTEGER NOT NULL DEFAULT 0,
  is_perishable INTEGER NOT NULL DEFAULT 0,
  is_hazardous INTEGER NOT NULL DEFAULT 0,
  required_equipment_json TEXT NOT NULL DEFAULT '[]',
  status_note TEXT,
  awarded_bid_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_freight_loads_customer ON freight_loads(customer_user_id, id);
CREATE INDEX IF NOT EXISTS idx_freight_loads_open ON freight_loads(status, transport_mode, origin_country_iso, destination_country_iso);

CREATE TABLE IF NOT EXISTS freight_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_id INTEGER NOT NULL REFERENCES freight_loads(id) ON DELETE CASCADE,
  logistics_provider_id INTEGER NOT NULL REFERENCES logistics_providers(id),
  carrier_user_id INTEGER NOT NULL REFERENCES users(id),
  price_kobo INTEGER NOT NULL CHECK (price_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  pickup_eta TEXT,
  delivery_eta TEXT,
  equipment_json TEXT NOT NULL DEFAULT '[]',
  terms TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','withdrawn','awarded','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(load_id, logistics_provider_id)
);

CREATE INDEX IF NOT EXISTS idx_freight_bids_load ON freight_bids(load_id, status, price_kobo);
CREATE INDEX IF NOT EXISTS idx_freight_bids_carrier ON freight_bids(carrier_user_id, id);
