-- Migration 0032: Naijaeats Foundation
--
-- RECONSTRUCTED MIGRATION (not original production source code).
--
-- Provenance: This file was generated from PRODUCTION's live D1 schema,
-- captured read-only via `gsk hosted d1_schema` against naijadeals.com's
-- hosted database (project 393ef41c-f7b9-4ded-996a-2f5265e3280d, db uuid
-- bbbd12bf-e8cd-4e14-8413-76ed8b96ed1e) on 2026-09-12. Production's own
-- git_sha (99b1664df552ce1cd707330e17207d8869f12a4e) and its ORIGINAL
-- migrations/0013-0036 source files were never recovered (see
-- docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md). This file reproduces
-- the FINAL OBSERVED table structure (columns, types, defaults, foreign
-- keys, indexes) for the tables production's own /api/version reports as
-- belonging to migration "0032_naijaeats_foundation.sql", as closely as a final-state
-- schema dump allows.
--
-- Table-to-migration-number attribution beyond what /api/version's own
-- filenames imply is INFERRED (semantic grouping by subject area and
-- foreign-key dependency order), not independently confirmed against a
-- migration-by-migration production history (which does not exist to
-- inspect -- D1 does not retain per-migration column-level diffs, only
-- the current CREATE TABLE state). See
-- docs/NAIJADEALS-PRODUCTION-SCHEMA-MAP.md for the full mapping rationale
-- and confidence notes per table.
--
-- NOTE: Column sets shown are the FINAL observed state (may include columns 
-- actually added later by 0033_naijaeats_imagery — see that file's note). 
--

-- DO NOT apply this migration to production. Local/dev D1 only, per the
-- explicit read-only production-safety rule for this reconstruction phase.

CREATE TABLE IF NOT EXISTS cuisines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  region       TEXT NOT NULL,   
  description  TEXT NOT NULL DEFAULT '',
  icon         TEXT,            
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
, image_url TEXT);

CREATE INDEX IF NOT EXISTS idx_cuisines_region ON cuisines(region);

CREATE TABLE IF NOT EXISTS dishes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  cuisine_id   INTEGER NOT NULL REFERENCES cuisines(id),
  description  TEXT NOT NULL DEFAULT '',
  image_url    TEXT,            
  is_vegetarian INTEGER NOT NULL DEFAULT 0,
  is_spicy     INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dishes_cuisine ON dishes(cuisine_id);

CREATE TABLE IF NOT EXISTS restaurants (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                     TEXT NOT NULL UNIQUE,
  owner_provider_profile_id INTEGER NOT NULL REFERENCES provider_profiles(id),
  name                     TEXT NOT NULL,
  description              TEXT NOT NULL DEFAULT '',
  cuisine_id               INTEGER NOT NULL REFERENCES cuisines(id),   
  country_iso              TEXT NOT NULL,     
  city                     TEXT NOT NULL,
  address_line1            TEXT,
  logo_url                 TEXT,
  cover_image_url          TEXT,
  opening_time             TEXT,              
  closing_time             TEXT,
  delivery_fee_kobo        INTEGER NOT NULL DEFAULT 0,
  min_order_kobo           INTEGER NOT NULL DEFAULT 0,
  avg_prep_minutes         INTEGER NOT NULL DEFAULT 30,
  delivery_zone_note       TEXT,              
  is_active                INTEGER NOT NULL DEFAULT 1,   
  verification_status      TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  rating_avg               REAL NOT NULL DEFAULT 0,   
  rating_count              INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_restaurants_active ON restaurants(is_active);
CREATE INDEX IF NOT EXISTS idx_restaurants_country ON restaurants(country_iso);
CREATE INDEX IF NOT EXISTS idx_restaurants_cuisine ON restaurants(cuisine_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_owner ON restaurants(owner_provider_profile_id);

CREATE TABLE IF NOT EXISTS restaurant_status_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id),
  status_type    TEXT NOT NULL CHECK (status_type IN ('verification', 'active')),
  status         TEXT NOT NULL,
  actor_user_id  INTEGER REFERENCES users(id),
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_restaurant_status_events_restaurant ON restaurant_status_events(restaurant_id, id);

CREATE TABLE IF NOT EXISTS menus (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Main Menu',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_menus_restaurant ON menus(restaurant_id);

CREATE TABLE IF NOT EXISTS menu_sections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id     INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,     
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_menu_sections_menu ON menu_sections(menu_id, sort_order);

CREATE TABLE IF NOT EXISTS menu_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_section_id   INTEGER NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
  restaurant_id     INTEGER NOT NULL REFERENCES restaurants(id),   
  dish_id           INTEGER REFERENCES dishes(id),   
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  image_url         TEXT,
  base_price_kobo   INTEGER NOT NULL CHECK (base_price_kobo > 0),
  is_available      INTEGER NOT NULL DEFAULT 1,    
  is_vegetarian     INTEGER NOT NULL DEFAULT 0,
  is_spicy          INTEGER NOT NULL DEFAULT 0,
  prep_minutes      INTEGER,          
  sort_order        INTEGER NOT NULL DEFAULT 100,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(is_available);
CREATE INDEX IF NOT EXISTS idx_menu_items_dish ON menu_items(dish_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_section ON menu_items(menu_section_id, sort_order);

CREATE TABLE IF NOT EXISTS menu_item_option_groups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id   INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,     
  is_required    INTEGER NOT NULL DEFAULT 0,
  min_select     INTEGER NOT NULL DEFAULT 0,
  max_select     INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 100,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_menu_item_option_groups_item ON menu_item_option_groups(menu_item_id, sort_order);

CREATE TABLE IF NOT EXISTS menu_item_options (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  option_group_id  INTEGER NOT NULL REFERENCES menu_item_option_groups(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  price_delta_kobo INTEGER NOT NULL DEFAULT 0,   
  is_available     INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 100,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_menu_item_options_group ON menu_item_options(option_group_id, sort_order);

CREATE TABLE IF NOT EXISTS eats_carts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_token  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eats_carts_guest ON eats_carts(guest_token);
CREATE INDEX IF NOT EXISTS idx_eats_carts_user ON eats_carts(user_id);

CREATE TABLE IF NOT EXISTS eats_cart_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id         INTEGER NOT NULL REFERENCES eats_carts(id) ON DELETE CASCADE,
  menu_item_id    INTEGER NOT NULL REFERENCES menu_items(id),
  restaurant_id   INTEGER NOT NULL REFERENCES restaurants(id),   
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  selected_options_json TEXT NOT NULL DEFAULT '[]',  
  special_instructions TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eats_cart_items_cart ON eats_cart_items(cart_id);

CREATE TABLE IF NOT EXISTS eats_orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number        TEXT NOT NULL UNIQUE,
  customer_user_id    INTEGER NOT NULL REFERENCES users(id),
  restaurant_id       INTEGER NOT NULL REFERENCES restaurants(id),
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
                        'new', 'accepted', 'preparing', 'ready', 'handoff', 'completed', 'cancelled', 'declined'
                      )),
  payment_status      TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'escrow_held', 'released', 'refunded')),   
  payment_provider    TEXT,       
  payment_reference   TEXT,
  subtotal_kobo       INTEGER NOT NULL,
  delivery_fee_kobo   INTEGER NOT NULL DEFAULT 0,
  total_kobo          INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'NGN',
  shipping_name       TEXT NOT NULL,
  shipping_phone      TEXT NOT NULL,
  shipping_address    TEXT NOT NULL,
  shipping_city       TEXT NOT NULL,
  shipping_state      TEXT NOT NULL,
  special_instructions TEXT,
  cancelled_reason    TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eats_orders_customer ON eats_orders(customer_user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_eats_orders_number_unique ON eats_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_eats_orders_restaurant ON eats_orders(restaurant_id, id);
CREATE INDEX IF NOT EXISTS idx_eats_orders_status ON eats_orders(status);

CREATE TABLE IF NOT EXISTS eats_order_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES eats_orders(id) ON DELETE CASCADE,
  menu_item_id      INTEGER NOT NULL REFERENCES menu_items(id),
  name_snapshot     TEXT NOT NULL,
  image_snapshot    TEXT,
  unit_price_kobo   INTEGER NOT NULL,   
  quantity          INTEGER NOT NULL,
  line_total_kobo   INTEGER NOT NULL,
  special_instructions TEXT
);

CREATE INDEX IF NOT EXISTS idx_eats_order_items_order ON eats_order_items(order_id);

CREATE TABLE IF NOT EXISTS eats_order_item_options (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id     INTEGER NOT NULL REFERENCES eats_order_items(id) ON DELETE CASCADE,
  option_name_snapshot TEXT NOT NULL,
  price_delta_kobo_snapshot INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_eats_order_item_options_item ON eats_order_item_options(order_item_id);

CREATE TABLE IF NOT EXISTS eats_order_status_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES eats_orders(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eats_order_status_events_order ON eats_order_status_events(order_id, id);

