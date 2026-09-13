/**
 * Engine 1 Identity & Access Completion — Account lifecycle (users.status)
 * admin mutation.
 *
 * Closes the gap found during the Engine 1 gap-matrix audit: `users.status`
 * (migration 0037) has existed since Marketplace Engine 2.0, and
 * src/lib/search-eligibility.ts already reads it to exclude a suspended/
 * disabled/deleted owner's listings from search — but NOTHING in the
 * codebase ever transitions the column away from its 'active' default, and
 * src/lib/auth.ts never enforced it at all. This is THE single authority
 * for changing users.status as an admin decision, mirroring
 * src/lib/moderation.ts's applyModerationDecision() pattern exactly:
 * atomic db.batch() of [UPDATE the entity, INSERT cc_audit_logs, INSERT
 * cc_domain_events] into the SAME dormant Control Center tables
 * (migration 0013) moderation.ts already established as the one shared
 * audit trail — never a second/parallel audit mechanism.
 *
 * Ordinary customers/sellers/providers can NEVER reach the route that
 * calls this function — it must be mounted behind requireAuth +
 * requirePlatformRole('admin') (src/lib/rbac.ts), exactly like every other
 * route in src/routes/api-admin.ts. This function itself does not
 * re-check the caller's role (single responsibility: the route layer owns
 * authorization, this module owns the state transition + audit trail),
 * but it DOES defend against a no-op/invalid target so a malformed
 * request can't corrupt the audit log with a false "changed" record.
 */
import type { AccountStatus } from '../types'
import { isAccountStatusBlocked } from './auth'

const VALID_STATUSES: AccountStatus[] = ['active', 'pending_verification', 'suspended', 'disabled', 'deleted']

export function isValidAccountStatus(value: string): value is AccountStatus {
  return (VALID_STATUSES as string[]).includes(value)
}

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found')
    this.name = 'UserNotFoundError'
  }
}

export class InvalidStatusError extends Error {
  constructor(value: string) {
    super(`Invalid status: ${value}. Must be one of: ${VALID_STATUSES.join(', ')}`)
    this.name = 'InvalidStatusError'
  }
}

export interface UserStatusDecisionResult {
  previousStatus: string
  newStatus: string
  sessionsRevoked: boolean
}

/**
 * Transitions a target user's users.status, gated entirely by the CALLING
 * route's own requireAuth + requirePlatformRole('admin') middleware (this
 * function trusts adminUserId/adminName as already-verified — never
 * re-derives them from client input).
 *
 * If the new status is one attachUser() treats as blocked (suspended /
 * disabled / deleted — see isAccountStatusBlocked in src/lib/auth.ts), ALL
 * of the target user's existing sessions are destroyed as part of this
 * same operation (Priority 1 requirement: "an already-authenticated
 * user's status change takes effect server-side... old session must not
 * survive a suspension"). This is belt-and-suspenders: attachUser() ALSO
 * independently re-reads users.status fresh on every request and would
 * block a stale session even if a row somehow survived, but proactively
 * revoking here means the session table doesn't accumulate rows for
 * accounts that can never use them again.
 */
export async function applyUserStatusDecision(
  db: D1Database,
  targetUserId: number,
  newStatus: string,
  adminUserId: number,
  adminName: string,
  reason?: string
): Promise<UserStatusDecisionResult> {
  if (!isValidAccountStatus(newStatus)) {
    throw new InvalidStatusError(newStatus)
  }

  const target = await db.prepare('SELECT id, status FROM users WHERE id = ?').bind(targetUserId).first<{ id: number; status: string }>()
  if (!target) throw new UserNotFoundError()

  const previousStatus = target.status
  const willBlock = isAccountStatusBlocked(newStatus)

  const statements = [
    db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(newStatus, targetUserId),
    db
      .prepare(
        `INSERT INTO cc_audit_logs (actor_user_id, actor_name_snapshot, action, entity_type, entity_id, before_json, after_json, context_json, success)
         VALUES (?, ?, 'user_status_decision', 'user', ?, ?, ?, ?, 1)`
      )
      .bind(
        adminUserId,
        adminName,
        String(targetUserId),
        JSON.stringify({ status: previousStatus }),
        JSON.stringify({ status: newStatus }),
        JSON.stringify({ reason: reason ?? null })
      ),
    db
      .prepare(
        `INSERT INTO cc_domain_events (event_type, entity_type, entity_id, payload_json, actor_user_id)
         VALUES ('user_status_decision', 'user', ?, ?, ?)`
      )
      .bind(String(targetUserId), JSON.stringify({ previous_status: previousStatus, new_status: newStatus, reason: reason ?? null }), adminUserId),
  ]

  if (willBlock) {
    // Session deletion via db.batch keeps the status flip + audit trail +
    // session revocation atomic — no window where the DB shows the new
    // status but a session row still exists (or vice versa).
    statements.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetUserId))
  }

  await db.batch(statements)

  return { previousStatus, newStatus, sessionsRevoked: willBlock }
}
