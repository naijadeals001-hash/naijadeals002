/**
 * Enterprise Control Center — Phase 1: Seller/Provider Verification
 * administration (Phase 1 prompt Section 14 — "the highest-value immediate
 * capability because the underlying state machines already exist").
 *
 * Phase 0's forensic audit confirmed: vendors.verification_status /
 * vendors.store_status (migration 0009) and provider_profiles.
 * verification_status / provider_profiles.operational_status (migration
 * 0025) are REAL, already-enforced state machines (search-eligibility.ts,
 * seller.ts and providers.ts all already READ these columns to gate
 * customer-facing visibility/access) — but until this file, NOTHING in the
 * codebase could ever WRITE to vendors.verification_status or
 * provider_profiles.verification_status. This module is the first and only
 * authority for that mutation, mirroring src/lib/moderation.ts's
 * applyModerationDecision() and src/lib/user-lifecycle.ts's
 * applyUserStatusDecision() pattern exactly:
 *
 *   atomic db.batch([ UPDATE the real entity, INSERT cc_audit_logs,
 *   INSERT cc_domain_events, (providers only) INSERT
 *   provider_profile_status_events ])
 *
 * NO new verification data/state is invented here — every value this
 * module writes is one of the CHECK-constrained values the existing
 * migrations already define. Existing customer-facing enforcement
 * (search-eligibility.ts, seller.ts's resolveSellerStatus, providers.ts's
 * resolveProviderStatus) picks up the effect of these mutations on the
 * caller's very next read — no separate "publish" step needed.
 *
 * Route layer MUST gate calls into this module with
 * requireControlCenterPermission('vendors.verify') /
 * requireControlCenterPermission('providers.verify') (or the matching
 * .suspend permission for suspend/reinstate-only actions) — this module
 * itself does not re-check the caller's Control Center permission, exactly
 * like moderation.ts's single-responsibility split between route-layer
 * authorization and module-layer state transition + audit trail.
 */
import { buildControlCenterAuditStatements } from './control-center-audit'

// ---------- Vendors ----------

export type VendorVerificationDecision = 'verify' | 'reject' | 'suspend' | 'reinstate'

const VENDOR_DECISION_TO_STATUS: Record<VendorVerificationDecision, string> = {
  verify: 'verified',
  reject: 'rejected',
  suspend: 'suspended',
  reinstate: 'verified',
}

export class VendorNotFoundError extends Error {
  constructor() {
    super('Vendor not found')
    this.name = 'VendorNotFoundError'
  }
}

export class VerificationReasonRequiredError extends Error {
  constructor() {
    super('A reason is required for this decision')
    this.name = 'VerificationReasonRequiredError'
  }
}

/**
 * Admin mutation of vendors.verification_status. `is_verified` (the legacy
 * boolean used by pre-migration-0009 catalog queries — see types.ts's
 * VendorRow doc comment) is kept in sync exactly as migration 0009's own
 * seed/backfill already established, so this never desyncs the two columns.
 */
export async function applyVendorVerificationDecision(
  db: D1Database,
  vendorId: number,
  decision: VendorVerificationDecision,
  adminUserId: number,
  adminName: string,
  reason?: string,
  ipAddress?: string | null
): Promise<{ previousStatus: string; newStatus: string }> {
  if ((decision === 'reject' || decision === 'suspend') && !reason) {
    throw new VerificationReasonRequiredError()
  }

  const vendor = await db.prepare('SELECT id, verification_status, name FROM vendors WHERE id = ?').bind(vendorId).first<{ id: number; verification_status: string; name: string }>()
  if (!vendor) throw new VendorNotFoundError()

  const newStatus = VENDOR_DECISION_TO_STATUS[decision]
  const previousStatus = vendor.verification_status
  const newIsVerified = newStatus === 'verified' ? 1 : 0

  await db.batch([
    db
      .prepare(`UPDATE vendors SET verification_status = ?, is_verified = ?, verification_note = ? WHERE id = ?`)
      .bind(newStatus, newIsVerified, reason ?? null, vendorId),
    ...buildControlCenterAuditStatements(db, {
      actorUserId: adminUserId,
      actorName: adminName,
      action: 'vendor_verification_decision',
      entityType: 'vendor',
      entityId: String(vendorId),
      beforeState: { verification_status: previousStatus },
      afterState: { verification_status: newStatus },
      context: { decision, reason: reason ?? null, vendor_name: vendor.name },
      success: true,
      ipAddress: ipAddress ?? null,
    }),
  ])

  return { previousStatus, newStatus }
}

export type VendorStoreStatusDecision = 'suspend' | 'reinstate'

const VENDOR_STORE_DECISION_TO_STATUS: Record<VendorStoreStatusDecision, string> = {
  suspend: 'suspended',
  reinstate: 'active',
}

/** Admin mutation of vendors.store_status — distinct axis from verification_status (Section 14: seller-controlled "pause" vs admin-controlled suspension both land on the same column, this is the admin path). */
export async function applyVendorStoreStatusDecision(
  db: D1Database,
  vendorId: number,
  decision: VendorStoreStatusDecision,
  adminUserId: number,
  adminName: string,
  reason?: string,
  ipAddress?: string | null
): Promise<{ previousStatus: string; newStatus: string }> {
  if (decision === 'suspend' && !reason) throw new VerificationReasonRequiredError()

  const vendor = await db.prepare('SELECT id, store_status, name FROM vendors WHERE id = ?').bind(vendorId).first<{ id: number; store_status: string; name: string }>()
  if (!vendor) throw new VendorNotFoundError()

  const newStatus = VENDOR_STORE_DECISION_TO_STATUS[decision]
  const previousStatus = vendor.store_status

  await db.batch([
    db.prepare(`UPDATE vendors SET store_status = ? WHERE id = ?`).bind(newStatus, vendorId),
    ...buildControlCenterAuditStatements(db, {
      actorUserId: adminUserId,
      actorName: adminName,
      action: 'vendor_store_status_decision',
      entityType: 'vendor',
      entityId: String(vendorId),
      beforeState: { store_status: previousStatus },
      afterState: { store_status: newStatus },
      context: { decision, reason: reason ?? null, vendor_name: vendor.name },
      success: true,
      ipAddress: ipAddress ?? null,
    }),
  ])

  return { previousStatus, newStatus }
}

/** Vendors awaiting verification, oldest first — the Control Center's verification queue read model. Never fabricated: reads the real vendors table. */
export async function getPendingVendorVerifications(db: D1Database, limit = 100) {
  const { results } = await db
    .prepare(
      `SELECT id, slug, name, business_name, business_email, business_phone, city, state, verification_status, store_status, joined_year
       FROM vendors WHERE verification_status = 'pending' AND user_id IS NOT NULL
       ORDER BY id ASC LIMIT ?`
    )
    .bind(limit)
    .all()
  return results
}

// ---------- Providers ----------

export type ProviderVerificationDecision = 'verify' | 'reject' | 'reinstate'

const PROVIDER_DECISION_TO_STATUS: Record<ProviderVerificationDecision, string> = {
  verify: 'verified',
  reject: 'rejected',
  reinstate: 'verified',
}

export class ProviderNotFoundError extends Error {
  constructor() {
    super('Provider profile not found')
    this.name = 'ProviderNotFoundError'
  }
}

/**
 * Admin mutation of provider_profiles.verification_status. Also appends a
 * row to provider_profile_status_events (migration 0025 — an existing,
 * purpose-built, dormant-until-now ledger table for exactly this) in the
 * SAME atomic batch, in addition to the shared cc_audit_logs/
 * cc_domain_events pair every Control Center mutation writes.
 */
export async function applyProviderVerificationDecision(
  db: D1Database,
  providerProfileId: number,
  decision: ProviderVerificationDecision,
  adminUserId: number,
  adminName: string,
  reason?: string,
  ipAddress?: string | null
): Promise<{ previousStatus: string; newStatus: string }> {
  if (decision === 'reject' && !reason) throw new VerificationReasonRequiredError()

  const provider = await db
    .prepare('SELECT id, verification_status, display_name FROM provider_profiles WHERE id = ?')
    .bind(providerProfileId)
    .first<{ id: number; verification_status: string; display_name: string }>()
  if (!provider) throw new ProviderNotFoundError()

  const newStatus = PROVIDER_DECISION_TO_STATUS[decision]
  const previousStatus = provider.verification_status

  await db.batch([
    db.prepare(`UPDATE provider_profiles SET verification_status = ?, updated_at = datetime('now') WHERE id = ?`).bind(newStatus, providerProfileId),
    db
      .prepare(`INSERT INTO provider_profile_status_events (provider_profile_id, status_type, status, actor_user_id, note) VALUES (?, 'verification', ?, ?, ?)`)
      .bind(providerProfileId, newStatus, adminUserId, reason ?? null),
    ...buildControlCenterAuditStatements(db, {
      actorUserId: adminUserId,
      actorName: adminName,
      action: 'provider_verification_decision',
      entityType: 'provider_profile',
      entityId: String(providerProfileId),
      beforeState: { verification_status: previousStatus },
      afterState: { verification_status: newStatus },
      context: { decision, reason: reason ?? null, provider_display_name: provider.display_name },
      success: true,
      ipAddress: ipAddress ?? null,
    }),
  ])

  return { previousStatus, newStatus }
}

export type ProviderOperationalStatusDecision = 'suspend' | 'reinstate'

const PROVIDER_OPERATIONAL_DECISION_TO_STATUS: Record<ProviderOperationalStatusDecision, string> = {
  suspend: 'suspended',
  reinstate: 'active',
}

/** Admin mutation of provider_profiles.operational_status — distinct axis from verification_status (mirrors vendors.store_status vs verification_status split). */
export async function applyProviderOperationalStatusDecision(
  db: D1Database,
  providerProfileId: number,
  decision: ProviderOperationalStatusDecision,
  adminUserId: number,
  adminName: string,
  reason?: string,
  ipAddress?: string | null
): Promise<{ previousStatus: string; newStatus: string }> {
  if (decision === 'suspend' && !reason) throw new VerificationReasonRequiredError()

  const provider = await db
    .prepare('SELECT id, operational_status, display_name FROM provider_profiles WHERE id = ?')
    .bind(providerProfileId)
    .first<{ id: number; operational_status: string; display_name: string }>()
  if (!provider) throw new ProviderNotFoundError()

  const newStatus = PROVIDER_OPERATIONAL_DECISION_TO_STATUS[decision]
  const previousStatus = provider.operational_status

  await db.batch([
    db.prepare(`UPDATE provider_profiles SET operational_status = ?, updated_at = datetime('now') WHERE id = ?`).bind(newStatus, providerProfileId),
    db
      .prepare(`INSERT INTO provider_profile_status_events (provider_profile_id, status_type, status, actor_user_id, note) VALUES (?, 'operational', ?, ?, ?)`)
      .bind(providerProfileId, newStatus, adminUserId, reason ?? null),
    ...buildControlCenterAuditStatements(db, {
      actorUserId: adminUserId,
      actorName: adminName,
      action: 'provider_operational_status_decision',
      entityType: 'provider_profile',
      entityId: String(providerProfileId),
      beforeState: { operational_status: previousStatus },
      afterState: { operational_status: newStatus },
      context: { decision, reason: reason ?? null, provider_display_name: provider.display_name },
      success: true,
      ipAddress: ipAddress ?? null,
    }),
  ])

  return { previousStatus, newStatus }
}

/** Provider profiles awaiting verification, oldest first — real read model, never fabricated. */
export async function getPendingProviderVerifications(db: D1Database, limit = 100) {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, provider_type, display_name, contact_email, contact_phone, country_iso, verification_status, operational_status
       FROM provider_profiles WHERE verification_status = 'pending'
       ORDER BY id ASC LIMIT ?`
    )
    .bind(limit)
    .all()
  return results
}
