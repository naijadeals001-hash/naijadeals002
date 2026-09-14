-- Migration 0051: Control Center — Content Moderation permissions.
--
-- Closes a gap the Functional Navigation Audit found: `applyModerationDecision`
-- (src/lib/moderation.ts) and its admin API (src/routes/api-admin.ts) are a
-- complete, real, audited capability with ZERO corresponding cc_permissions
-- row — so the Control Center UI about to be built for it (Workstream A
-- quick win) would have nothing to gate on. This migration ONLY adds the
-- missing permission rows + role grants; it creates no new tables and
-- touches no business data.
--
-- super_admin does NOT need an explicit grant row here: control-center-rbac.ts's
-- resolveControlCenterAccess() already grants super_admin every permission
-- that exists in cc_permissions at request time (dynamic, not table-driven),
-- so these two new rows are automatically visible to super_admin the moment
-- this migration runs — no follow-up data fix needed for that role.

INSERT INTO cc_permissions (key, category, name, description) VALUES
  ('moderation.read',   'moderation', 'View moderation queue',   'View the product/listing moderation queue and decision history.'),
  ('moderation.manage', 'moderation', 'Manage moderation',       'Approve, reject, suspend or request changes on a pending product listing.');

-- platform_admin already receives every permission except configuration.write
-- via its own `WHERE key != 'configuration.write'` seed rule in migration
-- 0050 — but that rule only ran against the permissions that existed AT THAT
-- TIME. Re-apply it explicitly for the two new rows so platform_admin isn't
-- silently missing them.
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'platform_admin'), id FROM cc_permissions
  WHERE key IN ('moderation.read', 'moderation.manage');

-- trust_safety_admin: content moderation is squarely a Trust & Safety
-- responsibility (it already owns vendor/provider suspension + disputes).
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'trust_safety_admin'), id FROM cc_permissions
  WHERE key IN ('moderation.read', 'moderation.manage');

-- content_admin: this role was seeded in migration 0050 with `audit.read`
-- ONLY, explicitly annotated "Reserved for future content/media moderation
-- capabilities. No implemented capability in Phase 1 beyond audit visibility."
-- That capability now exists — grant it here, replacing the placeholder scope.
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'content_admin'), id FROM cc_permissions
  WHERE key IN ('moderation.read', 'moderation.manage');

-- auditor: every *.read permission, per migration 0050's own rule
-- (`WHERE key LIKE '%.read'`) — re-applied explicitly for the new row since
-- that rule already ran once and will not retroactively pick up moderation.read.
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'auditor'), id FROM cc_permissions
  WHERE key = 'moderation.read';
