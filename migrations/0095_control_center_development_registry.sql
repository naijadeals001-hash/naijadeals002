-- Persisted Control Center development registry.
-- This is operational evidence, not a substitute for tests or deployment.
CREATE TABLE IF NOT EXISTS cc_development_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key TEXT NOT NULL UNIQUE,
  workstream TEXT NOT NULL,
  vertical TEXT NOT NULL,
  feature TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,
  dependency_task_keys_json TEXT NOT NULL DEFAULT '[]',
  rea_state TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (rea_state IN ('NOT_REQUIRED','NEEDED','RESEARCHING','EVIDENCED','BLOCKED')),
  rea_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  reference_urls_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RESEARCHING','READY','IMPLEMENTING','TESTING','PREVIEW_VERIFYING','COMMITTING','COMPLETE','PARTIAL','BLOCKED','FAILED')),
  assigned_subsystem TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL DEFAULT 0,
  checkpoint TEXT NOT NULL DEFAULT '',
  implementation_state TEXT NOT NULL DEFAULT 'NOT_STARTED',
  automated_test_state TEXT NOT NULL DEFAULT 'NOT_RUN',
  preview_state TEXT NOT NULL DEFAULT 'NOT_RUN',
  external_integration_state TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  sandbox_e2e_state TEXT NOT NULL DEFAULT 'NOT_RUN',
  production_prerequisites_state TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
  production_deployment_state TEXT NOT NULL DEFAULT 'NOT_DEPLOYED',
  production_verification_state TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
  build_result TEXT NOT NULL DEFAULT '',
  test_result TEXT NOT NULL DEFAULT '',
  browser_acceptance TEXT NOT NULL DEFAULT '',
  preview_routes_json TEXT NOT NULL DEFAULT '[]',
  screenshot_refs_json TEXT NOT NULL DEFAULT '[]',
  limitations TEXT NOT NULL DEFAULT '',
  blocker_details TEXT NOT NULL DEFAULT '',
  commit_sha TEXT,
  remote_sha TEXT,
  last_verified_at TEXT,
  next_task_key TEXT,
  started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cc_dev_tasks_status_priority ON cc_development_tasks(status, priority, id);
CREATE INDEX IF NOT EXISTS idx_cc_dev_tasks_vertical ON cc_development_tasks(vertical, status);
CREATE INDEX IF NOT EXISTS idx_cc_dev_tasks_updated ON cc_development_tasks(updated_at DESC);

CREATE TABLE IF NOT EXISTS cc_development_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES cc_development_tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status TEXT,
  message TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  actor_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cc_dev_events_task ON cc_development_events(task_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_cc_dev_events_created ON cc_development_events(created_at DESC);

INSERT OR IGNORE INTO cc_permissions (key, category, name, description) VALUES
 ('development.read','governance','View development registry','View persisted implementation progress, evidence and readiness states.'),
 ('development.manage','governance','Manage development registry','Update task status, checkpoints and verification evidence.');
INSERT OR IGNORE INTO cc_role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM cc_roles r CROSS JOIN cc_permissions p
 WHERE r.key IN ('super_admin','platform_admin') AND p.key IN ('development.read','development.manage');
INSERT OR IGNORE INTO cc_role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM cc_roles r CROSS JOIN cc_permissions p
 WHERE r.key IN ('operations_admin','analytics_admin','auditor') AND p.key = 'development.read';
