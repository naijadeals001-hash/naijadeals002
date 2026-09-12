/**
 * Reusable authorization middleware — Section 19's mandate: "Do not copy/
 * paste authorization logic into every route." Every vertical (NaijaEats,
 * NaijaStay, NaijaSend, NaijaDrive, Control Center, ...) imports FROM HERE,
 * never re-implements its own membership/permission check.
 *
 * SECURITY INVARIANT (Section 17, non-negotiable): organization_id is ALWAYS
 * read from the URL path param (c.req.param('organizationId')), then used to
 * look up a membership row keyed by the AUTHENTICATED session user's id
 * (c.get('user').id — set by attachUser, never client-supplied). A request
 * can name which organization it wants to act on, but it can never claim
 * "I am a member with role X" — that is resolved server-side, every time,
 * from organization_members. See src/lib/organizations.ts's resolveMembership
 * doc comment for why this makes cross-organization access structurally
 * impossible rather than merely "checked for" on a case-by-case basis.
 */
import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { resolveMembership, type MembershipResolution } from './organizations'

/**
 * Requires the authenticated user to be an ACTIVE member of the organization
 * named by the `organizationId` route param. On success, attaches the
 * resolution to c.set('orgMembership', ...) so downstream handlers/middleware
 * never re-query it. Mount AFTER requireAuth.
 */
export async function requireOrganizationMember(c: Context<AppEnv>, next: () => Promise<void>) {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Authentication required' }, 401)

  const organizationId = Number(c.req.param('organizationId'))
  if (!organizationId || Number.isNaN(organizationId)) return c.json({ error: 'Invalid organization id' }, 400)

  const resolution = await resolveMembership(c.env.DB, user.id, organizationId)
  if (!resolution) {
    // Deliberately the SAME response whether the organization doesn't exist
    // or the user simply isn't a member of it — never leak organization
    // existence to a non-member (Section 27: "organization enumeration").
    return c.json({ error: 'Organization not found' }, 404)
  }

  c.set('orgMembership', resolution)
  await next()
}

/**
 * Requires the resolved membership (see requireOrganizationMember, which
 * MUST run first) to have one of the given role keys. Use for owner-only
 * actions like ownership transfer or organization deletion.
 */
export function requireOrganizationRole(...roleKeys: string[]) {
  return async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const resolution = c.get('orgMembership') as MembershipResolution | undefined
    if (!resolution) return c.json({ error: 'Organization membership not resolved' }, 500)
    if (!roleKeys.includes(resolution.role.key)) {
      return c.json({ error: 'You do not have the required role for this action' }, 403)
    }
    await next()
  }
}

/**
 * Requires the resolved membership to carry a specific permission key (e.g.
 * 'orders.manage', 'staff.manage'). This is the primary authorization
 * primitive every vertical route should reach for — see Section 6/19's
 * examples (NaijaEats: requirePermission('orders.manage'), NaijaStay:
 * requirePermission('bookings.manage'), etc).
 */
export function requirePermission(permissionKey: string) {
  return async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const resolution = c.get('orgMembership') as MembershipResolution | undefined
    if (!resolution) return c.json({ error: 'Organization membership not resolved' }, 500)
    if (!resolution.permissionKeys.has(permissionKey)) {
      return c.json({ error: `Missing required permission: ${permissionKey}` }, 403)
    }
    await next()
  }
}

/**
 * Requires the authenticated user's PLATFORM role (users.role — distinct
 * from any organization role, per Section 7) to be one of the given values.
 * Use for Control Center / platform-operator-only endpoints.
 */
export function requirePlatformRole(...roles: string[]) {
  return async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Authentication required' }, 401)
    if (!roles.includes(user.role)) {
      return c.json({ error: 'You do not have permission to perform this action' }, 403)
    }
    await next()
  }
}
