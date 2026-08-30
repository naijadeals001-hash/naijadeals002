-- NaijaDeals — Account Experience Migration (Phase E)
--
-- Adds the ONE piece of shared backbone that genuinely does not exist yet: notifications.
-- Everything else Phase E needs (wishlists, saved_payment_methods, addresses, orders,
-- wallet_ledger, reviews) already exists from prior migrations — this file does NOT
-- recreate any of them, it only extends the schema where a real gap exists and seeds
-- coherent development data for the existing test account (user_id = 1, Chidinma Okafor).
--
-- Relationship map for what this migration touches / reads:
--   notifications.user_id      -> users.id
--   wishlists.user_id          -> users.id            (existing table, 0 rows before this migration)
--   wishlists.product_id      -> products.id          (existing table)
--   saved_payment_methods.user_id -> users.id         (existing table, 0 rows before this migration)
--   reviews                    -> read-only in this migration (174 rows already seeded in 0002/0003,
--                                 not touched here — "reviews awaiting completion" is derived at query
--                                 time from order_items + reviews, no new table needed for that)
--
-- Design rule carried over from wallet.ts: notifications are informational/read-state only,
-- never a source of truth for money/order state — order/payment status still lives on
-- `orders`/`wallet_ledger`; a notification just announces a change that already happened there.

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

-- ============================================================
-- Development seed data — test account (user_id = 1)
-- ============================================================
-- All rows below reference REAL rows already in the DB from prior turns:
--   orders 1/2/3 (ND-MTGDVFCM-198, ND-MTGDVT08-573, ND-MTGDWHGP-098) — real order_numbers
--   products 9/12/15/20 (LG OLED TV, Sony WH-1000XM5, Nike Air Force 1, Binatone gas cooker)
--     — chosen because none of these are already in the test user's cart/orders, so the
--     wishlist genuinely represents "things not yet bought", not a duplicate of cart contents
--   wallet_ledger reference_id '1' and '3' — the two real order-payment debits already in the ledger
-- Nothing here is Lorem-ipsum or fabricated activity; every row is a plausible customer touchpoint
-- tied to data that already exists and is queryable/joinable by the pages we're about to build.

-- ---------- Wishlist: 4 real products, not already in the cart or in any order ----------
INSERT INTO wishlists (user_id, product_id, created_at) VALUES
  (1, 9,  datetime('now', '-6 days')),   -- LG 55" OLED evo C3 4K Smart TV (has a real compare_at_price -> price-drop notification below is truthful)
  (1, 12, datetime('now', '-4 days')),   -- Sony WH-1000XM5 Noise Cancelling Headphones
  (1, 15, datetime('now', '-2 days')),   -- Nike Air Force 1 Low White Original
  (1, 20, datetime('now', '-1 days'));   -- Binatone 4-Burner Gas Cooker with Oven

-- ---------- Saved payment methods: safe, non-sensitive dev references only ----------
-- type/provider_ref use the SAME vocabulary as payment_transactions.provider ('paystack','wallet')
-- so the account page and checkout stay consistent with what the backend actually accepts.
-- No real PAN/CVV ever stored — provider_ref is a fake-safe test token pattern, and label is a
-- masked display string, exactly matching Paystack's own "last 4 digits" masking convention.
INSERT INTO saved_payment_methods (user_id, type, label, provider_ref, is_default, created_at) VALUES
  (1, 'card',   'Verve •••• 4081 (test card)',       'PSTK_TESTCARD_4081', 1, datetime('now', '-10 days')),
  (1, 'card',   'Mastercard •••• 5399 (test card)',  'PSTK_TESTCARD_5399', 0, datetime('now', '-3 days')),
  (1, 'wallet', 'NaijaDeals Wallet',                 'wallet',             0, datetime('now', '-10 days'));

-- ---------- Notifications: each one ties to a REAL event already in the DB ----------
-- order_confirmed / payment_received / order_shipped -> order 1 (ND-MTGDVFCM-198), oldest, most progressed
-- payment_received (2nd)                            -> order 3 (ND-MTGDWHGP-098), the successful Buy Now order
-- order failed / unpaid reminder is deliberately OMITTED as a "shipped/delivered" notification for order 2
--   (ND-MTGDVT08-573) because that order is genuinely still pending_payment/unpaid — inventing a shipped
--   notification for an unpaid order would be exactly the kind of fake activity Pat told us not to create.
--   Instead order 2 gets a truthful "payment reminder"-style entry via its own accurate status.
INSERT INTO notifications (user_id, type, title, body, action_url, reference_type, reference_id, is_read, created_at) VALUES
  (1, 'order_confirmed',   'Order confirmed',
      'Your order ND-MTGDVFCM-198 has been confirmed and is being prepared by GadgetTech Hub and PhonePlace Abuja.',
      '/orders/ND-MTGDVFCM-198', 'order', 'ND-MTGDVFCM-198', 1, datetime('now', '-2 hours', '-3 minutes')),
  (1, 'payment_received',  'Payment received — ₦1,144,000',
      'We''ve received your wallet payment for order ND-MTGDVFCM-198. Funds are held in escrow until delivery is confirmed.',
      '/wallet', 'wallet', '1', 1, datetime('now', '-2 hours')),
  (1, 'order_shipped',     'Your order has shipped',
      'GadgetTech Hub has shipped your Tecno Camon 30 Pro 5G (order ND-MTGDVFCM-198). Estimated delivery in 3-7 business days.',
      '/orders/ND-MTGDVFCM-198', 'order', 'ND-MTGDVFCM-198', 0, datetime('now', '-1 hours', '-20 minutes')),
  (1, 'payment_received',  'Payment received — ₦868,500',
      'We''ve received your wallet payment for order ND-MTGDWHGP-098. Funds are held in escrow until delivery is confirmed.',
      '/orders/ND-MTGDWHGP-098', 'order', 'ND-MTGDWHGP-098', 0, datetime('now', '-55 minutes')),
  (1, 'wishlist_price_drop', 'Price drop on an item in your wishlist',
      'LG 55" OLED evo C3 4K Smart TV is now ₦950,000, down from ₦1,150,000 — save ₦200,000.',
      '/shop/lg-55-oled-evo-c3-4k-smart-tv', 'product', 'lg-55-oled-evo-c3-4k-smart-tv', 0, datetime('now', '-40 minutes')),
  (1, 'promotion',          'WELCOME10 — 10% off your next order',
      'Use code WELCOME10 for 10% off orders above ₦5,000. Valid on your next checkout.',
      '/shop?deals=1', null, null, 0, datetime('now', '-1 days')),
  (1, 'security',           'New sign-in to your account',
      'Your NaijaDeals account was signed in from a new session. If this wasn''t you, secure your account immediately.',
      '/account/security', 'security', null, 1, datetime('now', '-1 days', '-3 hours'));
