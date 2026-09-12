/**
 * Organization API — Section 18's `/api/organizations/*` surface.
 *
 * Authorization pattern (Section 19, non-negotiable): every route below
 * mounts requireAuth first, then (for routes scoped to one organization)
 * requireOrganizationMember, which resolves membership from the
 * AUTHENTICATED session user's id joined through organization_members —
 * never from a client-supplied organization_id alone. See
 * src/lib/rbac.ts and src/lib/organizations.ts's resolveMembership doc
 * comments for why this makes cross-organization access structurally
 * impossible, not merely "checked for".
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { requireOrganizationMember, requireOrganizationRole, requirePermission } from '../lib/rbac'
import { getVendorForOrganization, createOrganizationStore, type CreateOrganizationStoreInput } from '../lib/stores'
import { resolveOrganizationProvider, createOrganizationProviderProfile, type CreateProviderProfileInput } from '../lib/providers'
import {
  createOrganization,
  getOrganizationById,
  getOrganizationsForUser,
  updateOrganizationProfile,
  getRolesForOrganization,
  getAllPermissions,
  getMembersForOrganization,
  changeMemberRole,
  suspendMember,
  reactivateMember,
  removeMember,
  transferOwnership,
  createInvitation,
  getInvitationsForOrganization,
  acceptInvitation,
  rejectInvitation,
  revokeInvitation,
  getAddressesForOrganization,
  createOrganizationAddress,
  getRoleById,
  LastOwnerError,
  InvitationError,
  type OrganizationAddressInput
} from '../lib/organizations'

export const organizationsApi = new Hono<AppEnv>()

organizationsApi.use('*', requireAuth)

// ---------- Organization CRUD ----------

/** Every organization the CURRENT authenticated user is an active member of. Never accepts a user_id param — always c.get('user'). */
organizationsApi.get('/', async (c) => {
  const user = c.get('user')!
  const organizations = await getOrganizationsForUser(c.env.DB, user.id)
  return c.json({ organizations })
})

organizationsApi.post('/', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ name?: string; organization_type?: string; country_iso?: string; contact_email?: string; contact_phone?: string }>().catch(() => null)
  if (!body?.name || !body.name.trim()) {
    return c.json({ error: 'Organization name is required' }, 400)
  }
  const organization = await createOrganization(c.env.DB, user.id, {
    name: body.name.trim(),
    organization_type: body.organization_type,
    country_iso: body.country_iso,
    contact_email: body.contact_email ?? null,
    contact_phone: body.contact_phone ?? null
  })
  return c.json({ success: true, organization })
})

organizationsApi.get('/:organizationId', requireOrganizationMember, async (c) => {
  const organization = await getOrganizationById(c.env.DB, Number(c.req.param('organizationId')))
  const membership = c.get('orgMembership')!
  return c.json({ organization, role: membership.role.key, permissions: Array.from(membership.permissionKeys) })
})

organizationsApi.patch('/:organizationId', requireOrganizationMember, requirePermission('organization.manage'), async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)
  await updateOrganizationProfile(c.env.DB, organizationId, {
    name: body.name,
    display_name: body.display_name,
    description: body.description,
    contact_email: body.contact_email,
    contact_phone: body.contact_phone,
    website: body.website,
    logo_url: body.logo_url
  })
  const organization = await getOrganizationById(c.env.DB, organizationId)
  return c.json({ success: true, organization })
})

// ---------- Roles & permissions ----------

organizationsApi.get('/:organizationId/roles', requireOrganizationMember, async (c) => {
  const roles = await getRolesForOrganization(c.env.DB, Number(c.req.param('organizationId')))
  return c.json({ roles })
})

organizationsApi.get('/:organizationId/permissions', requireOrganizationMember, async (c) => {
  const permissions = await getAllPermissions(c.env.DB)
  return c.json({ permissions })
})

// ---------- Members ----------

organizationsApi.get('/:organizationId/members', requireOrganizationMember, requirePermission('members.manage'), async (c) => {
  const members = await getMembersForOrganization(c.env.DB, Number(c.req.param('organizationId')))
  return c.json({ members })
})

organizationsApi.patch('/:organizationId/members/:memberId', requireOrganizationMember, requirePermission('members.manage'), async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const memberId = Number(c.req.param('memberId'))
  const body = await c.req.json<{ role_id?: number; status?: 'active' | 'suspended' }>().catch(() => null)

  try {
    if (body?.role_id) {
      const role = await getRoleById(c.env.DB, body.role_id)
      if (!role || (role.organization_id !== null && role.organization_id !== organizationId)) {
        return c.json({ error: 'Invalid role for this organization' }, 400)
      }
      await changeMemberRole(c.env.DB, organizationId, memberId, body.role_id)
    }
    if (body?.status === 'suspended') {
      await suspendMember(c.env.DB, organizationId, memberId)
    } else if (body?.status === 'active') {
      await reactivateMember(c.env.DB, organizationId, memberId)
    }
  } catch (err) {
    if (err instanceof LastOwnerError) return c.json({ error: err.message }, 409)
    if (err instanceof Error) return c.json({ error: err.message }, 400)
    throw err
  }

  const members = await getMembersForOrganization(c.env.DB, organizationId)
  return c.json({ success: true, members })
})

organizationsApi.delete('/:organizationId/members/:memberId', requireOrganizationMember, requirePermission('members.manage'), async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const memberId = Number(c.req.param('memberId'))
  try {
    await removeMember(c.env.DB, organizationId, memberId)
  } catch (err) {
    if (err instanceof LastOwnerError) return c.json({ error: err.message }, 409)
    if (err instanceof Error) return c.json({ error: err.message }, 400)
    throw err
  }
  const members = await getMembersForOrganization(c.env.DB, organizationId)
  return c.json({ success: true, members })
})

/** Ownership transfer — owner-only action (Section 5), enforced via requireOrganizationRole('owner') on top of membership resolution. */
organizationsApi.post('/:organizationId/transfer-ownership', requireOrganizationMember, requireOrganizationRole('owner'), async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const membership = c.get('orgMembership')!
  const body = await c.req.json<{ new_owner_user_id?: number }>().catch(() => null)
  if (!body?.new_owner_user_id) return c.json({ error: 'new_owner_user_id is required' }, 400)

  try {
    await transferOwnership(c.env.DB, organizationId, membership.member.id, body.new_owner_user_id)
  } catch (err) {
    if (err instanceof Error) return c.json({ error: err.message }, 400)
    throw err
  }
  return c.json({ success: true })
})

// ---------- Invitations ----------

organizationsApi.get('/:organizationId/invitations', requireOrganizationMember, requirePermission('members.manage'), async (c) => {
  const invitations = await getInvitationsForOrganization(c.env.DB, Number(c.req.param('organizationId')))
  // Never expose token_hash — same "never expose session secrets" principle (Section 14) applied to invitation tokens.
  return c.json({ invitations: invitations.map(({ token_hash, ...rest }) => rest) })
})

organizationsApi.post('/:organizationId/invitations', requireOrganizationMember, requirePermission('members.manage'), async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const user = c.get('user')!
  const body = await c.req.json<{ email?: string; phone?: string; role_id?: number }>().catch(() => null)
  if (!body?.role_id) return c.json({ error: 'role_id is required' }, 400)
  if (!body.email && !body.phone) return c.json({ error: 'An email or phone number is required' }, 400)

  const role = await getRoleById(c.env.DB, body.role_id)
  if (!role || (role.organization_id !== null && role.organization_id !== organizationId)) {
    return c.json({ error: 'Invalid role for this organization' }, 400)
  }

  try {
    const { invitation, rawToken } = await createInvitation(c.env.DB, organizationId, user.id, {
      email: body.email ?? null,
      phone: body.phone ?? null,
      roleId: body.role_id
    })
    // rawToken is returned ONCE, here, to the inviter (who is expected to relay it via
    // an email/SMS delivery channel — not yet wired to a real mailer in this checkpoint).
    // It is never persisted anywhere except as its SHA-256 hash (token_hash).
    const { token_hash, ...invitationPublic } = invitation
    return c.json({ success: true, invitation: invitationPublic, invite_token: rawToken })
  } catch (err) {
    if (err instanceof Error) return c.json({ error: err.message }, 409)
    throw err
  }
})

organizationsApi.post('/:organizationId/invitations/:invitationId/revoke', requireOrganizationMember, requirePermission('members.manage'), async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const invitationId = Number(c.req.param('invitationId'))
  try {
    await revokeInvitation(c.env.DB, organizationId, invitationId)
  } catch (err) {
    if (err instanceof InvitationError) return c.json({ error: err.message }, 400)
    throw err
  }
  return c.json({ success: true })
})

/**
 * Accepting an invitation is NOT scoped by requireOrganizationMember (the
 * accepting user is, by definition, not yet a member) — it only requires
 * requireAuth (mounted above) plus a valid raw token, matched by its hash.
 */
organizationsApi.post('/invitations/accept', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ token?: string }>().catch(() => null)
  if (!body?.token) return c.json({ error: 'token is required' }, 400)
  try {
    const member = await acceptInvitation(c.env.DB, body.token, user.id)
    return c.json({ success: true, member })
  } catch (err) {
    if (err instanceof InvitationError) return c.json({ error: err.message }, 400)
    throw err
  }
})

organizationsApi.post('/invitations/reject', async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => null)
  if (!body?.token) return c.json({ error: 'token is required' }, 400)
  try {
    await rejectInvitation(c.env.DB, body.token)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof InvitationError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// ---------- Organization addresses ----------

organizationsApi.get('/:organizationId/addresses', requireOrganizationMember, async (c) => {
  const addresses = await getAddressesForOrganization(c.env.DB, Number(c.req.param('organizationId')))
  return c.json({ addresses })
})

organizationsApi.post('/:organizationId/addresses', requireOrganizationMember, requirePermission('settings.manage'), async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const body = await c.req.json<Partial<OrganizationAddressInput>>().catch(() => null)
  if (!body?.recipient_name || !body?.phone || !body?.line1 || !body?.city) {
    return c.json({ error: 'recipient_name, phone, line1 and city are required' }, 400)
  }
  const addressId = await createOrganizationAddress(c.env.DB, organizationId, body as OrganizationAddressInput)
  const addresses = await getAddressesForOrganization(c.env.DB, organizationId)
  return c.json({ success: true, addressId, addresses })
})

// ---------- Marketplace store (Marketplace Engine 2.0, spec section 4) ----------
// The vendor<->organization bridge: an organization can own ONE marketplace
// store. Creation requires 'store.manage' (granted to owner/admin/manager
// by migration 0038's seed) — resolved via the SAME requireOrganizationMember
// + requirePermission primitives every other organization route uses, never
// a bespoke check.

organizationsApi.get('/:organizationId/store', requireOrganizationMember, async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const vendor = await getVendorForOrganization(c.env.DB, organizationId)
  if (!vendor) return c.json({ store: null })
  return c.json({ store: vendor })
})

organizationsApi.post('/:organizationId/store', requireOrganizationMember, requirePermission('store.manage'), async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const body = await c.req.json<Partial<CreateOrganizationStoreInput>>().catch(() => null)
  if (!body?.name) return c.json({ error: 'name is required' }, 400)
  try {
    const vendorId = await createOrganizationStore(c.env.DB, organizationId, body as CreateOrganizationStoreInput)
    const vendor = await getVendorForOrganization(c.env.DB, organizationId)
    return c.json({ success: true, vendorId, store: vendor }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create store' }, 400)
  }
})

// ---------- Service provider bridge (Service Engine 2.0, spec section 2) ----------
// The provider_profiles<->organization bridge: an organization can own ONE
// service provider profile. Creation requires 'services.manage' — already
// seeded and granted to owner/admin/manager by migration 0037 (discovered
// during Service Engine inspection: zero NEW permission-seeding SQL was
// needed for this, unlike the Marketplace Engine's store.manage).

organizationsApi.get('/:organizationId/provider', requireOrganizationMember, async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const provider = await resolveOrganizationProvider(c.env.DB, c.get('user')!.id, organizationId)
  return c.json({ provider })
})

organizationsApi.post('/:organizationId/provider', requireOrganizationMember, requirePermission('services.manage'), async (c) => {
  const organizationId = Number(c.req.param('organizationId'))
  const body = await c.req.json<Partial<CreateProviderProfileInput>>().catch(() => null)
  if (!body?.display_name) return c.json({ error: 'display_name is required' }, 400)
  try {
    const providerId = await createOrganizationProviderProfile(c.env.DB, organizationId, body as CreateProviderProfileInput)
    const provider = await resolveOrganizationProvider(c.env.DB, c.get('user')!.id, organizationId)
    return c.json({ success: true, providerId, provider }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create service provider profile' }, 400)
  }
})
