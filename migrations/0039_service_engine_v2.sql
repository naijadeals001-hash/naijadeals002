-- Migration 0039: Service Engine 2.0 — Universal Services, Providers,
-- Requests, Quotes, Booking & Service Orders Foundation
--
-- NEW APPLICATION FEATURE, built on top of EXISTING infrastructure that was
-- already reconstructed into this database but had ZERO application code
-- and ZERO rows using it (confirmed during inspection):
--   - provider_profiles / provider_organizations (migration 0025)
--   - bookable_listings / booking_availability_blocks / bookings /
--     booking_status_events (migration 0024)
--   - reviews.reviewable_type already includes 'provider_profile' (0027)
--   - organization_permissions already seeded 'services.manage' /
--     'services.read' / 'bookings.manage' / 'bookings.read' and granted
--     them to owner/admin/manager (manage) and staff (read) (0037)
-- This migration REUSES all of the above rather than duplicating them, per
-- the spec's explicit instruction to inspect first and never build a
-- second identity/booking system.
--
-- NON-NEGOTIABLE COMPATIBILITY RULES:
--   - Zero destructive changes. No existing table dropped/rebuilt.
--   - provider_profiles.provider_type CHECK constraint currently only
--     allows ('gig_provider','host','driver_operator','restaurant_operator').
--     SQLite cannot ALTER a CHECK constraint in place, so we do NOT attempt
--     to add a new allowed value to the existing constraint (that would
--     require a full table rebuild of a table with FK dependents
--     (stay_properties, restaurants-if-any) — out of scope/risk for this
--     checkpoint). Instead: 'gig_provider' is reused AS-IS for every
--     Service Engine provider (NaijaGigs/NaijaHome/NaijaBeauty-services/
--     NaijaAuto-services/NaijaHealth-services all register as
--     provider_type='gig_provider' with a NEW service_category_id
--     discriminator column added here to distinguish which vertical/
--     category the profile actually serves). This is the correct read of
--     the spec's own instruction ("only create new tables where the
--     existing schema cannot correctly represent service behavior") --
--     provider_profiles ALREADY correctly represents "a person/org that
--     provides a bookable service"; it does not need a new provider_type
--     enum value, only a categorization column.
--   - bookable_listings.listing_type CHECK constraint currently only
--     allows ('gig_service','stay_unit'). 'gig_service' is reused AS-IS as
--     the generic "this is a bookable service offer" marker for every
--     Service Engine listing — a new service_listings table (below) holds
--     all the service-specific richness (packages, pricing model, service
--     area, requirements) and links 1:1 to a bookable_listings row so the
--     EXISTING bookings/booking_status_events/availability infrastructure
--     works unmodified for every vertical.
--   - Every ALTER TABLE ADD COLUMN uses a CONSTANT literal default.
--   - Every new table is additive (CREATE TABLE IF NOT EXISTS).

-- ============================================================
-- 1. PROVIDER PROFILE: organization bridge + service categorization
-- ============================================================
-- organization_id already exists on provider_profiles (added by migration
-- 0025) for a DIFFERENT purpose (provider_organizations, a narrower
-- pre-Identity-Engine concept). We add a SEPARATE, additive bridge to the
-- Identity Engine's generic `organizations` table so a Service Engine
-- provider can be owned by a full multi-user organization (spec section 2:
-- "Provider identity should reference the Identity & Account Engine"),
-- without disturbing the existing provider_organizations column/FK.
ALTER TABLE provider_profiles ADD COLUMN identity_organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_identity_org ON provider_profiles(identity_organization_id);

-- Which service category this provider profile primarily serves (spec
-- section 4's hierarchical taxonomy, reusing the EXISTING categories
-- table rather than a parallel one — see section 2 below where we seed
-- service categories as ordinary `categories` rows with category_type).
ALTER TABLE provider_profiles ADD COLUMN primary_category_id INTEGER REFERENCES categories(id);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_primary_category ON provider_profiles(primary_category_id);

-- ============================================================
-- 2. CATEGORIES: reuse the SAME table for services (spec section 4/40)
-- ============================================================
-- Additive discriminator so product categories and service categories can
-- coexist in one hierarchical tree without ambiguity. Existing rows
-- default to 'product' (zero behavior change for the Marketplace Engine's
-- existing category queries, none of which filter on this column yet).
ALTER TABLE categories ADD COLUMN category_type TEXT NOT NULL DEFAULT 'product';
CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(category_type);

-- Seed the top-level service taxonomy named explicitly in spec section 4.
-- Subcategories use the EXISTING parent_id self-reference (already
-- supports arbitrary depth structurally).
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type) VALUES
  ('home-services', 'Home Services', 'home_repair_service', 100, 'service'),
  ('beauty-services', 'Beauty Services', 'content_cut', 101, 'service'),
  ('auto-services', 'Auto Services', 'car_repair', 102, 'service'),
  ('professional-services', 'Professional Services', 'work', 103, 'service'),
  ('health-services', 'Health Services', 'medical_services', 104, 'service');

INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'plumbing', 'Plumbing', 'plumbing', 1, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'electrical', 'Electrical', 'electrical_services', 2, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'home-cleaning', 'Cleaning', 'cleaning_services', 3, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'painting', 'Painting', 'format_paint', 4, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'home-repairs', 'Repairs', 'handyman', 5, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'carpentry', 'Carpentry', 'carpenter', 6, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'moving', 'Moving', 'local_shipping', 7, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'pest-control', 'Pest Control', 'pest_control', 8, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'security-services', 'Security', 'security', 9, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'landscaping', 'Landscaping', 'yard', 10, 'service', id FROM categories WHERE slug = 'home-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'appliance-repair', 'Appliance Repair', 'settings', 11, 'service', id FROM categories WHERE slug = 'home-services';

INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'hair-services', 'Hair', 'content_cut', 1, 'service', id FROM categories WHERE slug = 'beauty-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'makeup-services', 'Makeup', 'face', 2, 'service', id FROM categories WHERE slug = 'beauty-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'nail-services', 'Nails', 'back_hand', 3, 'service', id FROM categories WHERE slug = 'beauty-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'barbering', 'Barbering', 'content_cut', 4, 'service', id FROM categories WHERE slug = 'beauty-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'spa-massage', 'Spa & Massage', 'spa', 5, 'service', id FROM categories WHERE slug = 'beauty-services';

INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'mechanical-repair', 'Mechanical Repair', 'build', 1, 'service', id FROM categories WHERE slug = 'auto-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'diagnostics', 'Diagnostics', 'troubleshoot', 2, 'service', id FROM categories WHERE slug = 'auto-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'tire-service', 'Tire Service', 'tire_repair', 3, 'service', id FROM categories WHERE slug = 'auto-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'oil-change', 'Oil Change', 'oil_barrel', 4, 'service', id FROM categories WHERE slug = 'auto-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'body-work', 'Body Work', 'directions_car', 5, 'service', id FROM categories WHERE slug = 'auto-services';

INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'accounting', 'Accounting', 'calculate', 1, 'service', id FROM categories WHERE slug = 'professional-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'legal', 'Legal', 'gavel', 2, 'service', id FROM categories WHERE slug = 'professional-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'consulting', 'Consulting', 'business_center', 3, 'service', id FROM categories WHERE slug = 'professional-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'design-services', 'Design', 'palette', 4, 'service', id FROM categories WHERE slug = 'professional-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'development', 'Development', 'code', 5, 'service', id FROM categories WHERE slug = 'professional-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'tutoring', 'Tutoring', 'school', 6, 'service', id FROM categories WHERE slug = 'professional-services';

INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'health-consultation', 'Consultation', 'stethoscope', 1, 'service', id FROM categories WHERE slug = 'health-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'therapy', 'Therapy', 'psychology', 2, 'service', id FROM categories WHERE slug = 'health-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'nursing', 'Nursing', 'medical_information', 3, 'service', id FROM categories WHERE slug = 'health-services';
INSERT OR IGNORE INTO categories (slug, name, icon, sort_order, category_type, parent_id) SELECT 'home-care', 'Home Care', 'home_health', 4, 'service', id FROM categories WHERE slug = 'health-services';

-- ============================================================
-- 3. BOOKABLE_LISTINGS: additive columns for service-area/pricing linkage
-- ============================================================
-- category already exists as a free-text column (migration 0024's
-- reconstruction); service_listing_id below is the 1:1 link to the new
-- richer service_listings table so booking availability/booking rows
-- reuse this EXISTING table unmodified in shape, just enriched.
ALTER TABLE bookable_listings ADD COLUMN service_listing_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_bookable_listings_service_listing ON bookable_listings(service_listing_id);

-- ============================================================
-- 4. SERVICE LISTINGS (spec section 5) — the WHAT+WHO for services,
--    the service-side equivalent of product_listings
-- ============================================================
CREATE TABLE IF NOT EXISTS service_listings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_profile_id   INTEGER NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  bookable_listing_id   INTEGER REFERENCES bookable_listings(id),  -- linked once a bookable_listings row is created for scheduling
  category_id           INTEGER NOT NULL REFERENCES categories(id),
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  service_type          TEXT NOT NULL DEFAULT 'in_person',  -- at_provider_location | at_customer_location | online | mobile | remote | hybrid
  pricing_model         TEXT NOT NULL DEFAULT 'fixed',      -- fixed | starting_price | hourly | daily | per_visit | per_session | per_km | per_sqm | custom_quote | price_range | negotiable
  base_price_kobo       INTEGER,             -- NULL when pricing_model = 'custom_quote' or 'negotiable'
  max_price_kobo        INTEGER,             -- used for 'price_range'
  currency              TEXT NOT NULL DEFAULT 'NGN',
  duration_minutes      INTEGER,             -- typical/estimated duration, NULL if highly variable
  requirements_json     TEXT NOT NULL DEFAULT '[]',  -- dynamic requirement field definitions (spec section 18), never hard-coded columns
  media_json            TEXT NOT NULL DEFAULT '[]',
  terms                 TEXT NOT NULL DEFAULT '',
  cancellation_policy   TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'pending_review', -- draft | pending_review | active | paused | rejected | archived
  is_active             INTEGER NOT NULL DEFAULT 1,
  rating_avg            REAL NOT NULL DEFAULT 0,
  rating_count          INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_listings_provider ON service_listings(provider_profile_id);
CREATE INDEX IF NOT EXISTS idx_service_listings_category ON service_listings(category_id, status);
CREATE INDEX IF NOT EXISTS idx_service_listings_status ON service_listings(status, is_active);

-- ============================================================
-- 5. SERVICE PACKAGES (spec section 7)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_packages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  service_listing_id  INTEGER NOT NULL REFERENCES service_listings(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  price_kobo          INTEGER NOT NULL,
  duration_minutes    INTEGER,
  included_json       TEXT NOT NULL DEFAULT '[]',   -- list of included deliverables/line items
  limits_json         TEXT NOT NULL DEFAULT '{}',   -- e.g. { "revisions": 2, "rooms": 3 }
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_packages_listing ON service_packages(service_listing_id, sort_order);

-- ============================================================
-- 6. SERVICE AREAS (spec sections 16 & 17) — location-aware coverage
-- ============================================================
CREATE TABLE IF NOT EXISTS service_areas (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_profile_id INTEGER NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  country_iso         TEXT NOT NULL,
  region              TEXT,
  city                TEXT,
  neighborhood        TEXT,
  radius_km           REAL,
  latitude            REAL,
  longitude           REAL,
  is_online_only      INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_areas_provider ON service_areas(provider_profile_id);
CREATE INDEX IF NOT EXISTS idx_service_areas_location ON service_areas(country_iso, city);

-- ============================================================
-- 7. SERVICE RESOURCES / CAPACITY (spec section 15)
-- ============================================================
-- Represents an individual bookable unit of capacity within a provider
-- profile (e.g. one of a salon's 5 stylists, one of a garage's 8
-- mechanics). A single-person provider gets exactly one implicit resource
-- row (created lazily) so availability logic never has to special-case
-- "provider IS the resource" vs "provider HAS resources".
CREATE TABLE IF NOT EXISTS service_resources (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_profile_id INTEGER NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,             -- e.g. "Chidi (Senior Stylist)" or "Bay 1"
  role_title          TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_resources_provider ON service_resources(provider_profile_id);

-- ============================================================
-- 8. AVAILABILITY (spec section 14) — working hours + capacity
-- ============================================================
-- Recurring weekly working-hours template per resource. Concrete blocked
-- time uses the EXISTING booking_availability_blocks table (migration
-- 0024), extended below with an optional resource_id so a block can be
-- scoped to one resource rather than the whole listing.
CREATE TABLE IF NOT EXISTS service_availability_hours (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id         INTEGER NOT NULL REFERENCES service_resources(id) ON DELETE CASCADE,
  day_of_week         INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  start_time          TEXT NOT NULL,   -- 'HH:MM' 24h, in the provider's local timezone
  end_time            TEXT NOT NULL,
  buffer_minutes      INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1,
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_service_availability_hours_resource ON service_availability_hours(resource_id, day_of_week);

ALTER TABLE booking_availability_blocks ADD COLUMN resource_id INTEGER REFERENCES service_resources(id);
CREATE INDEX IF NOT EXISTS idx_booking_availability_blocks_resource ON booking_availability_blocks(resource_id);

-- ============================================================
-- 9. SERVICE REQUESTS (spec section 8)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number      TEXT NOT NULL UNIQUE,
  customer_user_id    INTEGER NOT NULL REFERENCES users(id),
  category_id         INTEGER NOT NULL REFERENCES categories(id),
  service_listing_id  INTEGER REFERENCES service_listings(id),   -- NULL for an open "broadcast" request not tied to one listing yet
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  country_iso         TEXT NOT NULL DEFAULT 'NG',
  city                TEXT,
  address_line1       TEXT,
  latitude            REAL,
  longitude           REAL,
  preferred_date      TEXT,
  preferred_time      TEXT,
  budget_kobo         INTEGER,
  urgency             TEXT NOT NULL DEFAULT 'normal',  -- normal | urgent | emergency
  status              TEXT NOT NULL DEFAULT 'submitted', -- draft | submitted | matching | quoted | accepted | scheduled | in_progress | completed | cancelled | disputed
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_requests_customer ON service_requests(customer_user_id, id);
CREATE INDEX IF NOT EXISTS idx_service_requests_category ON service_requests(category_id, status);
CREATE INDEX IF NOT EXISTS idx_service_requests_location ON service_requests(country_iso, city);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);

-- Dynamic, category-driven requirement answers (spec section 18) — never
-- hard-coded columns per vertical (e.g. "vehicle_make", "hair_type").
CREATE TABLE IF NOT EXISTS service_request_requirements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  service_request_id  INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  key                 TEXT NOT NULL,
  label               TEXT NOT NULL,
  value                TEXT,
  UNIQUE(service_request_id, key)
);

CREATE TABLE IF NOT EXISTS service_request_attachments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  service_request_id  INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  url                 TEXT NOT NULL,
  media_type          TEXT NOT NULL DEFAULT 'image',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 10. QUOTES + VERSIONING (spec sections 10 & 11)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_quotes (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  service_request_id    INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  provider_profile_id   INTEGER NOT NULL REFERENCES provider_profiles(id),
  price_kobo            INTEGER NOT NULL CHECK (price_kobo > 0),
  currency              TEXT NOT NULL DEFAULT 'NGN',
  estimated_duration_minutes INTEGER,
  proposed_date         TEXT,
  proposed_time         TEXT,
  scope                 TEXT NOT NULL DEFAULT '',
  materials_included    INTEGER NOT NULL DEFAULT 0,
  travel_fee_kobo       INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'sent', -- draft | sent | viewed | accepted | rejected | expired | withdrawn
  expires_at            TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  supersedes_quote_id   INTEGER REFERENCES service_quotes(id),  -- points at the PREVIOUS version when a provider revises price/scope/date/duration (spec section 11: never silently overwrite)
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_quotes_request ON service_quotes(service_request_id, status);
CREATE INDEX IF NOT EXISTS idx_service_quotes_provider ON service_quotes(provider_profile_id, id);
CREATE INDEX IF NOT EXISTS idx_service_quotes_supersedes ON service_quotes(supersedes_quote_id);

-- One request can only have one CURRENTLY-ACTIVE (non-superseded, non-
-- terminal) quote per provider at a time — enforced in application code
-- (see src/lib/service-requests.ts) since SQLite partial-unique-index
-- semantics over a mutable status column are fragile across revisions;
-- documented here rather than silently assumed.

-- ============================================================
-- 11. SERVICE ORDERS + EVENTS (spec sections 12 & 41)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_orders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number          TEXT NOT NULL UNIQUE,
  service_request_id    INTEGER NOT NULL REFERENCES service_requests(id),
  service_quote_id      INTEGER NOT NULL REFERENCES service_quotes(id),
  customer_user_id      INTEGER NOT NULL REFERENCES users(id),
  provider_profile_id   INTEGER NOT NULL REFERENCES provider_profiles(id),
  booking_id            INTEGER REFERENCES bookings(id),  -- linked once scheduled via the EXISTING Booking Engine
  price_kobo            INTEGER NOT NULL CHECK (price_kobo > 0),
  travel_fee_kobo       INTEGER NOT NULL DEFAULT 0,
  additional_charges_kobo INTEGER NOT NULL DEFAULT 0,   -- customer-confirmed only (spec section 26: never silently increase)
  platform_fee_kobo     INTEGER NOT NULL DEFAULT 0,
  total_kobo            INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'NGN',
  payment_status        TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid | deposit_paid | escrow_held | released | refunded | partially_refunded
  status                TEXT NOT NULL DEFAULT 'accepted', -- accepted | scheduled | provider_arriving | in_progress | completed | customer_confirmed | paid | cancelled | declined | expired | disputed | refunded | no_show
  scheduled_at          TEXT,
  completed_at          TEXT,
  cancelled_at          TEXT,
  cancellation_reason   TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_orders_customer ON service_orders(customer_user_id, id);
CREATE INDEX IF NOT EXISTS idx_service_orders_provider ON service_orders(provider_profile_id, id);
CREATE INDEX IF NOT EXISTS idx_service_orders_status ON service_orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_quote_unique ON service_orders(service_quote_id);

CREATE TABLE IF NOT EXISTS service_order_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  service_order_id    INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  previous_status     TEXT,
  new_status          TEXT NOT NULL,
  actor_user_id       INTEGER REFERENCES users(id),
  metadata_json       TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_order_events_order ON service_order_events(service_order_id, id);

-- ============================================================
-- 12. SERVICE MEDIA (spec section 19) — portfolio/before-after
-- ============================================================
CREATE TABLE IF NOT EXISTS service_media (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_profile_id INTEGER REFERENCES provider_profiles(id) ON DELETE CASCADE,
  service_listing_id  INTEGER REFERENCES service_listings(id) ON DELETE CASCADE,
  media_type          TEXT NOT NULL DEFAULT 'image',  -- image | video | document
  url                 TEXT NOT NULL,
  caption             TEXT,
  media_category      TEXT NOT NULL DEFAULT 'portfolio',  -- portfolio | before_after | certification
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (provider_profile_id IS NOT NULL OR service_listing_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_service_media_provider ON service_media(provider_profile_id);
CREATE INDEX IF NOT EXISTS idx_service_media_listing ON service_media(service_listing_id);
