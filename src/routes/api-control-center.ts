/**
 * Enterprise Control Center — Phase 1: privileged mutation API.
 *
 * Every route in this file is a genuine server-side authorization boundary
 * (Phase 1 prompt Section 4/11): requireControlCenterApiAuth (401 if no
 * session, 403 if the session holds zero cc_user_roles) runs on '*' first,
 * then each individual route additionally requires the SPECIFIC granular
 * permission it needs via requireControlCenterPermission — a Control Center
 * user who is NOT vendors.verify-capable gets a real 403 hitting this
 * endpoint directly with curl, exactly as they would clicking a (hidden,
 * for them) button in the SSR page. There is no code path here that trusts
 * anything client-supplied for authorization; the actor identity for every
 * audit entry is always c.get('user'), never a body field.
 *
 * This is the FIRST implementation this codebase has ever had of a write
 * path for vendors.verification_status / provider_profiles.verification_status
 * — see src/lib/control-center-verification.ts's own doc comment for the
 * full provenance/confirmation-via-grep story. This route file itself
 * contains NO business logic: it only (1) authorizes, (2) validates the
 * request shape, (3) delegates to control-center-verification.ts, and (4)
 * translates that module's typed errors into the correct HTTP status —
 * exactly the same thin-controller shape api-admin.ts already uses for
 * applyModerationDecision/applyUserStatusDecision.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireControlCenterApiAuth, requireControlCenterPermission } from '../lib/control-center-rbac'
import { getClientIp } from '../lib/login-throttle'
import { runControlCenterSearch } from '../lib/control-center-search'
import { recordControlCenterAction } from '../lib/control-center-audit'
import {
  applyVendorVerificationDecision,
  applyVendorStoreStatusDecision,
  applyProviderVerificationDecision,
  applyProviderOperationalStatusDecision,
  VendorNotFoundError,
  ProviderNotFoundError,
  VerificationReasonRequiredError,
  type VendorVerificationDecision,
  type VendorStoreStatusDecision,
  type ProviderVerificationDecision,
  type ProviderOperationalStatusDecision,
} from '../lib/control-center-verification'
import { applyModerationDecision, getListingForModeration, type ModerationDecision } from '../lib/moderation'
import { applyUserStatusDecision, isValidAccountStatus, UserNotFoundError, InvalidStatusError } from '../lib/user-lifecycle'

export const apiControlCenterRoutes = new Hono<AppEnv>()

// Every route below requires, at minimum, a resolved Control Center session
// (genuine 401/403 JSON — never a redirect, since this is an API surface).
apiControlCenterRoutes.use('*', requireControlCenterApiAuth)

const VENDOR_VERIFICATION_DECISIONS: VendorVerificationDecision[] = ['verify', 'reject', 'suspend', 'reinstate']
const VENDOR_STORE_DECISIONS: VendorStoreStatusDecision[] = ['suspend', 'reinstate']
const PROVIDER_VERIFICATION_DECISIONS: ProviderVerificationDecision[] = ['verify', 'reject', 'reinstate']
const PROVIDER_OPERATIONAL_DECISIONS: ProviderOperationalStatusDecision[] = ['suspend', 'reinstate']

function mapVerificationErrorToResponse(err: unknown): { message: string; status: 400 | 404 } {
  if (err instanceof VendorNotFoundError || err instanceof ProviderNotFoundError) {
    return { message: err.message, status: 404 }
  }
  if (err instanceof VerificationReasonRequiredError) {
    return { message: err.message, status: 400 }
  }
  return { message: err instanceof Error ? err.message : 'Failed to apply decision', status: 400 }
}

// ---------- Vendor verification (requires vendors.verify) ----------

apiControlCenterRoutes.post(
  '/verifications/vendors/:id/decision',
  requireControlCenterPermission('vendors.verify'),
  async (c) => {
    const user = c.get('user')!
    const vendorId = Number(c.req.param('id'))
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return c.json({ error: 'Invalid vendor id' }, 400)
    }

    const body = await c.req.json<{ decision?: string; reason?: string }>().catch(() => null)
    if (!body?.decision || !VENDOR_VERIFICATION_DECISIONS.includes(body.decision as VendorVerificationDecision)) {
      return c.json({ error: `decision must be one of: ${VENDOR_VERIFICATION_DECISIONS.join(', ')}` }, 400)
    }

    const ip = getClientIp(c.req.header('cf-connecting-ip') ?? null)

    try {
      const result = await applyVendorVerificationDecision(
        c.env.DB,
        vendorId,
        body.decision as VendorVerificationDecision,
        user.id,
        user.name,
        body.reason,
        ip
      )
      return c.json({ success: true, ...result })
    } catch (err) {
      const { message, status } = mapVerificationErrorToResponse(err)
      return c.json({ error: message }, status)
    }
  }
)

// ---------- Vendor store status (requires vendors.suspend) ----------

apiControlCenterRoutes.post(
  '/verifications/vendors/:id/store-status',
  requireControlCenterPermission('vendors.suspend'),
  async (c) => {
    const user = c.get('user')!
    const vendorId = Number(c.req.param('id'))
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return c.json({ error: 'Invalid vendor id' }, 400)
    }

    const body = await c.req.json<{ decision?: string; reason?: string }>().catch(() => null)
    if (!body?.decision || !VENDOR_STORE_DECISIONS.includes(body.decision as VendorStoreStatusDecision)) {
      return c.json({ error: `decision must be one of: ${VENDOR_STORE_DECISIONS.join(', ')}` }, 400)
    }

    const ip = getClientIp(c.req.header('cf-connecting-ip') ?? null)

    try {
      const result = await applyVendorStoreStatusDecision(
        c.env.DB,
        vendorId,
        body.decision as VendorStoreStatusDecision,
        user.id,
        user.name,
        body.reason,
        ip
      )
      return c.json({ success: true, ...result })
    } catch (err) {
      const { message, status } = mapVerificationErrorToResponse(err)
      return c.json({ error: message }, status)
    }
  }
)

// ---------- Provider verification (requires providers.verify) ----------

apiControlCenterRoutes.post(
  '/verifications/providers/:id/decision',
  requireControlCenterPermission('providers.verify'),
  async (c) => {
    const user = c.get('user')!
    const providerProfileId = Number(c.req.param('id'))
    if (!Number.isInteger(providerProfileId) || providerProfileId <= 0) {
      return c.json({ error: 'Invalid provider profile id' }, 400)
    }

    const body = await c.req.json<{ decision?: string; reason?: string }>().catch(() => null)
    if (!body?.decision || !PROVIDER_VERIFICATION_DECISIONS.includes(body.decision as ProviderVerificationDecision)) {
      return c.json({ error: `decision must be one of: ${PROVIDER_VERIFICATION_DECISIONS.join(', ')}` }, 400)
    }

    const ip = getClientIp(c.req.header('cf-connecting-ip') ?? null)

    try {
      const result = await applyProviderVerificationDecision(
        c.env.DB,
        providerProfileId,
        body.decision as ProviderVerificationDecision,
        user.id,
        user.name,
        body.reason,
        ip
      )
      return c.json({ success: true, ...result })
    } catch (err) {
      const { message, status } = mapVerificationErrorToResponse(err)
      return c.json({ error: message }, status)
    }
  }
)

// ---------- Provider operational status (requires providers.suspend) ----------

apiControlCenterRoutes.post(
  '/verifications/providers/:id/operational-status',
  requireControlCenterPermission('providers.suspend'),
  async (c) => {
    const user = c.get('user')!
    const providerProfileId = Number(c.req.param('id'))
    if (!Number.isInteger(providerProfileId) || providerProfileId <= 0) {
      return c.json({ error: 'Invalid provider profile id' }, 400)
    }

    const body = await c.req.json<{ decision?: string; reason?: string }>().catch(() => null)
    if (!body?.decision || !PROVIDER_OPERATIONAL_DECISIONS.includes(body.decision as ProviderOperationalStatusDecision)) {
      return c.json({ error: `decision must be one of: ${PROVIDER_OPERATIONAL_DECISIONS.join(', ')}` }, 400)
    }

    const ip = getClientIp(c.req.header('cf-connecting-ip') ?? null)

    try {
      const result = await applyProviderOperationalStatusDecision(
        c.env.DB,
        providerProfileId,
        body.decision as ProviderOperationalStatusDecision,
        user.id,
        user.name,
        body.reason,
        ip
      )
      return c.json({ success: true, ...result })
    } catch (err) {
      const { message, status } = mapVerificationErrorToResponse(err)
      return c.json({ error: message }, status)
    }
  }
)

// ---------- Global command search (real, permission-scoped) ----------
// Replaces the Phase 1 shell's "Global search — not yet available"
// placeholder. Results are scoped to whatever entities the caller's own
// resolved permission set already allows them to see (see
// control-center-search.ts) — this endpoint cannot be used to discover
// data a role couldn't otherwise reach through the normal nav.

apiControlCenterRoutes.get('/search', async (c) => {
  const ccAccess = c.get('ccAccess')!
  const q = c.req.query('q') ?? ''
  const results = await runControlCenterSearch(c.env.DB, q, ccAccess.permissionKeys)
  return c.json({ query: q, results })
})

// ============================================================
// CONTENT MODERATION (Phase 2, Workstream A quick win) — requires
// moderation.manage. The underlying moderation.ts::applyModerationDecision
// already writes cc_audit_logs itself (action='listing_moderation_decision'),
// so this route does NOT double-write an audit row — it is a thin
// controller exactly like the vendor/provider verification routes above.
// ============================================================

const MODERATION_DECISIONS: ModerationDecision[] = ['approve', 'reject', 'suspend', 'request_changes']

apiControlCenterRoutes.post(
  '/moderation/listings/:id/decision',
  requireControlCenterPermission('moderation.manage'),
  async (c) => {
    const user = c.get('user')!
    const listingId = Number(c.req.param('id'))
    if (!Number.isInteger(listingId) || listingId <= 0) {
      return c.json({ error: 'Invalid listing id' }, 400)
    }

    const body = await c.req.json<{ decision?: string; reason?: string }>().catch(() => null)
    if (!body?.decision || !MODERATION_DECISIONS.includes(body.decision as ModerationDecision)) {
      return c.json({ error: `decision must be one of: ${MODERATION_DECISIONS.join(', ')}` }, 400)
    }
    if (body.decision === 'request_changes' && !body.reason) {
      return c.json({ error: 'A reason is required when requesting changes' }, 400)
    }

    try {
      const result = await applyModerationDecision(c.env.DB, listingId, body.decision as ModerationDecision, user.id, user.name, body.reason)
      return c.json({ success: true, ...result })
    } catch (err: any) {
      const message = err?.message ?? 'Failed to apply moderation decision'
      const status = message === 'Listing not found' ? 404 : 400
      return c.json({ error: message }, status)
    }
  }
)

apiControlCenterRoutes.get('/moderation/listings/:id', requireControlCenterPermission('moderation.read'), async (c) => {
  const listing = await getListingForModeration(c.env.DB, Number(c.req.param('id')))
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  return c.json({ listing })
})

// ============================================================
// COMMUNICATIONS (Phase 2, Workstream A quick win) — requires
// notifications.manage. NOTE: these are CC-gated equivalents of
// api-admin.ts's /notifications/process-outbox and /retry-failed —
// deliberately NOT calling that route, because it is gated by
// requirePlatformRole('admin') (users.role === 'admin'), a DIFFERENT and
// unrelated authorization system from the Control Center's own
// cc_user_roles/cc_permissions. A Control Center operator with
// notifications.manage may hold users.role='customer' (e.g. a dedicated
// CC-only operator account) and would incorrectly get a 403 from the
// api-admin.ts route despite being fully authorized here. Both routes
// delegate to the exact same underlying notifications.ts functions —
// there is no duplicated business logic, only a duplicated authorization
// gate appropriate to each surface.
// ============================================================

apiControlCenterRoutes.post('/notifications/process-outbox', requireControlCenterPermission('notifications.manage'), async (c) => {
  const user = c.get('user')!
  const { processOutboxBatch } = await import('../lib/notifications')
  const limit = Math.min(Number(c.req.query('limit') ?? 25) || 25, 100)
  const result = await processOutboxBatch(c.env.DB, limit)
  // processOutboxBatch itself only touches notification_outbox/notification_deliveries
  // (its own domain log) — it has no cc_audit_logs write, so the CC layer records
  // the privileged trigger action here, per the hard governance rule that every
  // privileged CC mutation must appear in the centralized audit trail.
  await recordControlCenterAction(c.env.DB, {
    actorUserId: user.id,
    actorName: user.name,
    action: 'notifications_process_outbox',
    entityType: 'notification_outbox',
    entityId: null,
    afterState: result,
    context: { limit },
    success: true,
    ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
  })
  return c.json(result)
})

apiControlCenterRoutes.post('/notifications/retry-failed', requireControlCenterPermission('notifications.manage'), async (c) => {
  const user = c.get('user')!
  const { retryFailedDeliveries } = await import('../lib/notifications')
  const limit = Math.min(Number(c.req.query('limit') ?? 25) || 25, 100)
  const result = await retryFailedDeliveries(c.env.DB, limit)
  await recordControlCenterAction(c.env.DB, {
    actorUserId: user.id,
    actorName: user.name,
    action: 'notifications_retry_failed',
    entityType: 'notification_deliveries',
    entityId: null,
    afterState: { attempted: result.attempted, retried: result.retried },
    context: { limit },
    success: true,
    ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
  })
  return c.json(result)
})

// ============================================================
// CUSTOMER 360 (Phase 2, Workstream B) — customers.suspend gated mutation.
// applyUserStatusDecision() already writes cc_audit_logs itself
// (action='user_status_decision') — no double-write here, same pattern as
// the moderation route above.
// ============================================================

apiControlCenterRoutes.post(
  '/customers/:id/status',
  requireControlCenterPermission('customers.suspend'),
  async (c) => {
    const admin = c.get('user')!
    const targetUserId = Number(c.req.param('id'))
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return c.json({ error: 'Invalid customer id' }, 400)
    }

    const body = await c.req.json<{ status?: string; reason?: string }>().catch(() => null)
    if (!body || typeof body.status !== 'string') {
      return c.json({ error: 'status is required' }, 400)
    }
    if (!isValidAccountStatus(body.status)) {
      return c.json({ error: 'status must be one of: active, pending_verification, suspended, disabled, deleted' }, 400)
    }

    try {
      const result = await applyUserStatusDecision(c.env.DB, targetUserId, body.status, admin.id, admin.name, body.reason)
      return c.json({ success: true, ...result })
    } catch (err) {
      if (err instanceof UserNotFoundError) return c.json({ error: err.message }, 404)
      if (err instanceof InvalidStatusError) return c.json({ error: err.message }, 400)
      console.error('Control Center customer status decision failed', targetUserId, err)
      return c.json({ error: 'Failed to update customer status' }, 500)
    }
  }
)
