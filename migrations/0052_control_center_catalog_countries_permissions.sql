-- Migration 0052: Control Center — Catalog (Collections/Category Attributes)
-- and Country-reference permissions.
--
-- ADR-001 Step 1 (docs/ADR-001-IMPLEMENTATION-PLAN.md §3): closes the
-- permission-key gap for 3 of the 17 orphan admin routes identified by
-- ADR-001's audit. This migration ONLY adds the missing permission rows +
-- role grants; it creates no new table, no new role, and touches no
-- business data. It does not re-gate any route (that is Step 2, separately
-- authorized) and does not implement any application behavior using these
-- permissions yet.
--
-- New permission keys:
--   catalog.read                  — view collections & category attributes
--   catalog.manage                — manage collections & category attributes
--   configuration.countries.read  — view country reference data
--
-- catalog.read / catalog.manage: no existing role is an obvious "catalog
-- admin" fit (ADR-001's own audit flagged this gap). Per Pat's explicit
-- decision (docs/ADR-001-IMPLEMENTATION-PLAN.md §0.5/§3.3): catalog
-- configuration is platform-wide and belongs with Platform Administration.
-- No new catalog_admin role is created — platform_admin is the sole
-- explicit grant recipient below (plus super_admin, which needs no grant
-- row at all — see note below).
--
-- configuration.countries.read: deliberately a distinct key from the
-- existing configuration.read (country reference data is operationally
-- distinct from platform-wide settings — ADR-001's audit explicitly did not
-- want every configuration.read holder to silently gain country-list
-- visibility). Granted to platform_admin, analytics_admin, and auditor.
--
-- CORRECTION TO THE IMPLEMENTATION PLAN'S STATED RATIONALE (found during
-- this migration's fresh pre-implementation verification, per the
-- authorization's explicit "do not rely solely on previous reports"
-- instruction): §3.3 of the implementation plan justified granting
-- configuration.countries.read to analytics_admin by claiming analytics_admin
-- "already holds configuration.read" (mirroring that existing grant). A live
-- query of this repository's actual cc_role_permissions data shows this is
-- NOT true — configuration.read is held only by super_admin, platform_admin,
-- and auditor (confirmed via migration 0050's own text, line 122 and line
-- 175-176). analytics_admin's only grants are audit.read and
-- system_health.read. The grant to analytics_admin below is still made,
-- because Pat's implementation-plan decision explicitly named analytics_admin
-- as a recipient of this specific new key (not a decision this migration is
-- authorized to second-guess) — but it is a deliberate widening of
-- analytics_admin's permission set, not a mechanical mirror of an existing
-- grant as the plan's text claimed. Flagged here, and separately in this
-- step's completion report, rather than silently corrected or silently
-- implemented as if the stated precedent were accurate.
--
-- super_admin does NOT need an explicit grant row here: control-center-rbac.ts's
-- resolveControlCenterAccess() already grants super_admin every permission
-- that exists in cc_permissions at request time (dynamic, not table-driven),
-- so these three new rows are automatically visible to super_admin the
-- moment this migration runs — no follow-up data fix needed for that role
-- (identical mechanism, and identical wording, to migration 0051's own note).

INSERT INTO cc_permissions (key, category, name, description) VALUES
  ('catalog.read',                  'catalog',    'View catalog',              'View collections and category attributes.'),
  ('catalog.manage',                'catalog',    'Manage catalog',            'Create, update, activate/deactivate and reorder collections; manage category attributes.'),
  ('configuration.countries.read',  'governance', 'View country configuration','View country reference data (supported countries and their settings).');

-- platform_admin already receives every permission except configuration.write
-- via its own `WHERE key != 'configuration.write'` seed rule in migration
-- 0050 — but that rule only ran against the permissions that existed AT THAT
-- TIME. Re-apply it explicitly for the three new rows so platform_admin
-- isn't silently missing them (identical pattern to migration 0051).
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'platform_admin'), id FROM cc_permissions
  WHERE key IN ('catalog.read', 'catalog.manage', 'configuration.countries.read');

-- analytics_admin: granted configuration.countries.read per Pat's explicit
-- implementation-plan decision (§3.3). See the correction note above — this
-- is a deliberate new grant, not a mirror of an existing configuration.read
-- grant (analytics_admin does not hold configuration.read).
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'analytics_admin'), id FROM cc_permissions
  WHERE key = 'configuration.countries.read';

-- auditor: every *.read permission, per migration 0050's own rule
-- (`WHERE key LIKE '%.read'`) — re-applied explicitly for the two new *.read
-- rows since that rule already ran once and will not retroactively pick up
-- catalog.read / configuration.countries.read. catalog.manage is
-- deliberately excluded (auditor is read-only by design — migration 0050's
-- own stated invariant, "zero write/manage/approve/suspend/verify").
INSERT INTO cc_role_permissions (role_id, permission_id)
  SELECT (SELECT id FROM cc_roles WHERE key = 'auditor'), id FROM cc_permissions
  WHERE key IN ('catalog.read', 'configuration.countries.read');
