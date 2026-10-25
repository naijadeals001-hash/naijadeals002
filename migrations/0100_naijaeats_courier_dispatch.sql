-- NaijaEats courier dispatch offers and auditable fulfillment proof.
-- Reuses driver_profiles, delivery_jobs and the existing Logistics Engine.
ALTER TABLE eats_order_fulfillments ADD COLUMN dispatch_outcome TEXT NOT NULL DEFAULT 'pending'
  CHECK (dispatch_outcome IN ('pending','offers_open','courier_assigned','picked_up','out_for_delivery','delivered','no_courier_available','cancelled'));
ALTER TABLE eats_order_fulfillments ADD COLUMN courier_driver_id INTEGER REFERENCES driver_profiles(id);
ALTER TABLE eats_order_fulfillments ADD COLUMN reassignment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE eats_order_fulfillments ADD COLUMN proof_type TEXT;
ALTER TABLE eats_order_fulfillments ADD COLUMN proof_recorded_at TEXT;

CREATE TABLE IF NOT EXISTS eats_courier_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fulfillment_id INTEGER NOT NULL REFERENCES eats_order_fulfillments(id) ON DELETE CASCADE,
  delivery_job_id INTEGER NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  courier_driver_id INTEGER NOT NULL REFERENCES driver_profiles(id),
  status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','rejected','expired','superseded')),
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_eats_offer_active_courier ON eats_courier_offers(fulfillment_id, courier_driver_id) WHERE status IN ('offered','accepted');
CREATE INDEX IF NOT EXISTS idx_eats_offer_inbox ON eats_courier_offers(courier_driver_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_eats_offer_fulfillment ON eats_courier_offers(fulfillment_id, id DESC);

CREATE TABLE IF NOT EXISTS eats_fulfillment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fulfillment_id INTEGER NOT NULL REFERENCES eats_order_fulfillments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  actor_role TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eats_fulfillment_events ON eats_fulfillment_events(fulfillment_id, id DESC);

CREATE TABLE IF NOT EXISTS eats_courier_zone_permissions (
  driver_id INTEGER NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  country_iso TEXT NOT NULL,
  zone_key TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (driver_id, country_iso, zone_key)
);
