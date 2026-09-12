/**
 * Organization / Account Engine 2.0 — core data-access layer.
 *
 * DATABASE CONTRACT: migration 0037_identity_organization_engine.sql. See
 * that file's header for the full compatibility rationale (zero changes to
 * users/sessions/addresses/vendors core columns; organizations are a NEW,
 * additive layer, never a replacement for the existing person <-> vendor
 * bridge from migration 0009).
 *
 * OWNERSHIP RULE (mirrors src/lib/seller.ts's non-negotiable pattern): every
 * function that resolves "does this user have access to this organization"
 * takes the AUTHENTICATED user's id as an explicit parameter and joins
 * through organization_members — it is structurally impossible to answer
 * "what can I do in org X" without supplying a real (session-derived)
 * user_id. Route handlers must NEVER trust a client-supplied user_id here;
 * see src/lib/rbac.ts for the middleware that enforces this at the HTTP layer.
 */
import type {
  OrganizationRow,
  OrganizationMemberRow,
  OrganizationRoleRow,
  OrganizationInvitationRow,
  OrganizationAddressRow,
  OrganizationPermissionRow
} from '../types'

// ---------- Organizations ----------

export async function createOrganization(
  db: D1Database,
  creatorUserId: number,
  input: { name: string; organization_type?: string; country_iso?: string; contact_email?: string | null; contact_phone?: string | null }
): Promise<OrganizationRow> {
  const inserted = await db
    .prepare(
      `INSERT INTO organizations (name, organization_type, country_iso, contact_email, contact_phone, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.name,
      input.organization_type ?? 'business',
      input.country_iso ?? 'NG',
      input.contact_email ?? null,
      input.contact_phone ?? null,
      creatorUserId
    )
    .run()
  const orgId = inserted.meta.last_row_id as number

  // The creator becomes the organization's first member with the system
  // 'owner' role, is_owner=1 — never a separate "create then invite yourself" step.
  const ownerRole = await getSystemRoleByKey(db, 'owner')
  await db
    .prepare(
      `INSERT INTO organization_members (organization_id, user_id, role_id, status, is_owner, joined_at)
       VALUES (?, ?, ?, 'active', 1, datetime('now'))`
    )
    .bind(orgId, creatorUserId, ownerRole!.id)
    .run()

  const org = await getOrganizationById(db, orgId)
  return org!
}

export async function getOrganizationById(db: D1Database, organizationId: number): Promise<OrganizationRow | null> {
  const row = await db.prepare('SELECT * FROM organizations WHERE id = ?').bind(organizationId).first<OrganizationRow>()
  return row ?? null
}

/** Every organization a user is an active member of, most-recently-joined first. */
export async function getOrganizationsForUser(db: D1Database, userId: number): Promise<(OrganizationRow & { member_role_key: string; is_owner: number })[]> {
  const { results } = await db
    .prepare(
      `SELECT o.*, r.key AS member_role_key, m.is_owner
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
       JOIN organization_roles r ON r.id = m.role_id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY m.joined_at DESC`
    )
    .bind(userId)
    .all<OrganizationRow & { member_role_key: string; is_owner: number }>()
  return results
}

export async function updateOrganizationProfile(
  db: D1Database,
  organizationId: number,
  input: Partial<{ name: string; display_name: string | null; description: string; contact_email: string | null; contact_phone: string | null; website: string | null; logo_url: string | null }>
): Promise<void> {
  const fields: string[] = []
  const values: any[] = []
  for (const [key, value] of Object.entries(input)) {
    fields.push(`${key} = ?`)
    values.push(value)
  }
  if (fields.length === 0) return
  fields.push(`updated_at = datetime('now')`)
  await db.prepare(`UPDATE organizations SET ${fields.join(', ')} WHERE id = ?`).bind(...values, organizationId).run()
}

// ---------- Roles & permissions ----------

export async function getSystemRoleByKey(db: D1Database, key: string): Promise<OrganizationRoleRow | null> {
  const row = await db.prepare('SELECT * FROM organization_roles WHERE organization_id IS NULL AND key = ?').bind(key).first<OrganizationRoleRow>()
  return row ?? null
}

export async function getRoleById(db: D1Database, roleId: number): Promise<OrganizationRoleRow | null> {
  const row = await db.prepare('SELECT * FROM organization_roles WHERE id = ?').bind(roleId).first<OrganizationRoleRow>()
  return row ?? null
}

/** Roles usable by an organization: every system role, plus any custom role that organization has defined. */
export async function getRolesForOrganization(db: D1Database, organizationId: number): Promise<OrganizationRoleRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM organization_roles WHERE organization_id IS NULL OR organization_id = ? ORDER BY is_system DESC, id ASC')
    .bind(organizationId)
    .all<OrganizationRoleRow>()
  return results
}

export async function getPermissionsForRole(db: D1Database, roleId: number): Promise<OrganizationPermissionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.* FROM organization_permissions p
       JOIN organization_role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?`
    )
    .bind(roleId)
    .all<OrganizationPermissionRow>()
  return results
}

export async function getAllPermissions(db: D1Database): Promise<OrganizationPermissionRow[]> {
  const { results } = await db.prepare('SELECT * FROM organization_permissions ORDER BY category, key').all<OrganizationPermissionRow>()
  return results
}

// ---------- Membership resolution (the core "can this user do X in org Y" primitive) ----------

export interface MembershipResolution {
  member: OrganizationMemberRow
  role: OrganizationRoleRow
  permissionKeys: Set<string>
}

/**
 * Resolves an ACTIVE membership for (userId, organizationId), or null if the
 * user has no active membership in that organization — this null result is
 * exactly what makes cross-organization access structurally impossible: a
 * member of Org A querying Org B's data always resolves to null here, and
 * every route built on top of this (src/lib/rbac.ts) treats null as a hard
 * 403/404, never falling through to "assume access".
 */
export async function resolveMembership(db: D1Database, userId: number, organizationId: number): Promise<MembershipResolution | null> {
  const member = await db
    .prepare(`SELECT * FROM organization_members WHERE user_id = ? AND organization_id = ? AND status = 'active'`)
    .bind(userId, organizationId)
    .first<OrganizationMemberRow>()
  if (!member) return null

  const role = await getRoleById(db, member.role_id)
  if (!role) return null

  // The owner implicitly has every permission that exists, now and in the
  // future, without needing organization_role_permissions rows kept in sync
  // (see migration 0037's seed comment) — this is a deliberate, explicit
  // short-circuit, not an accidental "owner can do everything" bug.
  if (member.is_owner) {
    const all = await getAllPermissions(db)
    return { member, role, permissionKeys: new Set(all.map((p) => p.key)) }
  }

  const permissions = await getPermissionsForRole(db, role.id)
  return { member, role, permissionKeys: new Set(permissions.map((p) => p.key)) }
}

// ---------- Membership lifecycle ----------

export async function getMembersForOrganization(db: D1Database, organizationId: number): Promise<(OrganizationMemberRow & { user_name: string; user_email: string | null; role_key: string; role_name: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT m.*, u.name AS user_name, u.email AS user_email, r.key AS role_key, r.name AS role_name
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       JOIN organization_roles r ON r.id = m.role_id
       WHERE m.organization_id = ? AND m.status != 'removed'
       ORDER BY m.is_owner DESC, m.created_at ASC`
    )
    .bind(organizationId)
    .all<any>()
  return results
}

export class LastOwnerError extends Error {
  constructor() {
    super('An organization must always have at least one owner')
    this.name = 'LastOwnerError'
  }
}

async function countActiveOwners(db: D1Database, organizationId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM organization_members WHERE organization_id = ? AND is_owner = 1 AND status = 'active'`)
    .bind(organizationId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** Changes a member's role. Guards against demoting/removing the last remaining owner (Section 5). */
export async function changeMemberRole(db: D1Database, organizationId: number, memberId: number, newRoleId: number): Promise<void> {
  const member = await db.prepare('SELECT * FROM organization_members WHERE id = ? AND organization_id = ?').bind(memberId, organizationId).first<OrganizationMemberRow>()
  if (!member) throw new Error('Member not found')

  const newRole = await getRoleById(db, newRoleId)
  if (!newRole) throw new Error('Role not found')
  const becomingOwner = newRole.key === 'owner'

  if (member.is_owner && !becomingOwner) {
    const owners = await countActiveOwners(db, organizationId)
    if (owners <= 1) throw new LastOwnerError()
  }

  await db
    .prepare(`UPDATE organization_members SET role_id = ?, is_owner = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(newRoleId, becomingOwner ? 1 : 0, memberId)
    .run()
}

/** Suspends a member (status='suspended'). Guards against suspending the last owner. */
export async function suspendMember(db: D1Database, organizationId: number, memberId: number): Promise<void> {
  const member = await db.prepare('SELECT * FROM organization_members WHERE id = ? AND organization_id = ?').bind(memberId, organizationId).first<OrganizationMemberRow>()
  if (!member) throw new Error('Member not found')
  if (member.is_owner) {
    const owners = await countActiveOwners(db, organizationId)
    if (owners <= 1) throw new LastOwnerError()
  }
  await db.prepare(`UPDATE organization_members SET status = 'suspended', updated_at = datetime('now') WHERE id = ?`).bind(memberId).run()
}

export async function reactivateMember(db: D1Database, organizationId: number, memberId: number): Promise<void> {
  await db
    .prepare(`UPDATE organization_members SET status = 'active', updated_at = datetime('now') WHERE id = ? AND organization_id = ?`)
    .bind(memberId, organizationId)
    .run()
}

/** Removes (soft-deletes) a member. Guards against removing the last owner. */
export async function removeMember(db: D1Database, organizationId: number, memberId: number): Promise<void> {
  const member = await db.prepare('SELECT * FROM organization_members WHERE id = ? AND organization_id = ?').bind(memberId, organizationId).first<OrganizationMemberRow>()
  if (!member) throw new Error('Member not found')
  if (member.is_owner) {
    const owners = await countActiveOwners(db, organizationId)
    if (owners <= 1) throw new LastOwnerError()
  }
  await db
    .prepare(`UPDATE organization_members SET status = 'removed', removed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .bind(memberId)
    .run()
}

/**
 * Transfers ownership to another ACTIVE member of the SAME organization.
 * The previous owner is demoted to 'admin' (never left ownerless, never
 * silently removed) — an explicit two-step operation (demote old owner,
 * promote new owner) executed atomically via db.batch so a crash between
 * the two writes can never leave an organization with zero OR two owners
 * in the is_owner=1 sense for this pair.
 */
export async function transferOwnership(db: D1Database, organizationId: number, currentOwnerMemberId: number, newOwnerUserId: number): Promise<void> {
  const currentOwner = await db.prepare('SELECT * FROM organization_members WHERE id = ? AND organization_id = ?').bind(currentOwnerMemberId, organizationId).first<OrganizationMemberRow>()
  if (!currentOwner || !currentOwner.is_owner) throw new Error('Only the current owner can transfer ownership')

  const newOwnerMember = await db
    .prepare(`SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`)
    .bind(organizationId, newOwnerUserId)
    .first<OrganizationMemberRow>()
  if (!newOwnerMember) throw new Error('The new owner must already be an active member of this organization')

  const adminRole = await getSystemRoleByKey(db, 'admin')
  const ownerRole = await getSystemRoleByKey(db, 'owner')

  await db.batch([
    db.prepare(`UPDATE organization_members SET role_id = ?, is_owner = 0, updated_at = datetime('now') WHERE id = ?`).bind(adminRole!.id, currentOwner.id),
    db.prepare(`UPDATE organization_members SET role_id = ?, is_owner = 1, updated_at = datetime('now') WHERE id = ?`).bind(ownerRole!.id, newOwnerMember.id)
  ])
}

// ---------- Invitations ----------

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const INVITATION_EXPIRY_DAYS = 7

/**
 * Creates an invitation. Prevents duplicate-invite and already-member abuse
 * (Section 16): if the email already belongs to an active member of this
 * organization, or already has a pending invitation, this throws instead of
 * creating a redundant row — callers surface this as a 409.
 */
export async function createInvitation(
  db: D1Database,
  organizationId: number,
  invitedByUserId: number,
  input: { email?: string | null; phone?: string | null; roleId: number }
): Promise<{ invitation: OrganizationInvitationRow; rawToken: string }> {
  if (!input.email && !input.phone) throw new Error('An email or phone number is required')

  if (input.email) {
    const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').bind(input.email).first<{ id: number }>()
    if (existingUser) {
      const existingMember = await db
        .prepare(`SELECT id FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`)
        .bind(organizationId, existingUser.id)
        .first<{ id: number }>()
      if (existingMember) throw new Error('This person is already a member of the organization')
    }
    const pending = await db
      .prepare(`SELECT id FROM organization_invitations WHERE organization_id = ? AND invited_email = ? AND status = 'pending'`)
      .bind(organizationId, input.email)
      .first<{ id: number }>()
    if (pending) throw new Error('An invitation is already pending for this email')
  }

  const rawToken = randomToken()
  const tokenHash = await sha256Hex(rawToken)
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const inserted = await db
    .prepare(
      `INSERT INTO organization_invitations (organization_id, role_id, invited_email, invited_phone, invited_by_user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(organizationId, input.roleId, input.email ?? null, input.phone ?? null, invitedByUserId, tokenHash, expiresAt)
    .run()

  const invitation = await db.prepare('SELECT * FROM organization_invitations WHERE id = ?').bind(inserted.meta.last_row_id).first<OrganizationInvitationRow>()
  return { invitation: invitation!, rawToken }
}

export async function getInvitationsForOrganization(db: D1Database, organizationId: number): Promise<OrganizationInvitationRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM organization_invitations WHERE organization_id = ? ORDER BY created_at DESC')
    .bind(organizationId)
    .all<OrganizationInvitationRow>()
  return results
}

async function getInvitationByToken(db: D1Database, rawToken: string): Promise<OrganizationInvitationRow | null> {
  const tokenHash = await sha256Hex(rawToken)
  const row = await db.prepare('SELECT * FROM organization_invitations WHERE token_hash = ?').bind(tokenHash).first<OrganizationInvitationRow>()
  return row ?? null
}

export class InvitationError extends Error {}

/**
 * Accepts an invitation on behalf of an authenticated user. Never creates a
 * duplicate user — the invitee must already have (or just have created) a
 * NaijaDeals account and be signed in; this only ever creates/reactivates an
 * organization_members row for their EXISTING user_id.
 */
export async function acceptInvitation(db: D1Database, rawToken: string, acceptingUserId: number): Promise<OrganizationMemberRow> {
  const invitation = await getInvitationByToken(db, rawToken)
  if (!invitation) throw new InvitationError('Invitation not found')
  if (invitation.status !== 'pending') throw new InvitationError(`This invitation is ${invitation.status}`)
  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    await db.prepare(`UPDATE organization_invitations SET status = 'expired' WHERE id = ?`).bind(invitation.id).run()
    throw new InvitationError('This invitation has expired')
  }

  const existingMember = await db
    .prepare('SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ?')
    .bind(invitation.organization_id, acceptingUserId)
    .first<OrganizationMemberRow>()

  let member: OrganizationMemberRow
  if (existingMember) {
    // Re-invited after removal, or invited twice — reactivate the existing row rather than violate the UNIQUE(organization_id, user_id) constraint.
    await db
      .prepare(`UPDATE organization_members SET role_id = ?, status = 'active', joined_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .bind(invitation.role_id, existingMember.id)
      .run()
    member = { ...existingMember, role_id: invitation.role_id, status: 'active' }
  } else {
    const inserted = await db
      .prepare(
        `INSERT INTO organization_members (organization_id, user_id, role_id, status, invited_by_user_id, joined_at)
         VALUES (?, ?, ?, 'active', ?, datetime('now'))`
      )
      .bind(invitation.organization_id, acceptingUserId, invitation.role_id, invitation.invited_by_user_id)
      .run()
    member = (await db.prepare('SELECT * FROM organization_members WHERE id = ?').bind(inserted.meta.last_row_id).first<OrganizationMemberRow>())!
  }

  await db
    .prepare(`UPDATE organization_invitations SET status = 'accepted', accepted_by_user_id = ?, accepted_at = datetime('now') WHERE id = ?`)
    .bind(acceptingUserId, invitation.id)
    .run()

  return member
}

export async function rejectInvitation(db: D1Database, rawToken: string): Promise<void> {
  const invitation = await getInvitationByToken(db, rawToken)
  if (!invitation || invitation.status !== 'pending') throw new InvitationError('Invitation not found or already resolved')
  await db.prepare(`UPDATE organization_invitations SET status = 'rejected' WHERE id = ?`).bind(invitation.id).run()
}

/** Revokes a pending invitation. Scoped by organizationId so one org can never revoke another org's invitation by guessing an id. */
export async function revokeInvitation(db: D1Database, organizationId: number, invitationId: number): Promise<void> {
  const invitation = await db.prepare('SELECT * FROM organization_invitations WHERE id = ? AND organization_id = ?').bind(invitationId, organizationId).first<OrganizationInvitationRow>()
  if (!invitation) throw new InvitationError('Invitation not found')
  if (invitation.status !== 'pending') throw new InvitationError(`Cannot revoke an invitation that is already ${invitation.status}`)
  await db.prepare(`UPDATE organization_invitations SET status = 'revoked' WHERE id = ?`).bind(invitationId).run()
}

// ---------- Organization addresses ----------

export async function getAddressesForOrganization(db: D1Database, organizationId: number): Promise<OrganizationAddressRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM organization_addresses WHERE organization_id = ? ORDER BY is_default DESC, id DESC')
    .bind(organizationId)
    .all<OrganizationAddressRow>()
  return results
}

export interface OrganizationAddressInput {
  address_type?: 'business' | 'billing' | 'shipping' | 'pickup' | 'service'
  label?: string
  recipient_name: string
  phone: string
  line1: string
  line2?: string | null
  city: string
  state_region?: string | null
  postal_code?: string | null
  country_iso?: string
  is_default?: boolean
}

export async function createOrganizationAddress(db: D1Database, organizationId: number, input: OrganizationAddressInput): Promise<number> {
  if (input.is_default) {
    await db.prepare('UPDATE organization_addresses SET is_default = 0 WHERE organization_id = ?').bind(organizationId).run()
  }
  const result = await db
    .prepare(
      `INSERT INTO organization_addresses (organization_id, address_type, label, recipient_name, phone, line1, line2, city, state_region, postal_code, country_iso, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      organizationId,
      input.address_type ?? 'business',
      input.label ?? 'Main',
      input.recipient_name,
      input.phone,
      input.line1,
      input.line2 ?? null,
      input.city,
      input.state_region ?? null,
      input.postal_code ?? null,
      input.country_iso ?? 'NG',
      input.is_default ? 1 : 0
    )
    .run()
  return result.meta.last_row_id as number
}
