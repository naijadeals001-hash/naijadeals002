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
import { applyModerationDecision, getListingForModeration, getPendingModerationQueue, type ModerationDecision } from '../lib/moderation'
import { applyUserStatusDecision, isValidAccountStatus, UserNotFoundError, InvalidStatusError } from '../lib/user-lifecycle'
import {
  getAllHeroCampaignsForAdmin,
  getHeroCampaignById,
  createHeroCampaign,
  updateHeroCampaign,
  setHeroCampaignStatus,
  duplicateHeroCampaign,
  archiveHeroCampaign,
  restoreHeroCampaign,
  reorderHeroCampaigns,
  computeCampaignLifecycleState,
  type HeroCampaignInput,
} from '../lib/hero-campaigns-admin'
import { invalidateHomepageFeedSection } from '../lib/homepage-feed'
import { HERO_IMAGE_LIBRARY } from '../lib/hero-image-library'
import {
  createCollection,
  updateCollection,
  setCollectionActive,
  getAllCollectionsForAdmin,
  addProductToCollectionOrdered,
  removeProductFromCollectionById,
  reorderCollectionProducts,
  getCollectionProductsForAdmin,
} from '../lib/collections-admin'
import { getOpenDisputesForAdmin, resolveDispute, createAndExecuteRefund, RefundError } from '../lib/refunds'
import { createCategoryAttribute, updateCategoryAttribute, deleteCategoryAttribute, getAttributesForCategory } from '../lib/attributes'
import { getAllCountries } from '../lib/country'

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

// ============================================================
// ADR-001 STEP 2 — re-home the orphan administrative routes
// (docs/ADR-001-IMPLEMENTATION-PLAN.md §4). These routes previously
// existed ONLY in src/routes/api-admin.ts, gated by the legacy
// requirePlatformRole('admin') (users.role==='admin'). They are moved
// here in full (not duplicated — api-admin.ts's originals are deleted
// in the same commit, per the implementation plan's §4.1 "re-home, not
// re-gate-in-place" decision) and re-gated with the Control Center's own
// requireControlCenterPermission(key), following this file's existing
// thin-controller shape exactly. Business logic is completely untouched
// — every handler below delegates to the SAME lib function api-admin.ts
// used, with zero behavioral change to request/response contracts.
//
// COUNT CORRECTION (found during this step's mandatory fresh pre-
// implementation audit, per the authorization's "do not rely exclusively
// on previous reports" instruction): the Implementation Plan's §3.2 table
// lists 20 routes for this step. Live inspection of THIS FILE shows
// `GET /moderation/listings/:id` already exists here (added by commit
// 5d203d7 — which is this very plan's OWN STATED BASELINE, so the plan's
// route table was not cross-checked against its own baseline's CC file
// before being written). That route is correctly NOT duplicated below —
// only the genuinely-missing `GET /moderation/queue` (list) is added for
// the moderation domain. Net new routes added by this step: 19, not 20
// (or ADR-001's original, now-superseded "17" figure, which predates the
// Step 1 permission migration and this file's Phase 2 quick-win commit).
//
// Permission mapping (ADR-001 Implementation Plan §3.2, verified live
// against this repository's actual cc_permissions/cc_role_permissions
// state before implementation, not assumed from the plan alone):
//   Moderation queue list        -> moderation.read   (existing key)
//   Collections (9 routes)       -> catalog.read / catalog.manage (Step 1)
//   Category Attributes (4)      -> catalog.read / catalog.manage (Step 1)
//   Disputes list/resolve (2)    -> disputes.read / disputes.manage (existing)
//   Order refund                 -> refunds.approve  (existing key)
//   Countries list                -> configuration.countries.read (Step 1)
//   Notifications overview       -> notifications.read (existing key)
// ============================================================

// ---------- Moderation queue (requires moderation.read) ----------
// NOTE: GET /moderation/listings/:id already exists above (line ~269,
// added by the Phase 2 quick-win commit 5d203d7) — this adds ONLY the
// missing queue-LIST route. Not a duplicate.

apiControlCenterRoutes.get('/moderation/queue', requireControlCenterPermission('moderation.read'), async (c) => {
  const results = await getPendingModerationQueue(c.env.DB, Number(c.req.query('limit') ?? 100))
  return c.json({ results })
})

// ---------- Collections / merchandising (requires catalog.read / catalog.manage) ----------

apiControlCenterRoutes.get('/collections', requireControlCenterPermission('catalog.read'), async (c) => {
  const results = await getAllCollectionsForAdmin(c.env.DB)
  return c.json({ results })
})

apiControlCenterRoutes.post('/collections', requireControlCenterPermission('catalog.manage'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  if (!body.slug || !body.name) return c.json({ error: 'slug and name are required' }, 400)
  try {
    const id = await createCollection(c.env.DB, user.id, body)
    return c.json({ id }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create collection' }, 400)
  }
})

apiControlCenterRoutes.patch('/collections/:id', requireControlCenterPermission('catalog.manage'), async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const ok = await updateCollection(c.env.DB, id, body)
  if (!ok) return c.json({ error: 'Collection not found' }, 404)
  return c.json({ success: true })
})

apiControlCenterRoutes.post('/collections/:id/activate', requireControlCenterPermission('catalog.manage'), async (c) => {
  const ok = await setCollectionActive(c.env.DB, Number(c.req.param('id')), true)
  if (!ok) return c.json({ error: 'Collection not found' }, 404)
  return c.json({ success: true })
})

apiControlCenterRoutes.post('/collections/:id/deactivate', requireControlCenterPermission('catalog.manage'), async (c) => {
  const ok = await setCollectionActive(c.env.DB, Number(c.req.param('id')), false)
  if (!ok) return c.json({ error: 'Collection not found' }, 404)
  return c.json({ success: true })
})

apiControlCenterRoutes.get('/collections/:id/products', requireControlCenterPermission('catalog.read'), async (c) => {
  const results = await getCollectionProductsForAdmin(c.env.DB, Number(c.req.param('id')))
  return c.json({ results })
})

apiControlCenterRoutes.post('/collections/:id/products', requireControlCenterPermission('catalog.manage'), async (c) => {
  const collectionId = Number(c.req.param('id'))
  const body = await c.req.json<{ product_id: number; sort_order?: number }>().catch(() => null)
  if (!body?.product_id) return c.json({ error: 'product_id required' }, 400)
  try {
    await addProductToCollectionOrdered(c.env.DB, collectionId, body.product_id, body.sort_order)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to add product' }, 400)
  }
})

apiControlCenterRoutes.delete('/collections/:id/products/:productId', requireControlCenterPermission('catalog.manage'), async (c) => {
  const ok = await removeProductFromCollectionById(c.env.DB, Number(c.req.param('id')), Number(c.req.param('productId')))
  if (!ok) return c.json({ error: 'Product not in this collection' }, 404)
  return c.json({ success: true })
})

apiControlCenterRoutes.post('/collections/:id/reorder', requireControlCenterPermission('catalog.manage'), async (c) => {
  const body = await c.req.json<{ product_ids: number[] }>().catch(() => null)
  if (!Array.isArray(body?.product_ids)) return c.json({ error: 'product_ids array required' }, 400)
  await reorderCollectionProducts(c.env.DB, Number(c.req.param('id')), body.product_ids)
  return c.json({ success: true })
})

// ---------- Category attribute definitions (requires catalog.read / catalog.manage) ----------

apiControlCenterRoutes.get('/categories/:categoryId/attributes', requireControlCenterPermission('catalog.read'), async (c) => {
  const results = await getAttributesForCategory(c.env.DB, Number(c.req.param('categoryId')))
  return c.json({ results })
})

apiControlCenterRoutes.post('/categories/:categoryId/attributes', requireControlCenterPermission('catalog.manage'), async (c) => {
  const categoryId = Number(c.req.param('categoryId'))
  const body = await c.req.json().catch(() => ({}))
  if (!body.key || !body.label || !body.data_type) return c.json({ error: 'key, label and data_type are required' }, 400)
  try {
    const id = await createCategoryAttribute(c.env.DB, { ...body, category_id: categoryId })
    return c.json({ id }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create attribute' }, 400)
  }
})

apiControlCenterRoutes.patch('/attributes/:id', requireControlCenterPermission('catalog.manage'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const ok = await updateCategoryAttribute(c.env.DB, Number(c.req.param('id')), body)
    if (!ok) return c.json({ error: 'Attribute not found' }, 404)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to update attribute' }, 400)
  }
})

apiControlCenterRoutes.delete('/attributes/:id', requireControlCenterPermission('catalog.manage'), async (c) => {
  const ok = await deleteCategoryAttribute(c.env.DB, Number(c.req.param('id')))
  if (!ok) return c.json({ error: 'Attribute not found' }, 404)
  return c.json({ success: true })
})

// ---------- Disputes & refunds (requires disputes.read / disputes.manage / refunds.approve) ----------

apiControlCenterRoutes.get('/disputes', requireControlCenterPermission('disputes.read'), async (c) => {
  const results = await getOpenDisputesForAdmin(c.env.DB, Number(c.req.query('limit') ?? 100))
  return c.json({ results })
})

apiControlCenterRoutes.post('/disputes/:id/resolve', requireControlCenterPermission('disputes.manage'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ status: 'resolved' | 'rejected'; note: string }>().catch(() => null)
  if (!body?.status || !body?.note) return c.json({ error: 'status and note are required' }, 400)
  const ok = await resolveDispute(c.env.DB, Number(c.req.param('id')), user.id, body.status, body.note)
  if (!ok) return c.json({ error: 'Dispute not found or already resolved' }, 404)
  return c.json({ success: true })
})

apiControlCenterRoutes.post('/orders/:orderId/refund', requireControlCenterPermission('refunds.approve'), async (c) => {
  const user = c.get('user')!
  const orderId = Number(c.req.param('orderId'))
  const body = await c.req.json<{ order_item_id?: number; amount_kobo: number; reason: string; refund_type?: string }>().catch(() => null)
  if (!body?.amount_kobo || !body?.reason) return c.json({ error: 'amount_kobo and reason are required' }, 400)
  try {
    const result = await createAndExecuteRefund(c.env.DB, {
      orderId,
      orderItemId: body.order_item_id ?? null,
      amountKobo: Number(body.amount_kobo),
      reason: body.reason,
      refundType: (body.refund_type as any) ?? 'partial',
      initiatedByUserId: user.id,
      initiatedByRole: 'admin',
    })
    return c.json({ success: true, ...result })
  } catch (err: any) {
    if (err instanceof RefundError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// ---------- Country reference data (requires configuration.countries.read) ----------

apiControlCenterRoutes.get('/countries', requireControlCenterPermission('configuration.countries.read'), async (c) => {
  const results = await getAllCountries(c.env.DB)
  return c.json({ results })
})

// ---------- Notifications overview (requires notifications.read) ----------
// NOTE: this is a distinct, read-only OVERVIEW/aggregate endpoint — not to
// be confused with the /notifications/process-outbox and /retry-failed
// routes above, which already existed here (Phase 2 quick-win, gated by
// notifications.manage) as CC-equivalents of 2 of the 4 ADR-001 §3
// *overlapping* routes (Step 3, not this Step 2). This route has NO
// api-control-center.ts equivalent before this commit — it is a genuine
// re-home of api-admin.ts's GET /notifications/overview only.

apiControlCenterRoutes.get('/notifications/overview', requireControlCenterPermission('notifications.read'), async (c) => {
  const { getNotificationEngineOverview } = await import('../lib/notification-observability')
  const overview = await getNotificationEngineOverview(c.env.DB)
  return c.json(overview)
})

// ============================================================
// HERO CAMPAIGN MANAGEMENT (Enterprise Control Center Checkpoint 1)
//
// The FIRST write path this codebase has ever had for hero_campaigns — the
// read-only forensic audit confirmed zero INSERT/UPDATE/DELETE against this
// table anywhere prior to this checkpoint. Gated by the EXISTING
// promotions.read / promotions.manage permission keys (migration 0050) —
// their own descriptions already named "hero campaigns" explicitly, so no
// new permission migration was needed for this checkpoint. Every mutation
// is delegated to src/lib/hero-campaigns-admin.ts (this file contains no
// business logic, exactly this file's own established thin-controller
// convention) and paired with a real cc_audit_logs row via
// recordControlCenterAction, plus a homepage_feed_cache invalidation so a
// just-published/paused/archived campaign reflects on the live homepage
// within one request instead of waiting out homepage-feed.ts's 120s TTL.
// ============================================================

apiControlCenterRoutes.get('/hero-campaigns', requireControlCenterPermission('promotions.read'), async (c) => {
  const includeArchived = c.req.query('include_archived') === '1'
  const results = await getAllHeroCampaignsForAdmin(c.env.DB, { includeArchived })
  const withState = results.map((row) => ({ ...row, lifecycle_state: computeCampaignLifecycleState(row) }))
  return c.json({ results: withState })
})

apiControlCenterRoutes.get('/hero-campaigns/image-library', requireControlCenterPermission('promotions.read'), async (c) => {
  return c.json({ results: HERO_IMAGE_LIBRARY })
})

apiControlCenterRoutes.get('/hero-campaigns/:id', requireControlCenterPermission('promotions.read'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid campaign id' }, 400)
  const row = await getHeroCampaignById(c.env.DB, id)
  if (!row) return c.json({ error: 'Campaign not found' }, 404)
  return c.json({ result: { ...row, lifecycle_state: computeCampaignLifecycleState(row) } })
})

apiControlCenterRoutes.post('/hero-campaigns', requireControlCenterPermission('promotions.manage'), async (c) => {
  const admin = c.get('user')!
  const body = await c.req.json<HeroCampaignInput>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  try {
    const id = await createHeroCampaign(c.env.DB, admin.id, body)
    await recordControlCenterAction(c.env.DB, {
      actorUserId: admin.id,
      actorName: admin.name,
      action: 'hero_campaign_created',
      entityType: 'hero_campaign',
      entityId: String(id),
      afterState: { slug: body.slug, title: body.title, vertical: body.vertical, status: 'inactive' },
      context: { permission_used: 'promotions.manage' },
      success: true,
      ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
    })
    return c.json({ id }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create campaign' }, 400)
  }
})

apiControlCenterRoutes.patch('/hero-campaigns/:id', requireControlCenterPermission('promotions.manage'), async (c) => {
  const admin = c.get('user')!
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid campaign id' }, 400)

  const before = await getHeroCampaignById(c.env.DB, id)
  if (!before) return c.json({ error: 'Campaign not found' }, 404)

  const body = await c.req.json<Partial<HeroCampaignInput>>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  try {
    const ok = await updateHeroCampaign(c.env.DB, id, admin.id, body)
    if (!ok) return c.json({ error: 'Campaign not found' }, 404)
    await invalidateHomepageFeedSection(c.env.DB, 'hero_campaigns')
    await recordControlCenterAction(c.env.DB, {
      actorUserId: admin.id,
      actorName: admin.name,
      action: 'hero_campaign_updated',
      entityType: 'hero_campaign',
      entityId: String(id),
      beforeState: { title: before.title, cta_href: before.cta_href, status: before.status },
      afterState: body as Record<string, unknown>,
      context: { permission_used: 'promotions.manage' },
      success: true,
      ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
    })
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to update campaign' }, 400)
  }
})

apiControlCenterRoutes.post('/hero-campaigns/:id/status', requireControlCenterPermission('promotions.manage'), async (c) => {
  const admin = c.get('user')!
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid campaign id' }, 400)

  const body = await c.req.json<{ status?: string }>().catch(() => null)
  if (!body || (body.status !== 'active' && body.status !== 'inactive')) {
    return c.json({ error: 'status must be "active" or "inactive"' }, 400)
  }

  const before = await getHeroCampaignById(c.env.DB, id)
  if (!before) return c.json({ error: 'Campaign not found' }, 404)

  const ok = await setHeroCampaignStatus(c.env.DB, id, admin.id, body.status)
  if (!ok) return c.json({ error: 'Campaign not found or is archived' }, 404)
  await invalidateHomepageFeedSection(c.env.DB, 'hero_campaigns')
  await recordControlCenterAction(c.env.DB, {
    actorUserId: admin.id,
    actorName: admin.name,
    action: body.status === 'active' ? 'hero_campaign_activated' : 'hero_campaign_paused',
    entityType: 'hero_campaign',
    entityId: String(id),
    beforeState: { status: before.status },
    afterState: { status: body.status },
    context: { permission_used: 'promotions.manage' },
    success: true,
    ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
  })
  return c.json({ success: true })
})

apiControlCenterRoutes.post('/hero-campaigns/:id/duplicate', requireControlCenterPermission('promotions.manage'), async (c) => {
  const admin = c.get('user')!
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid campaign id' }, 400)

  try {
    const newId = await duplicateHeroCampaign(c.env.DB, id, admin.id)
    await recordControlCenterAction(c.env.DB, {
      actorUserId: admin.id,
      actorName: admin.name,
      action: 'hero_campaign_duplicated',
      entityType: 'hero_campaign',
      entityId: String(newId),
      context: { duplicated_from_id: id, permission_used: 'promotions.manage' },
      success: true,
      ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
    })
    return c.json({ id: newId }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to duplicate campaign' }, 400)
  }
})

apiControlCenterRoutes.post('/hero-campaigns/:id/archive', requireControlCenterPermission('promotions.manage'), async (c) => {
  const admin = c.get('user')!
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid campaign id' }, 400)

  const before = await getHeroCampaignById(c.env.DB, id)
  if (!before) return c.json({ error: 'Campaign not found' }, 404)

  const ok = await archiveHeroCampaign(c.env.DB, id, admin.id)
  if (!ok) return c.json({ error: 'Campaign not found' }, 404)
  await invalidateHomepageFeedSection(c.env.DB, 'hero_campaigns')
  await recordControlCenterAction(c.env.DB, {
    actorUserId: admin.id,
    actorName: admin.name,
    action: 'hero_campaign_archived',
    entityType: 'hero_campaign',
    entityId: String(id),
    beforeState: { status: before.status, is_archived: before.is_archived },
    afterState: { status: 'inactive', is_archived: 1 },
    context: { permission_used: 'promotions.manage' },
    success: true,
    ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
  })
  return c.json({ success: true })
})

apiControlCenterRoutes.post('/hero-campaigns/:id/restore', requireControlCenterPermission('promotions.manage'), async (c) => {
  const admin = c.get('user')!
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid campaign id' }, 400)

  const ok = await restoreHeroCampaign(c.env.DB, id, admin.id)
  if (!ok) return c.json({ error: 'Campaign not found' }, 404)
  await recordControlCenterAction(c.env.DB, {
    actorUserId: admin.id,
    actorName: admin.name,
    action: 'hero_campaign_restored',
    entityType: 'hero_campaign',
    entityId: String(id),
    afterState: { is_archived: 0 },
    context: { permission_used: 'promotions.manage' },
    success: true,
    ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
  })
  return c.json({ success: true })
})

apiControlCenterRoutes.post('/hero-campaigns/reorder', requireControlCenterPermission('promotions.manage'), async (c) => {
  const admin = c.get('user')!
  const body = await c.req.json<{ ordered_ids?: number[] }>().catch(() => null)
  if (!body || !Array.isArray(body.ordered_ids) || body.ordered_ids.length === 0) {
    return c.json({ error: 'ordered_ids array is required' }, 400)
  }
  await reorderHeroCampaigns(c.env.DB, admin.id, body.ordered_ids)
  await invalidateHomepageFeedSection(c.env.DB, 'hero_campaigns')
  await recordControlCenterAction(c.env.DB, {
    actorUserId: admin.id,
    actorName: admin.name,
    action: 'hero_campaign_reordered',
    entityType: 'hero_campaign',
    entityId: null,
    afterState: { ordered_ids: body.ordered_ids },
    context: { permission_used: 'promotions.manage' },
    success: true,
    ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
  })
  return c.json({ success: true })
})
