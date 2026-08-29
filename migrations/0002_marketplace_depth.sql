-- NaijaDeals — Marketplace Depth Migration
-- Restructures catalog around a real marketplace model:
--   products      = canonical catalog entry (title/description/specs/images), NOT tied to one seller
--   product_listings = one row per (product, vendor) OFFER — this is what "seller comparison" reads from
--   product_variants  = color/size options that belong to a specific seller's listing (their own stock)
-- Cart/order items now reference a LISTING (the specific seller's offer), matching how Amazon/Jumia's
-- "buy box" actually works: you don't buy "a product", you buy one seller's stock of it.
-- No real user data exists yet at this point in the project — this migration recreates the affected
-- tables outright rather than doing brittle ALTER-based surgery.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS products;

-- ============ BRANDS ============

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  logo_url TEXT,
  is_nigerian INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT ''
);

-- ============ CATEGORIES: add subcategory support ============

ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- ============ VENDORS: add seller-comparison + Nigerian marketplace fields ============

ALTER TABLE vendors ADD COLUMN positive_feedback_percent REAL NOT NULL DEFAULT 95;
ALTER TABLE vendors ADD COLUMN state TEXT NOT NULL DEFAULT 'Lagos';
ALTER TABLE vendors ADD COLUMN response_time_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE vendors ADD COLUMN joined_year INTEGER NOT NULL DEFAULT 2021;
ALTER TABLE vendors ADD COLUMN banner_url TEXT;

-- ============ PRODUCTS (canonical catalog entry — NOT seller-specific) ============

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  brand_id INTEGER REFERENCES brands(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  long_description TEXT NOT NULL DEFAULT '',
  specs_json TEXT NOT NULL DEFAULT '{}',      -- {"Screen Size":"6.6 inch","RAM":"8GB",...}
  whats_included_json TEXT NOT NULL DEFAULT '[]', -- ["1x Handset","1x Charger",...]
  image_url TEXT NOT NULL,                     -- primary image
  gallery_json TEXT NOT NULL DEFAULT '[]',     -- ["/ph.svg?...","/ph.svg?...",...]
  rating_avg REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  sales_count INTEGER NOT NULL DEFAULT 0,
  is_flash_deal INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  return_policy TEXT NOT NULL DEFAULT '7-day return if the item arrives damaged or not as described.',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_flash ON products(is_flash_deal);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_sales ON products(sales_count);

-- ============ PRODUCT LISTINGS (one row per seller's offer on a product — the "buy box") ============

CREATE TABLE IF NOT EXISTS product_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  price_kobo INTEGER NOT NULL,
  compare_at_price_kobo INTEGER,               -- NULL = no discount
  stock INTEGER NOT NULL DEFAULT 0,
  condition TEXT NOT NULL DEFAULT 'new',        -- new | used | refurbished
  delivery_days_min INTEGER NOT NULL DEFAULT 1,
  delivery_days_max INTEGER NOT NULL DEFAULT 3,
  warranty_months INTEGER NOT NULL DEFAULT 0,
  is_plus INTEGER NOT NULL DEFAULT 0,           -- NaijaDeals Plus fast/free delivery eligible
  is_primary INTEGER NOT NULL DEFAULT 0,        -- the "buy box winner" shown by default on cards/PDP
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_product ON product_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_listings_vendor ON product_listings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_listings_primary ON product_listings(product_id, is_primary);

-- ============ PRODUCT VARIANTS (color/size — belong to one seller's listing & stock) ============

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES product_listings(id) ON DELETE CASCADE,
  variant_type TEXT NOT NULL,      -- 'color' | 'size'
  variant_value TEXT NOT NULL,     -- 'Midnight Black' | '128GB'
  price_delta_kobo INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_variants_listing ON product_variants(listing_id);

-- ============ REVIEWS (about the canonical product, like Amazon — not seller-specific) ============

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  has_photo INTEGER NOT NULL DEFAULT 0,
  photo_url TEXT,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  is_verified_purchase INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

-- ============ PRODUCT Q&A ============

CREATE TABLE IF NOT EXISTS product_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  author_name TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  answered_by TEXT,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_questions_product ON product_questions(product_id);

-- ============ CART ITEMS (reference a LISTING — a specific seller's offer — not a bare product) ============

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES product_listings(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  is_saved_for_later INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(cart_id, listing_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

-- ============ ORDER ITEMS (snapshot pricing + seller at time of purchase) ============

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES product_listings(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  variant_snapshot TEXT,
  title_snapshot TEXT NOT NULL,
  image_snapshot TEXT NOT NULL,
  unit_price_kobo INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  line_total_kobo INTEGER NOT NULL,
  item_status TEXT NOT NULL DEFAULT 'processing' -- processing|shipped|delivered|cancelled|returned (per-seller sub-status)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_vendor ON order_items(vendor_id);

-- ============ WISHLIST ============

CREATE TABLE IF NOT EXISTS wishlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlists_user ON wishlists(user_id);

-- ============ COUPONS / PROMOTIONS ============

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  discount_type TEXT NOT NULL,           -- percent | fixed
  discount_value INTEGER NOT NULL,       -- percent 0-100, or kobo amount if fixed
  min_order_kobo INTEGER NOT NULL DEFAULT 0,
  max_discount_kobo INTEGER,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ SAVED PAYMENT METHODS (Tier 2 — Paystack authorization is mocked until live keys exist) ============

CREATE TABLE IF NOT EXISTS saved_payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,             -- card | bank_transfer
  label TEXT NOT NULL,            -- "Mastercard **** 4081"
  provider_ref TEXT,              -- paystack authorization_code (real once keys configured)
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON saved_payment_methods(user_id);

-- ============ HOMEPAGE FEED CACHE (avoids N-query fan-out on every homepage request) ============

CREATE TABLE IF NOT EXISTS homepage_feed_cache (
  section_key TEXT PRIMARY KEY,     -- 'flash_deals' | 'best_sellers' | 'new_arrivals' | 'trending' | 'recommended' | ...
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

PRAGMA foreign_keys = ON;
