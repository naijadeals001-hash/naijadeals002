/**
 * Enterprise Control Center — Phase 1: server-side authorization core.
 *
 * SECURITY BOUNDARY / AUTHENTICATION ARCHITECTURE (Phase 1 prompt Sections
 * 4-11): the Control Center is NOT a second identity system. It is a NEW
 * authorization layer stacked on top of Engine 1's existing, unmodified
 * identity/session infrastructure (src/lib/auth.ts):
 *
 *   Existing Identity (users) -> Existing Auth (sessions, attachUser) ->
 *   Authenticated Session (c.get('user')) -> Control Center Authorization
 *   (this file: does this user hold ANY cc_user_roles row?) -> Granular CC
 *   RBAC (this file: does the resolved permission set contain the specific
 *   key this route requires?) -> Privileged Operation.
 *
 * This file is the DIRECT structural analogue of src/lib/organizations.ts's
 * resolveMembership() + src/lib/rbac.ts's requirePermission() — same
 * shape, same anti-enumeration discipline, same "server resolves from the
 * authenticated session id, never trusts anything client-supplied" rule.
 * A request can never claim "I am a super_admin" — that is always resolved
 * fresh from cc_user_roles -> cc_roles -> cc_role_permissions ->
 * cc_permissions (migration 0013 schema, migration 0050 seed data).
 *
 * NO client-side/frontend-only gate is ever sufficient on its own: every
 * middleware here returns a genuine HTTP 401/403/404 from the SERVER when
 * access is denied — hiding a nav link or button is not authorization
 * (Phase 1 prompt Section 11).
 */
import type { Context } from 'hono'
import type { AppEnv } from '../types'

export interface ControlCenterAccessResolution {
  roleKeys: string[]
  permissionKeys: Set<string>
}

/**
 * Resolves the FULL set of Control Center roles + union of their granted
 * permissions for a given (already-authenticated) platform user id. Returns
 * null if the user holds zero cc_user_roles rows — i.e. is not a Control
 * Center user at all, regardless of their platform users.role value. This
 * is the single source of truth every CC authorization decision in this
 * codebase must call through; never re-implement this join elsewhere.
 *
 * super_admin implicitly receives every permission that exists NOW, without
 * requiring cc_role_permissions to be kept in sync for that role specifically
 * as new permissions are added — mirrors organizations.ts's resolveMembership
 * is_owner short-circuit exactly, for the identical reason (a future
 * permission should reach the platform's most senior role without a data
 * migration).
 */
export async function resolveControlCenterAccess(db: D1Database, userId: number): Promise<ControlCenterAccessResolution | null> {
  const roleRows = await db
    .prepare(
      `SELECT r.id, r.key
       FROM cc_user_roles ur
       JOIN cc_roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`
    )
    .bind(userId)
    .all<{ id: number; key: string }>()

  if (roleRows.results.length === 0) return null

  const roleKeys = roleRows.results.map((r) => r.key)
  const isSuperAdmin = roleKeys.includes('super_admin')

  if (isSuperAdmin) {
    const allPerms = await db.prepare('SELECT key FROM cc_permissions').all<{ key: string }>()
    return { roleKeys, permissionKeys: new Set(allPerms.results.map((p) => p.key)) }
  }

  const roleIds = roleRows.results.map((r) => r.id)
  const placeholders = roleIds.map(() => '?').join(',')
  const permRows = await db
    .prepare(
      `SELECT DISTINCT p.key
       FROM cc_role_permissions rp
       JOIN cc_permissions p ON p.id = rp.permission_id
       WHERE rp.role_id IN (${placeholders})`
    )
    .bind(...roleIds)
    .all<{ key: string }>()

  return { roleKeys, permissionKeys: new Set(permRows.results.map((p) => p.key)) }
}

/**
 * Hono middleware: requires (1) an authenticated Engine 1 session AND (2) at
 * least one cc_user_roles row for that user. Use as the FIRST gate on every
 * Control Center SSR page route. On success, attaches c.set('ccAccess', ...)
 * so downstream requireControlCenterPermission() never re-queries.
 *
 * A signed-in customer/vendor/provider with ZERO Control Center roles is
 * redirected to the SAME /control-center/login page a fully-unauthenticated
 * visitor would see (never a distinguishable "you're logged in but not
 * authorized" page that would confirm account existence to a prober) — this
 * mirrors requireOrganizationMember's non-member/non-existent
 * indistinguishability rule (Phase 0 Section 27's anti-enumeration
 * principle, applied to the Control Center itself).
 */
export async function requireControlCenterAuth(c: Context<AppEnv>, next: () => Promise<void>) {
  const user = c.get('user')
  if (!user) {
    const next_ = encodeURIComponent(c.req.path)
    return c.redirect(`/control-center/login?next=${next_}`)
  }
  const resolution = await resolveControlCenterAccess(c.env.DB, user.id)
  if (!resolution) {
    return c.redirect('/control-center/login?denied=1')
  }
  c.set('ccAccess', resolution)
  await next()
}

/**
 * API equivalent of requireControlCenterAuth — genuine 401/403 JSON
 * responses, never a redirect (Phase 1 prompt Section 4: "Unauthorized
 * access to Control Center... APIs... must receive a genuine server-side
 * authorization failure"). Every /api/control-center/* route MUST be gated
 * by this (or requireControlCenterPermission, which implies it) — a direct
 * curl/fetch to the API can never succeed merely because the SSR shell
 * happens to hide the link.
 */
export async function requireControlCenterApiAuth(c: Context<AppEnv>, next: () => Promise<void>) {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Authentication required' }, 401)
  const resolution = await resolveControlCenterAccess(c.env.DB, user.id)
  if (!resolution) return c.json({ error: 'You do not have Control Center access' }, 403)
  c.set('ccAccess', resolution)
  await next()
}

/**
 * Requires the resolved Control Center access (see requireControlCenterAuth /
 * requireControlCenterApiAuth, which MUST run first) to carry a specific
 * granular permission key (e.g. 'vendors.verify', 'refunds.approve'). This
 * is the primary authorization primitive every new Control Center route
 * should reach for — direct structural analogue of src/lib/rbac.ts's
 * requirePermission(). "Admin" is never a single all-or-nothing gate here:
 * a Control Center user with a role that lacks this permission gets a real
 * 403, even though they successfully passed requireControlCenterAuth.
 */
export function requireControlCenterPermission(permissionKey: string) {
  return async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const resolution = c.get('ccAccess') as ControlCenterAccessResolution | undefined
    if (!resolution) return c.json({ error: 'Control Center access not resolved' }, 500)
    if (!resolution.permissionKeys.has(permissionKey)) {
      return c.json({ error: `Missing required Control Center permission: ${permissionKey}` }, 403)
    }
    await next()
  }
}

/** Returns every cc_roles row (for admin-facing "assign a role" UI, once built — not exposed in Phase 1's shell, but the read primitive belongs here alongside everything else that touches cc_roles). */
export async function getAllControlCenterRoles(db: D1Database) {
  const { results } = await db.prepare('SELECT * FROM cc_roles ORDER BY id').all()
  return results
}

/** Returns every cc_permissions row grouped implicitly by category (caller can group client-side) — read-only reference data. */
export async function getAllControlCenterPermissions(db: D1Database) {
  const { results } = await db.prepare('SELECT * FROM cc_permissions ORDER BY category, key').all()
  return results
}
