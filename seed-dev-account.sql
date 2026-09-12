-- NaijaDeals — Development Account Fixture (NOT a migration, NOT part of seed.sql)
--
-- Purpose: creates ONE demo/test persona ("Chidinma Okafor") with realistic
-- wishlist / saved-payment-method / notification data so account-experience
-- pages (wishlist, account, notifications) have something real to render
-- in local development, WITHOUT smuggling that data into a schema migration.
--
-- Why this file exists (history): these exact 14 rows used to live inside
-- migrations/0005_account_experience.sql. That broke the "migrations must
-- apply against an empty database" invariant, because they referenced
-- users.id = 1, but no migration creates any users row. This file is the
-- corrected home for that data.
--
-- IMPORTANT — why this file lives at the project ROOT, not inside
-- migrations/: `wrangler d1 migrations apply` auto-scans every *.sql file
-- physically present in the migrations/ directory and applies ANY of them
-- it hasn't recorded yet, in filename order — it does not distinguish
-- "real" numbered migrations from anything else sitting in that folder.
-- Discovered live during this session's bootstrap test: with this file
-- placed inside migrations/, `migrations apply` auto-ran it immediately
-- after 0012, before seed.sql had ever executed, and it failed with
-- FOREIGN KEY constraint failed (no users/products rows existed yet) —
-- exactly the same class of bug this file exists to fix, just moved one
-- level up. Root cause: file PLACEMENT, not file CONTENT. Keeping it out
-- of migrations/ is what makes it opt-in only, run explicitly via
-- --file=seed-dev-account.sql, at the correct point in the bootstrap.
--
-- Run order:
--     1) wrangler d1 migrations apply ...       (schema only, 0001-latest)
--     2) wrangler d1 execute ... --file=seed.sql             (catalog/business data)
--     3) wrangler d1 execute ... --file=seed-dev-account.sql (THIS FILE — persona/test fixture)
--
-- This file is idempotent: every block deletes its own rows for the dev
-- user before re-inserting, mirroring the DELETE-then-INSERT precedent
-- already used at the top of seed.sql. There is no natural UNIQUE key on
-- wishlists/saved_payment_methods/notifications suitable for INSERT OR
-- IGNORE-based deduplication (wishlists has UNIQUE(user_id, product_id),
-- which would silently dedupe correctly, but saved_payment_methods and
-- notifications have no such constraint), so DELETE-then-INSERT is used
-- uniformly across all four blocks for consistency and predictability.
--
-- Credentials for this account (local development ONLY — never used in
-- production, never a real password):
--   Email:    chidinma.okafor@naijadeals.dev
--   Password: NaijaDevAccount2026!
--   (password_hash/password_salt below are the real PBKDF2 values produced
--   by src/lib/auth.ts's hashPassword() for that exact password — verified
--   by independently recomputing crypto.pbkdf2(password, salt, 100000, 32,
--   'sha256') in Node and confirming an exact match before writing this file.)

PRAGMA foreign_keys=OFF;

-- ============================================================
-- 1) The dev user itself
-- ============================================================
-- Explicit id=1 requested/expected by the fixture data below. On a freshly
-- bootstrapped database (migrations + seed.sql, neither of which touch
-- `users`) this is also the first row ever inserted into `users`, so it
-- would receive id=1 via AUTOINCREMENT even without stating it explicitly.
-- Being explicit here removes any ambiguity and keeps this file re-runnable.
DELETE FROM users WHERE id = 1;

INSERT INTO users (id, email, phone, name, password_hash, password_salt, is_phone_verified, is_email_verified, role, created_at, updated_at) VALUES
  (1, 'chidinma.okafor@naijadeals.dev', '+2348030000001', 'Chidinma Okafor',
   '6836a09757e366826363551102527da22c61b9383360ca68dc1955f0c0ce8f50',
   '64266461daa91d463b9991f3ef778c4f',
   1, 1, 'customer', datetime('now', '-30 days'), datetime('now', '-30 days'));

-- ============================================================
-- 2) Wishlist — 4 real products from seed.sql, none already implied as
--    purchased/carted, chosen only because they exist deterministically
--    at these exact ids in seed.sql (verified before writing this file).
-- ============================================================
DELETE FROM wishlists WHERE user_id = 1;

INSERT INTO wishlists (user_id, product_id, created_at) VALUES
  (1, 9,  datetime('now', '-6 days')),   -- LG 55" OLED evo C3 4K Smart TV
  (1, 12, datetime('now', '-4 days')),   -- Sony WH-1000XM5 Noise Cancelling Headphones
  (1, 15, datetime('now', '-2 days')),   -- Nike Air Force 1 Low White Original
  (1, 20, datetime('now', '-1 days'));   -- Binatone 4-Burner Gas Cooker with Oven

-- ============================================================
-- 3) Saved payment methods — clearly test-safe references only, using the
--    same provider vocabulary ('paystack','wallet') the backend actually
--    accepts. No real card data ever stored.
-- ============================================================
DELETE FROM saved_payment_methods WHERE user_id = 1;

INSERT INTO saved_payment_methods (user_id, type, label, provider_ref, is_default, created_at) VALUES
  (1, 'card',   'Verve •••• 4081 (test card)',       'PSTK_TESTCARD_4081', 1, datetime('now', '-10 days')),
  (1, 'card',   'Mastercard •••• 5399 (test card)',  'PSTK_TESTCARD_5399', 0, datetime('now', '-3 days')),
  (1, 'wallet', 'NaijaDeals Wallet',                 'wallet',             0, datetime('now', '-10 days'));

-- ============================================================
-- 4) Notifications — confirmed (before writing this file) that
--    src/lib and src/pages contain ZERO reads of `orders`/`wallet_ledger`
--    joined against these notification rows: notifications.reference_id
--    is a free-text column, not FK-constrained, and no page resolves it
--    back to a real order. Per Pat's explicit instruction, fake order
--    fixtures are NOT created just to back these strings — the app does
--    not consume reference_id as a lookup key anywhere today. If a future
--    feature starts joining notifications to real orders, real order
--    fixtures must be added at that time, not before.
-- ============================================================
DELETE FROM notifications WHERE user_id = 1;

INSERT INTO notifications (user_id, type, title, body, action_url, reference_type, reference_id, is_read, created_at) VALUES
  (1, 'order_confirmed',   'Order confirmed',
      'Your order has been confirmed and is being prepared by your seller(s).',
      '/orders', 'order', 'ND-DEVFIXTURE-001', 1, datetime('now', '-2 hours', '-3 minutes')),
  (1, 'payment_received',  'Payment received',
      'We''ve received your wallet payment. Funds are held in escrow until delivery is confirmed.',
      '/wallet', 'wallet', 'DEVFIXTURE', 1, datetime('now', '-2 hours')),
  (1, 'order_shipped',     'Your order has shipped',
      'Your seller has shipped your order. Estimated delivery in 3-7 business days.',
      '/orders', 'order', 'ND-DEVFIXTURE-001', 0, datetime('now', '-1 hours', '-20 minutes')),
  (1, 'wishlist_price_drop', 'Price drop on an item in your wishlist',
      'An item in your wishlist just dropped in price — check it out before it''s gone.',
      '/wishlist', 'product', 'lg-55-oled-evo-c3-4k-smart-tv', 0, datetime('now', '-40 minutes')),
  (1, 'promotion',          'WELCOME10 — 10% off your next order',
      'Use code WELCOME10 for 10% off orders above ₦5,000. Valid on your next checkout.',
      '/shop?deals=1', null, null, 0, datetime('now', '-1 days')),
  (1, 'security',           'New sign-in to your account',
      'Your NaijaDeals account was signed in from a new session. If this wasn''t you, secure your account immediately.',
      '/account/security', 'security', null, 1, datetime('now', '-1 days', '-3 hours'));

PRAGMA foreign_keys=ON;
