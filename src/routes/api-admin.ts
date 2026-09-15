/**
 * Marketplace Engine 2.1 — Admin & Operations API (spec section 16).
 *
 * Every route here is gated by `requirePlatformRole('admin')`
 * (src/lib/rbac.ts) — the FIRST real caller of that function, which has
 * existed since migration 0037 with zero callers until this pass
 * (confirmed via grep during inspection). This is the Marketplace-facing
 * slice of the Admin & Operations Command Center — it operates on the
 * SAME authoritative tables customers/sellers use (product_listings,
 * orders), never a parallel admin_* copy, per the Master Ecosystem
 * Directive section 11's explicit prohibition.
 *
 * ADR-001 STEP 2 (docs/ADR-001-IMPLEMENTATION-PLAN.md §4): this file
 * originally held 24 routes (Collections spec section 10, Category
 * Attributes section 9, Disputes/Refunds section 6, Countries section 11,
 * Notifications-overview, plus this file's own moderation/status routes).
 * 19 genuinely-orphan routes (no prior Control Center equivalent) were
 * re-homed to src/routes/api-control-center.ts and deleted from here.
 * The remaining 5 routes below (moderation x2, notifications x2,
 * users/status x1) are ADR-001 Step 3 territory — they already have a
 * live Control Center equivalent and are candidates to RETIRE, not
 * re-home; that retirement is a separate, not-yet-authorized step.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { requirePlatformRole } from '../lib/rbac'
import { getListingForModeration, applyModerationDecision } from '../lib/moderation'
import { applyUserStatusDecision, isValidAccountStatus, UserNotFoundError, InvalidStatusError } from '../lib/user-lifecycle'

export const adminApi = new Hono<AppEnv>()

adminApi.use('*', requireAuth)
adminApi.use('*', requirePlatformRole('admin'))

// ---------- Product moderation (spec section 16) ----------
//
// ADR-001 STEP 2 NOTE: GET /moderation/queue was re-homed to
// /api/control-center/moderation/queue (this file's original deleted,
// per the implementation plan's §4.1 "re-home, not re-gate-in-place"
// decision for genuinely-orphan routes). GET /moderation/listings/:id
// and POST /moderation/listings/:id/decision below are DELIBERATELY LEFT
// HERE, unchanged — they are Step 3 territory (overlapping routes to be
// RETIRED, not re-homed), not Step 2's. This is a discrepancy found
// during this step's fresh pre-implementation audit: the Implementation
// Plan's §3.2 table lists both as Step 2 "orphan" routes, but a live CC
// equivalent for both already exists (added by commit 5d203d7, which
// pre-dates this plan and is itself the plan's own stated baseline —
// the plan's table was not cross-checked against its own baseline before
// being written). Retiring api-admin.ts's copies of these 2 routes is
// correctly Step 3's job (ADR-001 §6 Step 3: "retire the 4 overlapping
// api-admin.ts routes" — this makes it 5, not 4, a finding for that
// step's own authorization, not addressed here).

adminApi.get('/moderation/listings/:id', async (c) => {
  const listing = await getListingForModeration(c.env.DB, Number(c.req.param('id')))
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  return c.json({ listing })
})

adminApi.post('/moderation/listings/:id/decision', async (c) => {
  const user = c.get('user')!
  const listingId = Number(c.req.param('id'))
  const body = await c.req.json<{ decision: string; reason?: string }>().catch(() => null)
  if (!body || !['approve', 'reject', 'suspend', 'request_changes'].includes(body.decision)) {
    return c.json({ error: 'decision must be one of: approve, reject, suspend, request_changes' }, 400)
  }
  try {
    const result = await applyModerationDecision(c.env.DB, listingId, body.decision as any, user.id, user.name, body.reason)
    return c.json({ success: true, ...result })
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to apply moderation decision' }, 400)
  }
})

// ---------- Engine 9: Communication & Notification outbox control (Phase 17) ----------
//
// ADR-001 STEP 2 NOTE: GET /notifications/overview was re-homed to
// /api/control-center/notifications/overview (this file's original
// deleted, per the implementation plan's §4.1 decision). The 2 routes
// below (process-outbox, retry-failed) are DELIBERATELY LEFT HERE,
// unchanged — they are Step 3 territory (overlapping routes with an
// existing CC equivalent, to be RETIRED not re-homed), not Step 2's.

/** Bounded catch-up trigger for the durable outbox (see notifications.ts's module doc comment on why this project uses a request-triggered catch-up pass instead of a cron/Queue binding). Admin-only, never automatic/hidden. */
adminApi.post('/notifications/process-outbox', async (c) => {
  const { processOutboxBatch } = await import('../lib/notifications')
  const limit = Math.min(Number(c.req.query('limit') ?? 25) || 25, 100)
  const result = await processOutboxBatch(c.env.DB, limit)
  return c.json(result)
})

/** Bounded retry pass for transiently-failed deliveries whose next_retry_at has arrived (Phase 8's explicit retry-scheduler decision — see notifications.ts's retryFailedDeliveries doc comment). Admin-only, never automatic/hidden, never re-delivers a permanently-failed or already-delivered row. */
adminApi.post('/notifications/retry-failed', async (c) => {
  const { retryFailedDeliveries } = await import('../lib/notifications')
  const limit = Math.min(Number(c.req.query('limit') ?? 25) || 25, 100)
  const result = await retryFailedDeliveries(c.env.DB, limit)
  return c.json(result)
})

// ---------- Engine 1: Identity & Access — users.status admin mutation ----------
//
// Closes the Engine 1 gap-matrix finding: users.status existed and was
// already read by Engine 11's search-eligibility.ts, but nothing could
// ever transition it, and auth.ts never enforced it. This is the ONLY
// route in the codebase permitted to change a user's account lifecycle
// status — gated by the same requireAuth + requirePlatformRole('admin')
// mounted for this whole router above, so ordinary customers/sellers/
// providers structurally cannot reach it (never a self-service or
// cross-user mutation path). See src/lib/user-lifecycle.ts for the
// atomic status-change + audit-log + session-revocation implementation.

adminApi.post('/users/:id/status', async (c) => {
  const admin = c.get('user')!
  const targetUserId = Number(c.req.param('id'))
  if (!targetUserId || Number.isNaN(targetUserId)) {
    return c.json({ error: 'Invalid user id' }, 400)
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
    console.error('applyUserStatusDecision failed', targetUserId, err)
    return c.json({ error: 'Failed to update user status' }, 500)
  }
})
