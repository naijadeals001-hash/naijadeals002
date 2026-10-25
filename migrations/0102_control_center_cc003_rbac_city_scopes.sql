-- CC-003: explicit acceptance roles, country scope assignments and city-level controls.
-- This migration adds no users or production assignments. Test identities must be
-- provisioned by the test harness or an authorized Control Center workflow.
CREATE TABLE IF NOT EXISTS cc_user_country_scopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_iso TEXT NOT NULL,
  assigned_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, country_iso)
);
CREATE INDEX IF NOT EXISTS idx_cc_user_country_scopes_user ON cc_user_country_scopes(user_id, country_iso);

INSERT OR IGNORE INTO cc_roles (key, name, description, is_system) VALUES
  ('finance_officer', 'Finance Officer', 'Views and operates approved finance workflows without unrelated platform administration.', 1),
  ('country_admin', 'Country Admin', 'Manages assigned-country rollout configuration and operational evidence only.', 1);

INSERT OR IGNORE INTO cc_permissions (key, category, name, description) VALUES
  ('configuration.city.manage', 'governance', 'Manage city vertical overrides', 'Enable, restrict or disable verticals for assigned cities within assigned countries.'),
  ('configuration.vertical.read', 'governance', 'View vertical readiness', 'View vertical readiness and country/city availability evidence.');

INSERT OR IGNORE INTO cc_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM cc_roles r CROSS JOIN cc_permissions p
WHERE r.key = 'finance_officer'
  AND p.key IN ('payments.read','payments.manage','wallets.read','refunds.read','refunds.approve','audit.read');

INSERT OR IGNORE INTO cc_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM cc_roles r CROSS JOIN cc_permissions p
WHERE r.key = 'country_admin'
  AND p.key IN ('configuration.countries.read','configuration.vertical.read','configuration.city.manage','audit.read','system_health.read');

-- Super/platform administrators retain their documented global authority.
INSERT OR IGNORE INTO cc_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM cc_roles r CROSS JOIN cc_permissions p
WHERE r.key IN ('super_admin','platform_admin')
  AND p.key IN ('configuration.vertical.read','configuration.city.manage');
