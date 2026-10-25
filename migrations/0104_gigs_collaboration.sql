-- NaijaGigs collaboration: authorized service-order milestones and messages.
-- Additive only; no payment or escrow settlement is performed here.
CREATE TABLE IF NOT EXISTS service_order_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_order_id INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','submitted','approved','rejected','cancelled')),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_order_milestones_order ON service_order_milestones(service_order_id, id);

CREATE TABLE IF NOT EXISTS service_order_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_order_id INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_order_messages_order ON service_order_messages(service_order_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_order_milestones_idempotency ON service_order_milestones(service_order_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_order_messages_idempotency ON service_order_messages(service_order_id, sender_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
