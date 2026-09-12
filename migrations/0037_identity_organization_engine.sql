-- Migration 0037: Identity & Account Engine 2.0 — Organization/RBAC Foundation
--
-- NEW APPLICATION FEATURE (not a production-schema reconstruction). Unlike
-- migrations 0013-0036, this migration is NOT reproducing an observed
-- production table — it is genuinely new, additive identity infrastructure
-- built on top of the EXISTING users/sessions/addresses/vendors foundation
-- (migrations 0001, 0007, 0009), per the Identity & Account Engine 2.0 spec.
--
-- NON-NEGOTIABLE COMPATIBILITY RULES THIS FILE FOLLOWS:
--   - Zero changes to users/sessions/addresses/vendors CORE columns. Only two
--     purely additive, nullable-or-defaulted ALTER TABLE ADD COLUMN
--     statements on `users` (country_iso, status) — every existing row gets
--     a safe default, every existing query keeps working unchanged.
--   - Does NOT create a second "users" table. Organizations are a NEW
--     concept layered on top of the existing user identity, never a
--     replacement for it.
--   - Does NOT touch vendors.user_id (migration 0009's seller bridge) or
--     provider_profiles/provider_organizations (migration 0025's vertical
--     provider identity). Those remain valid, working bridges from a
--     PERSON to a specific vertical's provider record. This migration adds
--     the missing GENERIC layer above them: a business/organization can now
--     exist independently of any one vertical, with its own multi-user
--     membership, roles and permissions — vendors/provider_profiles can
--     optionally be linked to an organization_id in a FUTURE, separate,
--     purely-additive migration once a vertical actually needs that bridge;
--     forcing that link now, for verticals that don't need it yet, would be
--     scope creep this migration deliberately avoids.
--
-- SQLite ALTER TABLE ADD COLUMN note (see migration 0027's fix earlier this
-- project for the exact failure mode): every ALTER ... DEFAULT below uses a
-- CONSTANT literal (never datetime('now') / any function call), which is
-- the only kind of default SQLite allows on ALTER TABLE ADD COLUMN.

-- ============================================================
-- 0. USERS: purely additive country + lifecycle status
-- ============================================================
-- country_iso: Africa-ready from day one — NOT a Nigeria-only architecture.
-- Defaults to 'NG' so every existing row (100% Nigerian today) is correct
-- without a backfill script, while every new signup elsewhere on the
-- continent gets a real ISO-3166-1 alpha-2 code once the registration flow
-- collects it (a UI/API concern, not a schema concern — this column just
-- needs to exist first).
ALTER TABLE users ADD COLUMN country_iso TEXT NOT NULL DEFAULT 'NG';

-- status: the account lifecycle state machine Section 15 requires. Existing
-- rows all become 'active' (the only state that has ever existed for them),
-- so no existing login/session/order/wishlist behavior changes for a single
-- current user. Deliberately NOT touching `role` (customer|vendor|admin) —
-- that stays the PLATFORM role (Section 7); `status` is an orthogonal
-- lifecycle dimension, not a fourth role value.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'pending_verification', 'suspended', 'disabled', 'deleted'));

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country_iso);

-- ============================================================
-- 1. ACCOUNT PREFERENCES — one row per user, reusable by every vertical
-- ============================================================
-- Deliberately separate from `users` itself (not more ALTERs on users) so
-- this can grow (new preference keys) without ever touching the
-- authentication-critical users table again. 1:1 with users, created lazily
-- on first write (see src/lib/account.ts) — absence of a row simply means
-- "using defaults", exactly like affiliate_accounts/wallet_accounts's
-- lazy-row pattern elsewhere in this codebase.
CREATE TABLE IF NOT EXISTS account_preferences (
  user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language                TEXT NOT NULL DEFAULT 'en',
  currency_code           TEXT NOT NULL DEFAULT 'NGN',
  timezone                TEXT NOT NULL DEFAULT 'Africa/Lagos',
  notification_prefs_json TEXT NOT NULL DEFAULT '{"order_updates":true,"promotions":true,"security_alerts":true}',
  marketing_opt_in        INTEGER NOT NULL DEFAULT 1,
  privacy_prefs_json      TEXT NOT NULL DEFAULT '{}',
  accessibility_prefs_json TEXT NOT NULL DEFAULT '{}',
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 2. ORGANIZATIONS — the core new entity: a business/organization identity
-- ============================================================
-- organization_type is intentionally free TEXT, not a CHECK-constrained
-- enum — Section 3 explicitly forbids hard-coding organization types
-- ("Future types must be possible without redesigning the identity
-- engine"). Validation of "is this a type we currently support in the UI"
-- belongs in application code / a future org_types lookup table, never a
-- schema-level CHECK that would require a migration every time a new
-- vertical (NaijaHealth, NaijaAuto, ...) needs a new organization_type value.
CREATE TABLE IF NOT EXISTS organizations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL,               -- legal/registered name
  display_name          TEXT,                        -- public-facing name, may differ from `name`
  organization_type     TEXT NOT NULL DEFAULT 'business', -- business|restaurant|hotel|service_provider|fleet|creator_company|clinic|garage|event_company|merchant|logistics_provider|... (open vocabulary, see note above)
  logo_url              TEXT,
  description            TEXT NOT NULL DEFAULT '',
  contact_email         TEXT,
  contact_phone         TEXT,
  website               TEXT,
  country_iso           TEXT NOT NULL DEFAULT 'NG',
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
  verification_status   TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected', 'suspended')),
  verification_note     TEXT,
  settings_json         TEXT NOT NULL DEFAULT '{}',   -- organization-level settings/preferences, open-ended (Section 3)
  created_by_user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(organization_type);
CREATE INDEX IF NOT EXISTS idx_organizations_country ON organizations(country_iso);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_verification ON organizations(verification_status);

-- ============================================================
-- 3. ORGANIZATION ROLES + PERMISSIONS — reusable RBAC, not per-vertical
-- ============================================================
-- Global permission catalog, shared by every organization and every
-- vertical (Section 6). Namespaced by "resource.action" (products.read,
-- orders.manage, bookings.manage, ...) exactly as the spec's examples show.
CREATE TABLE IF NOT EXISTS organization_permissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,     -- e.g. 'orders.manage', 'staff.manage'
  category     TEXT NOT NULL,            -- e.g. 'commerce', 'organization', 'finance'
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_org_permissions_category ON organization_permissions(category);

-- Roles are either SYSTEM roles (organization_id IS NULL — e.g. 'owner',
-- 'admin', 'manager', 'staff', usable by every organization out of the box)
-- or CUSTOM roles scoped to one organization (organization_id set — a
-- business can define its own role, e.g. "Kitchen Manager", without
-- affecting any other organization's role set). This is what lets Section 3
-- support arbitrary staff titles per business without a schema change.
CREATE TABLE IF NOT EXISTS organization_roles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id   INTEGER REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = system-wide role
  key               TEXT NOT NULL,       -- e.g. 'owner', 'admin', 'manager', 'staff', or a custom slug
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  is_system         INTEGER NOT NULL DEFAULT 0,  -- 1 = seeded platform-wide role, cannot be edited/deleted by an org
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, key)
);

CREATE INDEX IF NOT EXISTS idx_org_roles_organization ON organization_roles(organization_id);

CREATE TABLE IF NOT EXISTS organization_role_permissions (
  role_id        INTEGER NOT NULL REFERENCES organization_roles(id) ON DELETE CASCADE,
  permission_id  INTEGER NOT NULL REFERENCES organization_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ============================================================
-- 4. ORGANIZATION MEMBERSHIP — the person <-> organization bridge
-- ============================================================
-- THE central table for "does user X have access to organization Y, and
-- with what role/permissions". Every organization-scoped authorization
-- check in the entire platform ultimately reads this table (via
-- src/lib/rbac.ts) — never re-implemented per vertical (Section 19).
--
-- status lifecycle (Section 5): invited -> active -> suspended/removed.
-- A membership row is NEVER hard-deleted on removal (status='removed'
-- instead) so historical "who had access to what, when" is always
-- reconstructable for audit purposes — same soft-delete precedent as
-- seller_payout_accounts (migration 0009).
CREATE TABLE IF NOT EXISTS organization_members (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id            INTEGER NOT NULL REFERENCES organization_roles(id),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  is_owner           INTEGER NOT NULL DEFAULT 0,   -- exactly one active is_owner=1 row per organization, enforced in application code (see requireLastOwnerGuard)
  invited_by_user_id INTEGER REFERENCES users(id),
  joined_at          TEXT,                          -- set when status first becomes 'active'
  removed_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, user_id)                  -- one membership row per user per organization — role changes UPDATE this row, they never insert a second one
);

CREATE INDEX IF NOT EXISTS idx_org_members_organization ON organization_members(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id, status);

-- ============================================================
-- 5. ORGANIZATION INVITATIONS — Section 16's invite lifecycle
-- ============================================================
-- Deliberately separate from organization_members: an invitation is a
-- proposal that may never be accepted (revoked, expired, rejected), while a
-- membership row only exists once a real user is actually attached. This
-- avoids creating a "ghost" membership row for someone who hasn't even
-- signed up yet.
CREATE TABLE IF NOT EXISTS organization_invitations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id            INTEGER NOT NULL REFERENCES organization_roles(id),
  invited_email      TEXT,
  invited_phone      TEXT,
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash         TEXT NOT NULL UNIQUE,          -- SHA-256 of the raw invite token, same "never store the raw secret" pattern as sessions.token_hash
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked', 'expired')),
  expires_at         TEXT NOT NULL,
  accepted_by_user_id INTEGER REFERENCES users(id),
  accepted_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (invited_email IS NOT NULL OR invited_phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_org_invitations_organization ON organization_invitations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON organization_invitations(invited_email);
CREATE INDEX IF NOT EXISTS idx_org_invitations_token_hash ON organization_invitations(token_hash);

-- ============================================================
-- 6. ORGANIZATION ADDRESSES — reusable across every vertical (Section 11)
-- ============================================================
-- Distinct table from the existing personal `addresses` (migration 0001) —
-- an organization is not a user, and forcing organization addresses into
-- the user-scoped addresses table would require a nullable user_id there,
-- weakening the ownership guarantee every existing personal-address query
-- relies on. address_type covers the Section 11 use cases (business,
-- billing, shipping, pickup, service) without a separate table per type.
-- country_iso + lat/lng are included from day one for Section 12's
-- Africa-wide readiness — never Nigeria-only.
CREATE TABLE IF NOT EXISTS organization_addresses (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  address_type           TEXT NOT NULL DEFAULT 'business' CHECK (address_type IN ('business', 'billing', 'shipping', 'pickup', 'service')),
  label                  TEXT NOT NULL DEFAULT 'Main',
  recipient_name         TEXT NOT NULL,
  phone                  TEXT NOT NULL,
  line1                  TEXT NOT NULL,
  line2                  TEXT,
  city                   TEXT NOT NULL,
  state_region           TEXT,                      -- state/province/region — free text, country-neutral (Nigerian-specific validation, if any, is an application-layer concern against nigerian_states)
  postal_code            TEXT,
  country_iso            TEXT NOT NULL DEFAULT 'NG',
  latitude               REAL,
  longitude              REAL,
  is_default             INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_org_addresses_organization ON organization_addresses(organization_id, address_type);

-- ============================================================
-- 7. SEED: system roles + starter permission catalog
-- ============================================================
-- Four system roles every organization gets automatically — matches the
-- spec's own examples (Owner/GM/Manager/Staff-tier titles across
-- restaurant/hotel/logistics/clinic all collapse cleanly onto this same
-- 4-tier base, with custom per-org roles layered on top when a business
-- needs a more specific title).
INSERT INTO organization_roles (organization_id, key, name, description, is_system) VALUES
  (NULL, 'owner',   'Owner',   'Full control of the organization, including billing, ownership transfer and member management.', 1),
  (NULL, 'admin',   'Admin',   'Manages members, roles and settings, but cannot transfer ownership or delete the organization.', 1),
  (NULL, 'manager', 'Manager', 'Manages day-to-day operations (orders, bookings, listings, staff scheduling) for the organization.', 1),
  (NULL, 'staff',   'Staff',   'Operational access scoped to day-to-day tasks, no organization-management permissions.', 1);

INSERT INTO organization_permissions (key, category, name, description) VALUES
  ('organization.manage', 'organization', 'Manage organization', 'Edit organization profile, settings and verification details.'),
  ('members.manage',      'organization', 'Manage members',      'Invite, remove, suspend and change the role of organization members.'),
  ('billing.manage',      'organization', 'Manage billing',      'View and manage the organization''s billing and payout configuration.'),
  ('settings.manage',     'organization', 'Manage settings',     'Change organization-level settings and preferences.'),
  ('staff.manage',        'organization', 'Manage staff',        'Manage staff scheduling and assignments.'),
  ('analytics.read',      'organization', 'View analytics',      'View organization performance analytics and reports.'),
  ('products.read',       'commerce', 'View products', 'View product/listing catalog.'),
  ('products.create',     'commerce', 'Create products', 'Create new products/listings.'),
  ('products.update',     'commerce', 'Update products', 'Edit existing products/listings.'),
  ('products.delete',     'commerce', 'Delete products', 'Remove products/listings.'),
  ('orders.read',         'commerce', 'View orders', 'View customer orders.'),
  ('orders.manage',       'commerce', 'Manage orders', 'Update order status and fulfilment.'),
  ('bookings.read',       'commerce', 'View bookings', 'View bookings/reservations.'),
  ('bookings.manage',     'commerce', 'Manage bookings', 'Create, update and cancel bookings/reservations.'),
  ('customers.read',      'commerce', 'View customers', 'View customer records associated with the organization.'),
  ('payments.read',       'money', 'View payments', 'View payment records.'),
  ('payments.manage',     'money', 'Manage payments', 'Manage payment configuration and disputes.'),
  ('payouts.read',        'money', 'View payouts', 'View payout history and status.'),
  ('drivers.read',        'logistics', 'View drivers', 'View driver records.'),
  ('drivers.manage',      'logistics', 'Manage drivers', 'Onboard and manage drivers.'),
  ('vehicles.read',       'logistics', 'View vehicles', 'View fleet vehicle records.'),
  ('vehicles.manage',     'logistics', 'Manage vehicles', 'Manage fleet vehicle records.'),
  ('shipments.read',      'logistics', 'View shipments', 'View shipment records.'),
  ('shipments.manage',    'logistics', 'Manage shipments', 'Create and manage shipments.'),
  ('properties.read',     'commerce', 'View properties', 'View property/stay listings.'),
  ('properties.manage',   'commerce', 'Manage properties', 'Manage property/stay listings.'),
  ('menus.read',          'commerce', 'View menus', 'View restaurant menus.'),
  ('menus.manage',        'commerce', 'Manage menus', 'Manage restaurant menus.'),
  ('services.read',       'commerce', 'View services', 'View gig/service listings.'),
  ('services.manage',     'commerce', 'Manage services', 'Manage gig/service listings.'),
  ('reviews.manage',      'commerce', 'Manage reviews', 'Respond to and moderate reviews for the organization.');

-- Owner gets every permission that exists at seed time (application code
-- also grants any FUTURE permission implicitly to the owner role — see
-- src/lib/rbac.ts's hasPermission, which short-circuits true for is_owner=1
-- members regardless of this join table, so a newly-added permission never
-- needs a data migration to reach existing owners).
INSERT INTO organization_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM organization_roles WHERE organization_id IS NULL AND key = 'owner'), id FROM organization_permissions;

INSERT INTO organization_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM organization_roles WHERE organization_id IS NULL AND key = 'admin'), id FROM organization_permissions
  WHERE key NOT IN ('billing.manage');

INSERT INTO organization_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM organization_roles WHERE organization_id IS NULL AND key = 'manager'), id FROM organization_permissions
  WHERE key IN ('products.read','products.create','products.update','orders.read','orders.manage',
                'bookings.read','bookings.manage','customers.read','drivers.read','drivers.manage',
                'vehicles.read','vehicles.manage','shipments.read','shipments.manage','properties.read',
                'properties.manage','menus.read','menus.manage','services.read','services.manage',
                'analytics.read','reviews.manage','staff.manage');

INSERT INTO organization_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM organization_roles WHERE organization_id IS NULL AND key = 'staff'), id FROM organization_permissions
  WHERE key IN ('products.read','orders.read','bookings.read','customers.read','drivers.read',
                'vehicles.read','shipments.read','properties.read','menus.read','services.read');
