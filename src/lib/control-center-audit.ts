/**
 * Enterprise Control Center — Phase 1: centralized audit helper.
 *
 * Directly generalizes the exact db.batch() shape src/lib/moderation.ts's
 * applyModerationDecision() and src/lib/user-lifecycle.ts's
 * applyUserStatusDecision() already hand-write (INSERT cc_audit_logs +
 * INSERT cc_domain_events alongside the real mutation, all in one atomic
 * batch) into ONE reusable function every future Control Center mutation
 * calls, instead of every route author re-deriving the same INSERT
 * statements by hand.
 *
 * This directly targets the Phase 0 audit's core finding (Phase 0 Section
 * 18 / Phase 1 prompt Section 12): 25 of the 27 existing routes in
 * src/routes/api-admin.ts never write to cc_audit_logs at all. New Control
 * Center routes built on top of this helper structurally cannot repeat that
 * gap — recordControlCenterAction() IS the mutation's audit trail, not an
 * optional add-on a route author might forget.
 *
 * SECRETS DISCIPLINE (Phase 1 prompt Section 12/34): callers must NEVER
 * pass password hashes, session tokens, API keys, or cc_integrations
 * config_json secret values into beforeState/afterState/metadata. This
 * module does not attempt to scrub arbitrary objects (a generic secret
 * scrubber would give false confidence) — it is each call site's
 * responsibility to only serialize the specific, known-safe fields it
 * intends to audit, exactly as moderation.ts and user-lifecycle.ts already
 * do today (e.g. `{ moderation_status: previousStatus }`, never a raw row
 * spread).
 */

export interface ControlCenterAuditEntry {
  /** The authenticated Control Center actor performing the mutation — c.get('user').id, NEVER client-supplied. */
  actorUserId: number
  /** Snapshot of the actor's display name at the time of the action (audit rows must remain readable even if the user is later renamed/deleted). */
  actorName: string
  /** Dot-notation-free, human-scannable action key, e.g. 'vendor_verification_decision', 'control_center_login', 'refund_approved'. */
  action: string
  /** The entity type this action targets, e.g. 'vendor', 'provider_profile', 'user', 'control_center_session'. */
  entityType: string
  /** The entity's id as a string (D1-agnostic — some ids are numeric, session ids etc. may not be). Null for actions with no single target entity (e.g. login). */
  entityId: string | null
  /** Safe-to-log snapshot of pre-mutation state. Pass only the specific fields being audited, never a raw row spread. Omit entirely for non-mutating events (e.g. login). */
  beforeState?: Record<string, unknown>
  /** Safe-to-log snapshot of post-mutation state. Same safety rule as beforeState. */
  afterState?: Record<string, unknown>
  /** Free-form safe context — reason/comment, permission key used, correlation id, source, etc. Never secrets. */
  context?: Record<string, unknown>
  /** Whether the action succeeded. false for "unauthorized attempt" / "validation failed" audit entries — Phase 1 prompt Section 31 requires these to exist WITHOUT looking like a false success. */
  success: boolean
  /** Best-effort client IP for the audit trail (e.g. cf-connecting-ip). Never trusted for authorization decisions — display/forensics only. */
  ipAddress?: string | null
}

/**
 * Writes one row to cc_audit_logs and one companion row to cc_domain_events
 * (the same dual-write shape moderation.ts/user-lifecycle.ts already
 * established), as a SINGLE D1 statement (not a batch) since this function
 * itself does not also perform the underlying business mutation — callers
 * that need "mutation + audit" to be atomic (e.g. seller/provider
 * verification) should build their OWN db.batch() using
 * buildControlCenterAuditStatements() below rather than call this function,
 * exactly as moderation.ts does today.
 */
export async function recordControlCenterAction(db: D1Database, entry: ControlCenterAuditEntry): Promise<void> {
  const statements = buildControlCenterAuditStatements(db, entry)
  await db.batch(statements)
}

/**
 * Returns the [cc_audit_logs INSERT, cc_domain_events INSERT] prepared
 * statement pair WITHOUT executing them, so a caller can splice them into
 * its OWN db.batch() alongside the real entity mutation for true atomicity
 * (mirrors moderation.ts's applyModerationDecision exactly: one db.batch([
 * UPDATE ..., ...buildControlCenterAuditStatements(...) ])).
 */
export function buildControlCenterAuditStatements(db: D1Database, entry: ControlCenterAuditEntry): D1PreparedStatement[] {
  const beforeJson = entry.beforeState !== undefined ? JSON.stringify(entry.beforeState) : null
  const afterJson = entry.afterState !== undefined ? JSON.stringify(entry.afterState) : null
  const contextJson = entry.context !== undefined ? JSON.stringify(entry.context) : null

  const auditStatement = db
    .prepare(
      `INSERT INTO cc_audit_logs (actor_user_id, actor_name_snapshot, action, entity_type, entity_id, before_json, after_json, ip_address, context_json, success)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.actorUserId,
      entry.actorName,
      entry.action,
      entry.entityType,
      entry.entityId,
      beforeJson,
      afterJson,
      entry.ipAddress ?? null,
      contextJson,
      entry.success ? 1 : 0
    )

  const domainEventStatement = db
    .prepare(
      `INSERT INTO cc_domain_events (event_type, entity_type, entity_id, payload_json, actor_user_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      entry.action,
      entry.entityType,
      entry.entityId ?? '',
      JSON.stringify({ before: entry.beforeState ?? null, after: entry.afterState ?? null, context: entry.context ?? null, success: entry.success }),
      entry.actorUserId
    )

  return [auditStatement, domainEventStatement]
}

/** Recent Control Center audit log entries, most-recent-first — the real-data source for the Dashboard's "Recent Administrative Activity" panel (Phase 1 prompt Section 18). Never fabricated/mocked. */
export async function getRecentControlCenterAuditLogs(db: D1Database, limit = 25) {
  const { results } = await db
    .prepare('SELECT * FROM cc_audit_logs ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(limit)
    .all()
  return results
}
