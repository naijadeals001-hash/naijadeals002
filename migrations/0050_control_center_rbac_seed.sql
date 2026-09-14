-- Migration 0050: Enterprise Control Center — Phase 1 Granular RBAC Activation
--
-- Enterprise Control Center — Phase 1 (baseline SHA a9a987136d577de7c6fb83e
-- 023ea41724353c28c). Activates the DORMANT cc_roles / cc_permissions /
-- cc_role_permissions tables created empty by migration 0013 (confirmed 0
-- rows, 0 code references by the Phase 0 forensic audit — see
-- docs/ENTERPRISE-CONTROL-CENTER-PHASE-0-GAP-MATRIX.md, Section 4).
--
-- PATTERN: this file replicates migration 0037's own
-- organization_roles/organization_permissions/organization_role_permissions
-- seeding technique EXACTLY — INSERT the roles, INSERT the permissions, then
-- INSERT INTO cc_role_permissions via `SELECT id FROM cc_permissions WHERE
-- key IN (...)` subqueries keyed by TEXT key (never hardcoded numeric ids,
-- so this migration is order-independent and safely re-runnable in spirit
-- even though SQLite migrations here are one-shot). No schema change is
-- needed — cc_roles/cc_permissions/cc_role_permissions/cc_user_roles already
-- have exactly the columns this seed needs (migration 0013).
--
-- SCOPE DISCIPLINE (Phase 1 prompt Section 9/31 Open Question #3): 13 role
-- keys are seeded (matching the prompt's own enumerated list) so the model
-- can express the full target hierarchy from day one, but only a lean,
-- deliberately-scoped 33-permission catalog is seeded — the exact set of
-- dot-notation permissions the Phase 1 prompt itself enumerates as ready-now
-- capabilities (Section 10). This is NOT "hundreds of meaningless
-- permissions" — every key maps either to a capability Phase 1 implements
-- (vendors.verify/providers.verify — Section 14) or to a capability that
-- already has a real underlying table/route today (payments, refunds,
-- disputes, orders, bookings, promotions, notifications, integrations,
-- audit, system_health, configuration). Roles that don't yet have a matching
-- real capability (content_admin, logistics_admin) are still seeded — the
-- ROLE hierarchy must exist per Section 8 — but are deliberately granted a
-- minimal permission set (audit.read only) rather than fabricated
-- permissions for capabilities Phase 1 does not implement. This keeps
-- "admin != everything" true even for roles whose full permission set will
-- only make sense once a LATER phase adds the underlying capability.
--
-- NO test/production admin is granted a cc_user_roles row here — Section 34
-- of the Phase 1 prompt explicitly forbids seeding fake/production admin
-- accounts in a migration. A test-only Control Center admin is created
-- exclusively through the test harness's own fixture helper (see
-- tests/control-center/helpers/client.mjs's grantControlCenterRole, which
-- mirrors identity-engine's existing promoteToAdmin() pattern), never
-- through migration data.

-- ============================================================
-- 1. ROLES (cc_roles) — the 13-role hierarchy from Phase 1 prompt Section 8.
--    All are_system=1 (platform-defined, not user-creatable) since the
--    Control Center has no concept of a "custom" role in Phase 1.
-- ============================================================
INSERT INTO cc_roles (key, name, description, is_system) VALUES
  ('super_admin',        'Super Admin',                    'Unrestricted Control Center access, including configuration changes and role assignment. Reserve for a small number of trusted operators.', 1),
  ('platform_admin',     'Platform Administrator',         'Broad day-to-day administrative access across every Control Center domain except platform-wide configuration changes.', 1),
  ('operations_admin',   'Operations Administrator',       'Manages orders, bookings, disputes and notification operations.', 1),
  ('finance_admin',      'Finance Administrator',          'Manages payments, wallets and refund approvals.', 1),
  ('trust_safety_admin', 'Trust & Safety Administrator',   'Manages customer/vendor/provider suspension, verification and dispute resolution.', 1),
  ('support_admin',      'Customer Support Administrator', 'Handles customer-facing support: customer records, orders, bookings, disputes and notifications (read/limited write).', 1),
  ('vendor_admin',       'Vendor/Provider Administrator',  'Manages vendor and provider verification, suspension and reinstatement.', 1),
  ('marketing_admin',    'Marketing Administrator',        'Manages promotions and outbound notification campaigns.', 1),
  ('content_admin',      'Content Administrator',          'Reserved for future content/media moderation capabilities. No implemented capability in Phase 1 beyond audit visibility.', 1),
  ('logistics_admin',    'Logistics Administrator',        'Reserved for future logistics/dispatch command-center capabilities. No implemented capability in Phase 1 beyond audit visibility.', 1),
  ('analytics_admin',    'Analytics Administrator',        'Views platform analytics and system health. Read-only.', 1),
  ('integration_admin',  'Integration Administrator',      'Manages third-party integration configuration (Engine 9 providers, payment gateways, etc).', 1),
  ('auditor',            'Read-Only Auditor',              'Full read visibility across every Control Center domain, zero write/approve/suspend/verify capability. For compliance and internal audit use.', 1);

-- ============================================================
-- 2. PERMISSIONS (cc_permissions) — dot-notation, one row per real or
--    near-term-real capability. Category groups mirror the left-nav
--    modules from Phase 1 prompt Section 16.
-- ============================================================
INSERT INTO cc_permissions (key, category, name, description) VALUES
  ('customers.read',      'customers',     'View customers',            'View customer account records.'),
  ('customers.write',     'customers',     'Edit customers',            'Edit customer account details.'),
  ('customers.suspend',   'customers',     'Suspend customers',         'Suspend, disable or reinstate a customer account (users.status).'),
  ('vendors.read',        'vendors',       'View vendors',              'View vendor/store records.'),
  ('vendors.write',       'vendors',       'Edit vendors',              'Edit vendor/store records.'),
  ('vendors.suspend',     'vendors',       'Suspend vendors',           'Suspend or reinstate a vendor store (vendors.store_status).'),
  ('vendors.verify',      'vendors',       'Verify vendors',            'Approve, reject or reinstate a vendor''s verification status (vendors.verification_status).'),
  ('providers.read',      'providers',     'View providers',            'View gig/service/host/driver provider profiles.'),
  ('providers.write',     'providers',     'Edit providers',            'Edit provider profile records.'),
  ('providers.suspend',   'providers',     'Suspend providers',         'Suspend or reinstate a provider''s operational status (provider_profiles.operational_status).'),
  ('providers.verify',    'providers',     'Verify providers',          'Approve, reject or reinstate a provider''s verification status (provider_profiles.verification_status).'),
  ('orders.read',         'orders',        'View orders',               'View marketplace orders.'),
  ('orders.manage',       'orders',        'Manage orders',             'Modify order status, issue admin-side order actions.'),
  ('bookings.read',       'bookings',      'View bookings',             'View Booking Engine bookings/reservations.'),
  ('bookings.manage',     'bookings',      'Manage bookings',           'Modify booking status, issue admin-side booking actions.'),
  ('payments.read',       'finance',       'View payments',             'View payment transaction records.'),
  ('payments.manage',     'finance',       'Manage payments',           'Modify payment records / initiate payment-side corrections.'),
  ('wallets.read',        'finance',       'View wallets',              'View wallet balances and ledger entries.'),
  ('wallets.manage',      'finance',       'Manage wallets',            'Adjust wallet balances (requires step-up authentication once implemented).'),
  ('refunds.read',        'finance',       'View refunds',              'View refund requests and history.'),
  ('refunds.approve',     'finance',       'Approve refunds',           'Approve or reject a refund request (requires step-up authentication once implemented).'),
  ('disputes.read',       'trust_safety',  'View disputes',             'View open and resolved disputes.'),
  ('disputes.manage',     'trust_safety',  'Manage disputes',           'Resolve or reject a dispute.'),
  ('promotions.read',     'marketing',     'View promotions',           'View coupons, brand merchandising and hero campaigns.'),
  ('promotions.manage',   'marketing',     'Manage promotions',         'Create, edit, activate or deactivate coupons, brand merchandising and hero campaigns.'),
  ('notifications.read',  'communications','View notifications',       'View the notification outbox/delivery overview.'),
  ('notifications.manage','communications','Manage notifications',     'Trigger outbox processing/retry, manage notification templates.'),
  ('integrations.read',   'integrations',  'View integrations',        'View third-party integration configuration status (never secret values).'),
  ('integrations.manage', 'integrations',  'Manage integrations',      'Modify third-party integration configuration.'),
  ('audit.read',          'governance',    'View audit log',           'View the Control Center audit trail (cc_audit_logs).'),
  ('system_health.read',  'governance',    'View system health',       'View system/component health status.'),
  ('configuration.read',  'governance',    'View configuration',       'View platform-wide configuration values.'),
  ('configuration.write', 'governance',    'Edit configuration',       'Modify platform-wide configuration values. Reserved for super_admin.');

-- ============================================================
-- 3. ROLE <-> PERMISSION GRANTS (cc_role_permissions)
-- ============================================================

-- super_admin: every permission that exists, now and in the future — the
-- application layer (src/lib/control-center-rbac.ts, mirroring
-- organizations.ts's resolveMembership is_owner short-circuit) also grants
-- super_admin every NEWLY added permission implicitly, so this table never
-- needs a follow-up data migration when a future phase adds a permission.
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'super_admin'), id FROM cc_permissions;

-- platform_admin: everything except configuration.write (mirrors migration
-- 0037's admin/billing.manage exclusion pattern — broad operational power,
-- but platform-wide configuration changes are reserved for super_admin).
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'platform_admin'), id FROM cc_permissions
  WHERE key != 'configuration.write';

INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'operations_admin'), id FROM cc_permissions
  WHERE key IN ('orders.read','orders.manage','bookings.read','bookings.manage',
                'disputes.read','disputes.manage','notifications.read','notifications.manage',
                'audit.read','system_health.read');

INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'finance_admin'), id FROM cc_permissions
  WHERE key IN ('payments.read','payments.manage','wallets.read','wallets.manage',
                'refunds.read','refunds.approve','audit.read');

INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'trust_safety_admin'), id FROM cc_permissions
  WHERE key IN ('customers.read','customers.suspend','vendors.read','vendors.suspend','vendors.verify',
                'providers.read','providers.suspend','providers.verify',
                'disputes.read','disputes.manage','audit.read');

INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'support_admin'), id FROM cc_permissions
  WHERE key IN ('customers.read','customers.write','orders.read','bookings.read',
                'disputes.read','notifications.read','audit.read');

INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'vendor_admin'), id FROM cc_permissions
  WHERE key IN ('vendors.read','vendors.write','vendors.suspend','vendors.verify',
                'providers.read','providers.write','providers.suspend','providers.verify','audit.read');

INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'marketing_admin'), id FROM cc_permissions
  WHERE key IN ('promotions.read','promotions.manage','notifications.read','notifications.manage','audit.read');

-- content_admin / logistics_admin: role hierarchy must exist (Section 8),
-- but Phase 1 defines no content.* or logistics.* Control Center permission
-- (no admin mutation capability for those domains exists yet) — granting
-- audit.read only is honest; it is NOT a placeholder for fabricated power.
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'content_admin'), id FROM cc_permissions
  WHERE key IN ('audit.read');

INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'logistics_admin'), id FROM cc_permissions
  WHERE key IN ('audit.read');

INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'analytics_admin'), id FROM cc_permissions
  WHERE key IN ('audit.read','system_health.read');

INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'integration_admin'), id FROM cc_permissions
  WHERE key IN ('integrations.read','integrations.manage','audit.read');

-- auditor: every *.read permission (including configuration.read), zero
-- write/manage/approve/suspend/verify — a genuine read-only role, not
-- "admin-lite".
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'auditor'), id FROM cc_permissions
  WHERE key LIKE '%.read';
