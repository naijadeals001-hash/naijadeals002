-- NaijaDeals — Account Experience Migration (Phase E)
--
-- Adds the ONE piece of shared backbone that genuinely does not exist yet: notifications.
-- Everything else Phase E needs (wishlists, saved_payment_methods, addresses, orders,
-- wallet_ledger, reviews) already exists from prior migrations — this file does NOT
-- recreate any of them, it only extends the schema where a real gap exists.
--
-- Relationship map for what this migration touches:
--   notifications.user_id      -> users.id
--   (wishlists / saved_payment_methods already exist from prior migrations, untouched here)
--
-- Design rule carried over from wallet.ts: notifications are informational/read-state only,
-- never a source of truth for money/order state — order/payment status still lives on
-- `orders`/`wallet_ledger`; a notification just announces a change that already happened there.
--
-- SCHEMA-ONLY INVARIANT (added 2026-09-12): this file must apply cleanly against a
-- completely empty D1 database — zero application rows (users/products/orders/etc.)
-- required. It previously embedded 14 hardcoded development-fixture rows (wishlist/
-- saved_payment_methods/notifications for a demo "user_id = 1" account) directly in
-- this migration, which meant a fresh install of migrations 0001-0012 alone would fail
-- with `FOREIGN KEY constraint failed` because no `users` row ever existed to satisfy
-- `user_id = 1` (no migration or seed file creates users). That fixture data has been
-- relocated to migrations/seed-dev-account.sql — a separate, explicitly-run, clearly
-- labeled local-development fixture, run AFTER seed.sql, never bundled into schema.
-- Every future NaijaDeals migration must uphold this same invariant: schema migrations
-- create tables/indexes/columns and, at most, pure reference/lookup data (e.g.
-- nigerian_states, nigerian_banks, coupons) — never rows tied to a specific
-- users.id/orders.id that only a dev/demo environment happens to have.

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,              -- order_confirmed | payment_received | order_shipped | order_delivered
                                    -- | delivery_update | wishlist_price_drop | promotion | security
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  action_url TEXT,                 -- where clicking the notification should take the user, if applicable
  reference_type TEXT,             -- 'order' | 'product' | 'wallet' | 'security' | null
  reference_id TEXT,                -- order_number / product slug / etc — free-form, matches wallet_ledger's pattern
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
