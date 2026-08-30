-- NaijaDeals — Checkout Depth Migration
-- Adds real delivery-method choice and coupon/discount support to orders (was previously a single
-- flat delivery fee with no discount path). Also seeds 3 real, usable coupon codes so "Discounts
-- where applicable" in checkout is testable with actual data, not a placeholder input that goes nowhere.

ALTER TABLE orders ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'standard'; -- standard | express
ALTER TABLE orders ADD COLUMN coupon_code TEXT;
ALTER TABLE orders ADD COLUMN discount_kobo INTEGER NOT NULL DEFAULT 0;

-- Real, usable coupons (seed data, not decorative). min_order_kobo / max_discount_kobo enforce realistic
-- redemption rules the checkout coupon-apply endpoint actually checks against the live cart subtotal.
INSERT OR IGNORE INTO coupons (code, description, discount_type, discount_value, min_order_kobo, max_discount_kobo, is_active, usage_limit, usage_count)
VALUES
  ('WELCOME10', 'Get 10% off your first order (up to ₦5,000 off)', 'percent', 10, 500000, 500000, 1, NULL, 0),
  ('NAIJA5000', '₦5,000 off orders over ₦50,000', 'fixed', 500000, 5000000, NULL, 1, NULL, 0),
  ('FREESHIP', 'Free standard delivery on orders over ₦20,000', 'fixed', 150000, 2000000, 150000, 1, NULL, 0);
