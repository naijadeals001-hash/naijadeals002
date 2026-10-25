-- Prevent duplicate checkout submissions from creating duplicate pending orders.
ALTER TABLE orders ADD COLUMN checkout_idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_checkout_idempotency ON orders(user_id, checkout_idempotency_key) WHERE checkout_idempotency_key IS NOT NULL;
