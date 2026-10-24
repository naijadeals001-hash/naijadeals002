-- Migration 0083: NaijaDrive private-ride Control Center permissions
--
-- Adds only permissions used by the private-ride MVP. No user or admin role is
-- granted automatically; existing role grants are explicit below.

INSERT INTO cc_roles (key, name, description, is_system)
SELECT 'ride_operations_manager', 'Ride Operations Manager', 'Manages private-ride dispatch and operational overrides.', 1
WHERE NOT EXISTS (SELECT 1 FROM cc_roles WHERE key = 'ride_operations_manager');

INSERT INTO cc_permissions (key, category, name, description)
SELECT 'rides.read', 'rides', 'View rides', 'View private-ride requests, lifecycle, and operational history.'
WHERE NOT EXISTS (SELECT 1 FROM cc_permissions WHERE key = 'rides.read');

INSERT INTO cc_permissions (key, category, name, description)
SELECT 'rides.manage', 'rides', 'Manage rides', 'Perform permitted private-ride operational actions.'
WHERE NOT EXISTS (SELECT 1 FROM cc_permissions WHERE key = 'rides.manage');

INSERT INTO cc_permissions (key, category, name, description)
SELECT 'rides.dispatch', 'rides', 'Dispatch rides', 'Assign, reassign, or override private-ride dispatch decisions.'
WHERE NOT EXISTS (SELECT 1 FROM cc_permissions WHERE key = 'rides.dispatch');

INSERT OR IGNORE INTO cc_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM cc_roles r CROSS JOIN cc_permissions p
WHERE r.key IN ('operations_admin', 'ride_operations_manager')
  AND p.key IN ('rides.read', 'rides.manage', 'rides.dispatch');

INSERT OR IGNORE INTO cc_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM cc_roles r CROSS JOIN cc_permissions p
WHERE r.key IN ('support_admin', 'finance_admin', 'logistics_admin')
  AND p.key = 'rides.read';
