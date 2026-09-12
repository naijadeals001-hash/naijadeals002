/**
 * Service Engine 2.0 — Provider identity resolution (spec sections 2 & 3).
 *
 * Mirrors src/lib/seller.ts's resolveSellerStatus/requireActiveSeller
 * pattern exactly, for the SAME reason: the provider row is ALWAYS looked
 * up by the AUTHENTICATED user's id (or, for organization-owned providers,
 * by a server-resolved active organization membership) — never by a
 * provider_profile_id supplied by the client. This is what makes
 * "Provider A cannot access Provider B's private requests/quotes/orders"
 * true by construction.
 *
 * Reuses the EXISTING provider_profiles table (migration 0025) — every
 * Service Engine provider registers with provider_type='gig_provider'
 * (the existing CHECK constraint's generic "provides a bookable service"
 * value) and is further categorized via the NEW primary_category_id column
 * (migration 0039). This is NOT a new identity system — see migration
 * 0039's header comment for why a new provider_type enum value was
 * deliberately avoided.
 */
import type { Context } from 'hono'
import type { AppEnv, ProviderProfileRow } from '../types'
import { resolveMembership } from './organizations'

export type ProviderState = 'NO_PROVIDER' | 'ONBOARDING' | 'PENDING_VERIFICATION' | 'SUSPENDED' | 'ACTIVE_PROVIDER'

export interface ProviderResolution {
  state: ProviderState
  provider: ProviderProfileRow | null
}

/** Looks up the gig_provider profile owned by the given authenticated user id. userId MUST come from c.get('user').id — never client input. */
export async function resolveProviderStatus(db: D1Database, userId: number): Promise<ProviderResolution> {
  const provider = await db
    .prepare(`SELECT * FROM provider_profiles WHERE user_id = ? AND provider_type = 'gig_provider'`)
    .bind(userId)
    .first<ProviderProfileRow>()

  if (!provider) return { state: 'NO_PROVIDER', provider: null }
  if (provider.operational_status === 'suspended') return { state: 'SUSPENDED', provider }
  if (!provider.onboarding_completed_at) return { state: 'ONBOARDING', provider }
  if (provider.verification_status === 'pending') return { state: 'PENDING_VERIFICATION', provider }
  return { state: 'ACTIVE_PROVIDER', provider }
}

export async function resolveProviderStatusForRequest(c: Context<AppEnv>): Promise<ProviderResolution> {
  const user = c.get('user')
  if (!user) return { state: 'NO_PROVIDER', provider: null }
  return resolveProviderStatus(c.env.DB, user.id)
}

/** Hono middleware for provider-area routes. Attaches c.set('providerProfile', provider) on success. */
export async function requireActiveProvider(c: Context<AppEnv>, next: () => Promise<void>) {
  const user = c.get('user')
  if (!user) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`)
  const { state, provider } = await resolveProviderStatus(c.env.DB, user.id)
  if (state !== 'ACTIVE_PROVIDER' || !provider) return c.redirect('/gigs/provider')
  c.set('providerProfile', provider)
  await next()
}

export interface CreateProviderProfileInput {
  display_name: string
  bio?: string
  contact_email?: string | null
  contact_phone?: string | null
  country_iso?: string
  primary_category_id?: number | null
}

/** Creates a new gig_provider profile for the authenticated user. One per user (UNIQUE(user_id, provider_type) already enforced by migration 0025). */
export async function createProviderProfile(db: D1Database, userId: number, input: CreateProviderProfileInput): Promise<number> {
  const existing = await db
    .prepare(`SELECT id FROM provider_profiles WHERE user_id = ? AND provider_type = 'gig_provider'`)
    .bind(userId)
    .first<{ id: number }>()
  if (existing) throw new Error('You already have a service provider profile.')

  const result = await db
    .prepare(
      `INSERT INTO provider_profiles
        (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, primary_category_id,
         verification_status, operational_status, onboarding_completed_at)
       VALUES (?, 'gig_provider', ?, ?, ?, ?, ?, ?, 'verified', 'active', datetime('now'))`
    )
    .bind(
      userId,
      input.display_name,
      input.bio ?? '',
      input.contact_email ?? null,
      input.contact_phone ?? null,
      input.country_iso ?? 'NG',
      input.primary_category_id ?? null
    )
    .run()

  const providerId = Number(result.meta.last_row_id)

  // Every provider gets one implicit resource row (spec section 15: "a
  // single-person provider gets exactly one implicit resource") so
  // availability/booking logic never special-cases "no resources yet".
  await db
    .prepare(`INSERT INTO service_resources (provider_profile_id, name, role_title) VALUES (?, ?, 'Primary')`)
    .bind(providerId, input.display_name)
    .run()

  return providerId
}

/**
 * Resolves the acting provider for an organization-owned service business
 * (spec section 2: provider identity should reference the Identity Engine).
 * Requires an ACTIVE membership with 'services.manage' permission — reuses
 * organizations.ts's resolveMembership, never a duplicate auth check.
 */
export async function resolveOrganizationProvider(db: D1Database, userId: number, organizationId: number): Promise<ProviderProfileRow | null> {
  const membership = await resolveMembership(db, userId, organizationId)
  if (!membership || !membership.permissionKeys.has('services.manage')) return null
  return db
    .prepare(`SELECT * FROM provider_profiles WHERE identity_organization_id = ? AND provider_type = 'gig_provider'`)
    .bind(organizationId)
    .first<ProviderProfileRow>()
}

export async function createOrganizationProviderProfile(db: D1Database, organizationId: number, input: CreateProviderProfileInput): Promise<number> {
  const existing = await db
    .prepare(`SELECT id FROM provider_profiles WHERE identity_organization_id = ? AND provider_type = 'gig_provider'`)
    .bind(organizationId)
    .first<{ id: number }>()
  if (existing) throw new Error('This organization already has a service provider profile.')

  // provider_profiles.user_id is NOT NULL — for an organization-owned
  // provider we still need a "creator" user_id for referential purposes;
  // the actual authorization for who can manage it goes through
  // identity_organization_id + resolveOrganizationProvider, never user_id.
  const org = await db.prepare('SELECT created_by_user_id FROM organizations WHERE id = ?').bind(organizationId).first<{ created_by_user_id: number }>()
  if (!org) throw new Error('Organization not found')

  const result = await db
    .prepare(
      `INSERT INTO provider_profiles
        (user_id, provider_type, identity_organization_id, display_name, bio, contact_email, contact_phone, country_iso, primary_category_id,
         verification_status, operational_status, onboarding_completed_at)
       VALUES (?, 'gig_provider', ?, ?, ?, ?, ?, ?, ?, 'verified', 'active', datetime('now'))`
    )
    .bind(
      org.created_by_user_id,
      organizationId,
      input.display_name,
      input.bio ?? '',
      input.contact_email ?? null,
      input.contact_phone ?? null,
      input.country_iso ?? 'NG',
      input.primary_category_id ?? null
    )
    .run()

  const providerId = Number(result.meta.last_row_id)
  await db
    .prepare(`INSERT INTO service_resources (provider_profile_id, name, role_title) VALUES (?, ?, 'Primary')`)
    .bind(providerId, input.display_name)
    .run()
  return providerId
}
