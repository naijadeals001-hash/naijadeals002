-- Migration 0092: NaijaEats -> Logistics Engine fulfillment bridge
-- Local/dev-safe additive schema. This does not create fake drivers, shipments or payments.

CREATE TABLE IF NOT EXISTS eats_order_fulfillments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES eats_orders(id) ON DELETE CASCADE,
  shipment_id INTEGER NOT NULL UNIQUE REFERENCES shipments(id) ON DELETE RESTRICT,
  dispatch_status TEXT NOT NULL DEFAULT 'dispatch_requested'
    CHECK (dispatch_status IN ('dispatch_requested', 'assigned', 'in_transit', 'delivered', 'cancelled', 'exception')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eats_fulfillments_status ON eats_order_fulfillments(dispatch_status);
CREATE INDEX IF NOT EXISTS idx_eats_fulfillments_shipment ON eats_order_fulfillments(shipment_id);
