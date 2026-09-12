-- Migration 0042: Logistics Engine 2.0
--
-- ENGINE 5 spec (universal delivery/dispatch/driver/route/tracking/fulfillment
-- foundation). MANDATORY INSPECTION PERFORMED FIRST (documented in the Engine 5
-- final report) found a substantial, already-reconstructed-from-production
-- logistics foundation sitting completely unwired to application code:
--
--   0015 logistics_providers, vehicle_types, vehicles
--   0016 driver_profiles, driver_documents, driver_vehicle_assignments
--   0019 shipment_rate_cards, shipments, shipment_addresses, shipment_items,
--        shipment_status_events
--   0020 delivery_jobs, pickup_jobs (+ vendors.pickup_address_line1)
--   0026 gps_events
--   0035 vehicle_documents, vehicle_photos
--
-- All 13 tables verified 0 rows locally before writing this migration (see
-- Engine 5 inspection). organization_permissions (migration 0037) ALREADY
-- seeded drivers.read/manage, vehicles.read/manage, shipments.read/manage —
-- further evidence this engine was anticipated, never built. This migration
-- EXTENDS those 13 tables (widened CHECKs, new columns) and adds ONLY the
-- structures nothing existing covers: delivery_attempts (per-attempt history
-- — section 37 explicitly forbids overwriting a single failure_reason
-- column), delivery_zones (configurable zones, section 31), logistics_quotes
-- (reproducible quote lifecycle, section 29), delivery_routes (abstraction
-- only, section 22 explicitly forbids premature route optimization),
-- delivery_proofs (OTP/signature/photo, sections 33-35).
--
-- reviews (174 rows) gets its reviewable_type CHECK widened via the same
-- CREATE-rebuild -> INSERT SELECT -> DROP -> RENAME pattern used in migration
-- 0027, this time carrying real data forward (not a 0-row rebuild).

-- ============================================================
-- 1. SHIPMENTS — widen shipment_type/speed_tier/status/source_type,
--    add fulfillment/package/SLA columns. 0 rows — safe rebuild.
-- ============================================================

CREATE TABLE shipments__rebuild_0042 (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_number        TEXT NOT NULL UNIQUE,
  shipment_type          TEXT NOT NULL CHECK (shipment_type IN ('marketplace_order', 'standalone', 'return')),
  fulfillment_category   TEXT NOT NULL DEFAULT 'parcel' CHECK (fulfillment_category IN (
                           'product', 'food', 'grocery', 'medical', 'document', 'parcel',
                           'bulk', 'business', 'service_item', 'auto_part', 'other'
                         )),
  customer_user_id       INTEGER NOT NULL REFERENCES users(id),
  order_id               INTEGER REFERENCES orders(id),
  vendor_id              INTEGER REFERENCES vendors(id),
  rate_card_id           INTEGER REFERENCES shipment_rate_cards(id),
  logistics_quote_id     INTEGER,   -- REFERENCES logistics_quotes(id), added below (table created after this one)
  vehicle_type_id        INTEGER NOT NULL REFERENCES vehicle_types(id),
  speed_tier             TEXT NOT NULL CHECK (speed_tier IN (
                           'standard', 'express', 'same_day', 'scheduled', 'priority', 'instant',
                           'economy', 'intercity', 'bulk', 'freight', 'cold_chain', 'document', 'special_handling'
                         )),
  origin_country_iso     TEXT NOT NULL,
  destination_country_iso TEXT NOT NULL,
  origin_zone_key         TEXT,     -- FREE-TEXT match against delivery_zones.key (section 31: configurable, not hardcoded)
  destination_zone_key    TEXT,
  declared_weight_kg     REAL NOT NULL DEFAULT 1,
  declared_length_cm     REAL,
  declared_width_cm      REAL,
  declared_height_cm     REAL,
  package_count          INTEGER NOT NULL DEFAULT 1,
  declared_value_kobo    INTEGER,
  is_fragile              INTEGER NOT NULL DEFAULT 0,
  is_temperature_sensitive INTEGER NOT NULL DEFAULT 0,
  is_hazardous            INTEGER NOT NULL DEFAULT 0,
  special_handling_notes TEXT,
  parcel_description     TEXT,
  related_shipment_id    INTEGER REFERENCES shipments(id),  -- self-ref: a 'return' shipment points back at the original delivery
  quoted_price_kobo      INTEGER NOT NULL,
  currency               TEXT NOT NULL DEFAULT 'NGN',
  payment_status         TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  status                 TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
                           'created', 'awaiting_pickup', 'booked', 'assigned', 'pickup_assigned',
                           'driver_en_route_to_pickup', 'arrived_pickup', 'picked_up', 'in_transit',
                           'near_destination', 'out_for_delivery', 'arrived_dropoff', 'delivery_attempted',
                           'delivered', 'failed_delivery', 'failed', 'returned', 'cancelled', 'lost', 'damaged'
                         )),
  cancelled_reason       TEXT,
  pickup_window_start    TEXT,
  pickup_window_end      TEXT,
  delivery_window_start  TEXT,
  delivery_window_end    TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  source_type            TEXT CHECK (source_type IN ('naijashop', 'naijafresh', 'naijaeats', 'naijafarm', 'naijaauto', 'naijahealth', 'naijasend')),
  selected_vehicle_id    INTEGER REFERENCES vehicles(id)
);

INSERT INTO shipments__rebuild_0042
  (id, tracking_number, shipment_type, customer_user_id, order_id, vendor_id, rate_card_id, vehicle_type_id,
   speed_tier, origin_country_iso, destination_country_iso, declared_weight_kg, parcel_description,
   quoted_price_kobo, currency, payment_status, status, cancelled_reason, created_at, updated_at, source_type, selected_vehicle_id)
  SELECT id, tracking_number, shipment_type, customer_user_id, order_id, vendor_id, rate_card_id, vehicle_type_id,
         speed_tier, origin_country_iso, destination_country_iso, declared_weight_kg, parcel_description,
         quoted_price_kobo, currency, payment_status, status, cancelled_reason, created_at, updated_at, source_type, selected_vehicle_id
  FROM shipments;

DROP TABLE shipments;
ALTER TABLE shipments__rebuild_0042 RENAME TO shipments;

CREATE INDEX IF NOT EXISTS idx_shipments_customer ON shipments(customer_user_id, id);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_order_vendor_unique
  ON shipments(order_id, vendor_id)
  WHERE shipment_type = 'marketplace_order';
CREATE INDEX IF NOT EXISTS idx_shipments_selected_vehicle ON shipments(selected_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_shipments_source_type ON shipments(source_type);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_tracking_unique ON shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipments_vendor ON shipments(vendor_id, id);
CREATE INDEX IF NOT EXISTS idx_shipments_related ON shipments(related_shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipments_quote ON shipments(logistics_quote_id);

-- ============================================================
-- 2. SHIPMENT_STATUS_EVENTS — add actor_role + location (section 10, 25)
-- ============================================================

ALTER TABLE shipment_status_events ADD COLUMN actor_role TEXT NOT NULL DEFAULT 'system' CHECK (actor_role IN ('customer', 'driver', 'merchant', 'fleet', 'provider', 'admin', 'system'));
ALTER TABLE shipment_status_events ADD COLUMN latitude REAL;
ALTER TABLE shipment_status_events ADD COLUMN longitude REAL;

-- ============================================================
-- 3. DELIVERY_JOBS / PICKUP_JOBS — widen status, add vehicle/timing/OTP/
--    proof columns (sections 6, 33, 34, 58). 0 rows — safe rebuild.
-- ============================================================

CREATE TABLE delivery_jobs__rebuild_0042 (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id            INTEGER NOT NULL REFERENCES shipments(id),
  provider_id            INTEGER REFERENCES logistics_providers(id),
  driver_id              INTEGER REFERENCES driver_profiles(id),
  vehicle_id             INTEGER REFERENCES vehicles(id),
  status                 TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN (
                           'unassigned', 'assigned', 'accepted', 'en_route', 'arrived',
                           'attempted', 'completed', 'failed', 'cancelled'
                         )),
  scheduled_window_start TEXT,
  scheduled_window_end   TEXT,
  assigned_at            TEXT,
  accepted_at            TEXT,
  en_route_at            TEXT,
  arrived_at             TEXT,
  completed_at           TEXT,
  failure_reason         TEXT,
  attempt_count          INTEGER NOT NULL DEFAULT 0,
  proof_type             TEXT CHECK (proof_type IS NULL OR proof_type IN ('otp', 'signature', 'photo', 'qr', 'none')),
  otp_code_hash          TEXT,
  otp_expires_at         TEXT,
  otp_verified_at        TEXT,
  completion_latitude    REAL,
  completion_longitude   REAL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO delivery_jobs__rebuild_0042
  (id, shipment_id, provider_id, driver_id, status, scheduled_window_start, scheduled_window_end, completed_at, failure_reason, created_at, updated_at)
  SELECT id, shipment_id, provider_id, driver_id, status, scheduled_window_start, scheduled_window_end, completed_at, failure_reason, created_at, updated_at
  FROM delivery_jobs;

DROP TABLE delivery_jobs;
ALTER TABLE delivery_jobs__rebuild_0042 RENAME TO delivery_jobs;

CREATE INDEX IF NOT EXISTS idx_delivery_jobs_driver ON delivery_jobs(driver_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_jobs_shipment_unique ON delivery_jobs(shipment_id);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_status ON delivery_jobs(status);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_vehicle ON delivery_jobs(vehicle_id);

CREATE TABLE pickup_jobs__rebuild_0042 (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id            INTEGER NOT NULL REFERENCES shipments(id),
  provider_id            INTEGER REFERENCES logistics_providers(id),
  driver_id              INTEGER REFERENCES driver_profiles(id),
  vehicle_id             INTEGER REFERENCES vehicles(id),
  status                 TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN (
                           'unassigned', 'assigned', 'accepted', 'en_route', 'arrived',
                           'attempted', 'completed', 'failed', 'cancelled'
                         )),
  scheduled_window_start TEXT,
  scheduled_window_end   TEXT,
  assigned_at            TEXT,
  accepted_at            TEXT,
  en_route_at            TEXT,
  arrived_at             TEXT,
  completed_at           TEXT,
  failure_reason         TEXT,
  attempt_count          INTEGER NOT NULL DEFAULT 0,
  proof_type             TEXT CHECK (proof_type IS NULL OR proof_type IN ('otp', 'signature', 'photo', 'qr', 'none')),
  otp_code_hash          TEXT,
  otp_expires_at         TEXT,
  otp_verified_at        TEXT,
  completion_latitude    REAL,
  completion_longitude   REAL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO pickup_jobs__rebuild_0042
  (id, shipment_id, provider_id, driver_id, status, scheduled_window_start, scheduled_window_end, completed_at, failure_reason, created_at, updated_at)
  SELECT id, shipment_id, provider_id, driver_id, status, scheduled_window_start, scheduled_window_end, completed_at, failure_reason, created_at, updated_at
  FROM pickup_jobs;

DROP TABLE pickup_jobs;
ALTER TABLE pickup_jobs__rebuild_0042 RENAME TO pickup_jobs;

CREATE INDEX IF NOT EXISTS idx_pickup_jobs_driver ON pickup_jobs(driver_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_jobs_shipment_unique ON pickup_jobs(shipment_id);
CREATE INDEX IF NOT EXISTS idx_pickup_jobs_status ON pickup_jobs(status);
CREATE INDEX IF NOT EXISTS idx_pickup_jobs_vehicle ON pickup_jobs(vehicle_id);

-- ============================================================
-- 4. DELIVERY_ATTEMPTS — real per-attempt history (section 37: "Track each
--    attempt independently. Do not overwrite previous attempts." — the
--    single failure_reason column above is a CURRENT-STATE convenience
--    field; this table is the append-only source of truth for attempt
--    history across BOTH pickup_jobs and delivery_jobs).
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type       TEXT NOT NULL CHECK (job_type IN ('pickup', 'delivery')),
  job_id         INTEGER NOT NULL,   -- polymorphic against pickup_jobs.id or delivery_jobs.id per job_type
  attempt_number INTEGER NOT NULL,
  outcome        TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  reason         TEXT,   -- recipient_unavailable | wrong_address | access_issue | customer_cancelled | damaged_package | driver_issue | vehicle_failure | weather_disruption | service_unavailable | other
  actor_user_id  INTEGER REFERENCES users(id),
  actor_role     TEXT NOT NULL DEFAULT 'driver' CHECK (actor_role IN ('driver', 'system', 'admin')),
  notes          TEXT,
  latitude       REAL,
  longitude      REAL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_attempts_job_unique ON delivery_attempts(job_type, job_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_job ON delivery_attempts(job_type, job_id);

-- ============================================================
-- 5. DELIVERY_ZONES — configurable geographic zones (section 31: "Do not
--    hard-code zones into application code"). shipment_rate_cards.origin_zone
--    remains free TEXT (0 rows, no FK needed) but is validated at the
--    application layer against this table's `key` column going forward.
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_zones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  country_iso  TEXT NOT NULL,
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  city         TEXT,
  region       TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_zones_country_key_unique ON delivery_zones(country_iso, key);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_country ON delivery_zones(country_iso, is_active);

INSERT INTO delivery_zones (country_iso, key, name, city, region) VALUES
  ('NG', 'lagos_island', 'Lagos Island', 'Lagos', 'South West'),
  ('NG', 'lagos_mainland', 'Lagos Mainland', 'Lagos', 'South West'),
  ('NG', 'abuja', 'Abuja (FCT)', 'Abuja', 'North Central'),
  ('NG', 'port_harcourt', 'Port Harcourt', 'Port Harcourt', 'South South'),
  ('GH', 'accra', 'Accra', 'Accra', 'Greater Accra'),
  ('GH', 'kumasi', 'Kumasi', 'Kumasi', 'Ashanti');

-- ============================================================
-- 6. LOGISTICS_QUOTES — reproducible quote lifecycle (section 29).
--    Nothing existing covers a QUOTE INSTANCE (shipment_rate_cards is a
--    price catalog, not a quote). New, additive, justified.
-- ============================================================

CREATE TABLE IF NOT EXISTS logistics_quotes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number         TEXT NOT NULL UNIQUE,
  customer_user_id     INTEGER REFERENCES users(id),
  origin_zone_key      TEXT,
  destination_zone_key TEXT,
  origin_country_iso   TEXT NOT NULL,
  destination_country_iso TEXT NOT NULL,
  vehicle_type_id      INTEGER REFERENCES vehicle_types(id),
  speed_tier           TEXT NOT NULL,
  declared_weight_kg   REAL NOT NULL DEFAULT 1,
  package_count        INTEGER NOT NULL DEFAULT 1,
  base_fee_kobo        INTEGER NOT NULL DEFAULT 0,
  distance_fee_kobo    INTEGER NOT NULL DEFAULT 0,
  weight_fee_kobo      INTEGER NOT NULL DEFAULT 0,
  service_fee_kobo     INTEGER NOT NULL DEFAULT 0,
  surcharge_kobo       INTEGER NOT NULL DEFAULT 0,
  discount_kobo        INTEGER NOT NULL DEFAULT 0,
  tax_kobo             INTEGER NOT NULL DEFAULT 0,
  total_kobo           INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'NGN',
  status               TEXT NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted', 'accepted', 'expired', 'converted')),
  rate_card_id         INTEGER REFERENCES shipment_rate_cards(id),
  converted_shipment_id INTEGER REFERENCES shipments(id),
  expires_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logistics_quotes_customer ON logistics_quotes(customer_user_id, id);
CREATE INDEX IF NOT EXISTS idx_logistics_quotes_status ON logistics_quotes(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_logistics_quotes_number_unique ON logistics_quotes(quote_number);

-- ============================================================
-- 7. DELIVERY_ROUTES — abstraction only, no optimization engine
--    (section 22 explicitly: "Do not implement an expensive
--    route-optimization platform prematurely. Build the abstraction first.")
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_routes (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type               TEXT NOT NULL CHECK (job_type IN ('pickup', 'delivery')),
  job_id                 INTEGER NOT NULL,
  origin_latitude        REAL,
  origin_longitude       REAL,
  destination_latitude   REAL,
  destination_longitude  REAL,
  waypoints_json         TEXT NOT NULL DEFAULT '[]',
  distance_km            REAL,
  estimated_duration_min INTEGER,
  actual_duration_min    INTEGER,
  status                 TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  started_at             TEXT,
  completed_at           TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_routes_job_unique ON delivery_routes(job_type, job_id);

-- ============================================================
-- 8. DRIVER_PROFILES — add rating + cheap denormalized last-known-position
--    (distinct from the full gps_events history — section 18's matching
--    layer needs a fast "where is this driver right now" without scanning
--    gps_events). Also identity_organization_id, mirroring the EXISTING
--    provider_profiles.identity_organization_id bridge pattern (migration
--    0039) for fleet-employed drivers.
-- ============================================================

ALTER TABLE driver_profiles ADD COLUMN identity_organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE driver_profiles ADD COLUMN rating_avg REAL NOT NULL DEFAULT 0;
ALTER TABLE driver_profiles ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE driver_profiles ADD COLUMN current_latitude REAL;
ALTER TABLE driver_profiles ADD COLUMN current_longitude REAL;
ALTER TABLE driver_profiles ADD COLUMN location_updated_at TEXT;
ALTER TABLE driver_profiles ADD COLUMN operational_status TEXT NOT NULL DEFAULT 'offline' CHECK (operational_status IN ('offline', 'available', 'assigned', 'en_route', 'busy', 'on_break', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_driver_profiles_identity_org ON driver_profiles(identity_organization_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_operational_status ON driver_profiles(operational_status);

-- ============================================================
-- 9. LOGISTICS_PROVIDERS — bridge to Organization Engine (section 15/48:
--    "A fleet can manage drivers/vehicles/... Use Organization Engine.")
-- ============================================================

ALTER TABLE logistics_providers ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE logistics_providers ADD COLUMN rating_avg REAL NOT NULL DEFAULT 0;
ALTER TABLE logistics_providers ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_logistics_providers_organization ON logistics_providers(organization_id);

-- ============================================================
-- 10. REVIEWS — widen reviewable_type to add 'driver'/'logistics_provider'
--     (section 53). 174 EXISTING ROWS — real data, carried forward exactly.
-- ============================================================

CREATE TABLE reviews__rebuild_0042 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id),
  user_id INTEGER REFERENCES users(id),
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  comment TEXT,
  has_photo INTEGER NOT NULL DEFAULT 0,
  photo_url TEXT,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  is_verified_purchase INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  avatar_url TEXT,
  reviewable_type TEXT NOT NULL DEFAULT 'product' CHECK (reviewable_type IN ('product', 'provider_profile', 'restaurant', 'stay', 'driver', 'logistics_provider')),
  reviewable_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  moderated_by_user_id INTEGER REFERENCES users(id),
  moderated_at TEXT
);
INSERT INTO reviews__rebuild_0042 SELECT id, product_id, user_id, author_name, rating, title, comment, has_photo, photo_url, helpful_count, is_verified_purchase, created_at, avatar_url, reviewable_type, reviewable_id, status, updated_at, moderated_by_user_id, moderated_at FROM reviews;
DROP TABLE reviews;
ALTER TABLE reviews__rebuild_0042 RENAME TO reviews;

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewable ON reviews(reviewable_type, reviewable_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_per_user_per_entity
  ON reviews(user_id, reviewable_type, reviewable_id)
  WHERE user_id IS NOT NULL;

-- ============================================================
-- 11. VEHICLE_TYPES — seed the reference catalog (was EMPTY — 0 rows —
--     despite the table existing since migration 0015; section 14).
-- ============================================================

INSERT INTO vehicle_types (key, label_key, icon, display_order, transport_mode) VALUES
  ('bicycle',     'vehicle_type.bicycle',     'bicycle',    10, 'road'),
  ('motorcycle',  'vehicle_type.motorcycle',  'motorcycle', 20, 'road'),
  ('tricycle',    'vehicle_type.tricycle',    'tricycle',   30, 'road'),
  ('car',         'vehicle_type.car',         'car',        40, 'road'),
  ('van',         'vehicle_type.van',         'van',        50, 'road'),
  ('pickup',      'vehicle_type.pickup',      'truck-pickup', 60, 'road'),
  ('truck',       'vehicle_type.truck',       'truck',      70, 'road'),
  ('refrigerated_truck', 'vehicle_type.refrigerated_truck', 'truck-fast', 80, 'road'),
  ('boat',        'vehicle_type.boat',        'ship',       90, 'water');

-- ============================================================
-- 12. GPS_EVENTS — already matches spec section 25 exactly; no schema
--     change needed. Retention handled at the application layer (lazy
--     compaction, no cron available on hosted deploy — same documented
--     limitation as Booking Engine's expireHoldsIfNeeded pattern).
-- ============================================================
-- (intentionally no DDL — reused as-is)
