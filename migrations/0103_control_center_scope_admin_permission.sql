-- CC-004: Super Admin-only country scope administration.
INSERT OR IGNORE INTO cc_permissions (key, category, name, description)
VALUES ('configuration.scopes.manage', 'governance', 'Manage country scopes', 'Assign and revoke country scopes for Country Admin users.');
INSERT OR IGNORE INTO cc_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM cc_roles r CROSS JOIN cc_permissions p
WHERE r.key='super_admin' AND p.key='configuration.scopes.manage';
