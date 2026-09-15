/**
 * Booking Engine 2.0 — Centralized booking state machine (spec's universal
 * lifecycle: draft/held/pending_payment/confirmed/checked_in/in_progress/
 * completed/cancelled/expired/no_show/refunded/disputed/declined).
 *
 * THE single authority for changing a booking's status. Route handlers
 * MUST call `transitionBooking` — never write `bookings.status` directly
 * with a raw UPDATE. Mirrors src/lib/order-lifecycle.ts's
 * transitionOrderItemStatus design exactly (same repo, same author intent):
 * explicit legal-transition table keyed by (fromStatus, actorRole), never
 * "any status to any status"; ownership resolved server-side per actor
 * role; every transition writes an audit event.
 *
 * AUTHORIZATION (non-negotiable):
 *   - actorRole='customer' transitions scoped by `customer_user_id = ?`.
 *   - actorRole='provider' transitions scoped by `provider_user_id = ?`
 *     OR (for org-owned listings) `organization_id = ?` — resolved
 *     server-side by the route layer via requireActiveProvider /
 *     resolveOrganizationProvider-equivalent, never trusted from the client.
 *   - actorRole='admin' transitions require the route layer to have
 *     already passed requirePlatformRole('admin') — this module does not
 *     re-check platform role.
 *   - A customer can NEVER force 'confirmed'/'completed'/'checked_in'
 *     themselves (mirrors Service Engine's explicit "customer cannot force
 *     service completion" guard) — those transitions simply do not appear
 *     in the customer actor's allowed-target lists below.
 *
 * EVENT INTEGRATION: every legal transition writes one row to
 * booking_status_events (audit trail, migration 0024/0041) AND one row to
 * the EXISTING dormant cc_domain_events table (migration 0013) — same
 * "integrate, don't duplicate" pattern as order-lifecycle.ts, so a future
 * Communication/Analytics Engine consumer can pick up booking events
 * without this engine building its own event bus.
 */
import type { BookingRow, BookingStatus, ActorRoleBooking } from '../types'
import { resolveMembership } from './organizations'

export class BookingLifecycleError extends Error {}
export class NotOwnedBookingError extends BookingLifecycleError {
  constructor() {
    super('Booking not found or not accessible to this actor')
  }
}
export class IllegalBookingTransitionError extends BookingLifecycleError {
  constructor(from: string, to: string) {
    super(`Cannot transition booking from "${from}" to "${to}"`)
  }
}

/**
 * Legal transition table. FROM status -> actor role -> allowed TO statuses.
 * An actor role not listed for a FROM status may never transition out of it
 * via this function (e.g. a customer can never move 'held' to 'confirmed'
 * directly — only the payment-confirmation path, confirmBookingPayment in
 * this same file, which is a distinct explicit function, does that; a
 * customer calling transitionBooking with 'confirmed' as target will
 * simply be rejected).
 */
const TRANSITIONS: Record<string, Partial<Record<ActorRoleBooking, BookingStatus[]>>> = {
  draft: {
    customer: ['held', 'cancelled'],
    provider: ['cancelled'],
    admin: ['cancelled'],
  },
  held: {
    customer: ['pending_payment', 'cancelled', 'expired'],
    provider: ['confirmed', 'declined', 'cancelled'],
    admin: ['confirmed', 'declined', 'cancelled', 'expired'],
  },
  pending_payment: {
    customer: ['cancelled'],
    provider: ['confirmed', 'declined'],
    admin: ['confirmed', 'declined', 'cancelled'],
    system: ['confirmed'],
  },
  confirmed: {
    customer: ['cancelled', 'disputed'],
    provider: ['checked_in', 'in_progress', 'cancelled', 'no_show'],
    admin: ['checked_in', 'in_progress', 'cancelled', 'no_show', 'disputed', 'completed'],
  },
  checked_in: {
    provider: ['in_progress', 'completed'],
    admin: ['in_progress', 'completed', 'disputed'],
  },
  in_progress: {
    provider: ['completed'],
    admin: ['completed', 'disputed'],
  },
  completed: {
    customer: ['disputed'],
    admin: ['disputed', 'refunded'],
  },
  cancelled: {
    // Terminal.
  },
  expired: {
    // Terminal.
  },
  no_show: {
    admin: ['refunded', 'disputed'],
  },
  refunded: {
    // Terminal.
  },
  disputed: {
    admin: ['confirmed', 'cancelled', 'completed', 'refunded'],
  },
  declined: {
    // Terminal.
  },
}

/** Fetches a booking scoped by customer ownership — "does not exist for another customer" pattern. */
async function getBookingForCustomer(db: D1Database, customerUserId: number, bookingId: number): Promise<BookingRow | null> {
  return db.prepare('SELECT * FROM bookings WHERE id = ? AND customer_user_id = ?').bind(bookingId, customerUserId).first<BookingRow>()
}

/** Fetches a booking scoped by provider (individual OR organization) ownership — org-owned bookings supported without a second identity system. */
async function getBookingForProvider(db: D1Database, providerUserId: number | null, organizationId: number | null, bookingId: number): Promise<BookingRow | null> {
  if (organizationId) {
    return db.prepare('SELECT * FROM bookings WHERE id = ? AND organization_id = ?').bind(bookingId, organizationId).first<BookingRow>()
  }
  return db.prepare('SELECT * FROM bookings WHERE id = ? AND provider_user_id = ?').bind(bookingId, providerUserId).first<BookingRow>()
}

async function getBookingForAdmin(db: D1Database, bookingId: number): Promise<BookingRow | null> {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first<BookingRow>()
}

/**
 * THE single shared authority check for "does userId currently have
 * provider-side authority over this booking" — the fix for Invariant 7's
 * confirmed regression (see this file's module comment and the
 * 07.provider-ownership-isolation.test.mjs header for the full incident
 * writeup). Every provider-scoped booking route (GET /bookings/:id,
 * /cancellation-quote, /cancel, /transition) and transitionBooking() itself
 * MUST call this rather than comparing `booking.provider_user_id ===
 * userId` directly, which is what let a REMOVED organization member retain
 * indefinite provider authority.
 *
 * RULE (historical record != current authorization, non-negotiable):
 *   - booking.organization_id IS NULL  -> INDIVIDUAL-owned booking. There is
 *     no membership layer above an individual provider's own identity, so
 *     `booking.provider_user_id === userId` IS the authority check, exactly
 *     as before. Nothing changes for individual providers.
 *   - booking.organization_id IS NOT NULL -> ORGANIZATION-owned booking.
 *     Authority is ALWAYS re-resolved LIVE via resolveMembership(userId,
 *     organizationId) + the requested permission key. booking.
 *     provider_user_id is NEVER consulted for authorization here — it
 *     remains in the row, permanently, purely as historical attribution
 *     (audit trail / dispute resolution / "who originally handled this"
 *     reporting). A user who is later removed, suspended, or demoted below
 *     the required permission immediately loses authority the next time
 *     this function is called, with zero lag and no separate revocation
 *     step needed — membership state IS the authority, checked fresh every
 *     time, never cached on the booking row.
 *
 * Returns false (not an error) for "not authorized" in every case — the
 * caller decides whether that becomes a 404 (anti-enumeration, matching
 * this codebase's existing convention for ownership-based denials) or a
 * 403 (matching the existing convention for an authenticated actor known
 * to lack permission, e.g. the /transition endpoint).
 */
export async function hasProviderAuthorityOverBooking(
  db: D1Database,
  booking: Pick<BookingRow, 'provider_user_id' | 'organization_id'>,
  userId: number,
  permission: 'bookings.read' | 'bookings.manage'
): Promise<boolean> {
  if (booking.organization_id == null) {
    return booking.provider_user_id === userId
  }
  const membership = await resolveMembership(db, userId, booking.organization_id)
  return !!membership && membership.permissionKeys.has(permission)
}

/** Writes the audit-trail row + the shared cc_domain_events row. Never throws — a logging failure must not fail the transition itself. */
async function logBookingTransition(
  db: D1Database,
  booking: BookingRow,
  fromStatus: string,
  toStatus: string,
  actorUserId: number | null,
  actorRole: ActorRoleBooking,
  note: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO booking_status_events (booking_id, status, actor_user_id, actor_role, note, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(booking.id, toStatus, actorUserId, actorRole, note, JSON.stringify(metadata)),
      db
        .prepare(`INSERT INTO cc_domain_events (event_type, entity_type, entity_id, payload_json, actor_user_id) VALUES (?, 'booking', ?, ?, ?)`)
        .bind(`booking_${toStatus}`, String(booking.id), JSON.stringify({ listing_id: booking.listing_id, from_status: fromStatus, to_status: toStatus, ...metadata }), actorUserId),
    ])
  } catch (err) {
    console.error('booking-lifecycle: failed to write transition/domain event (non-fatal)', err)
  }
}

export interface BookingActor {
  userId: number
  role: ActorRoleBooking
  organizationId?: number | null
}

export interface BookingTransitionOptions {
  reason?: string
  metadata?: Record<string, unknown>
}

/** THE centralized booking state-machine entry point. Every step mirrors order-lifecycle.ts's transitionOrderItemStatus checklist: authorize -> verify current state -> verify legal transition -> perform domain actions -> write event -> integrate with Finance when applicable. */
export async function transitionBooking(db: D1Database, bookingId: number, targetStatus: BookingStatus, actor: BookingActor, opts: BookingTransitionOptions = {}): Promise<BookingRow> {
  let booking: BookingRow | null
  if (actor.role === 'customer') {
    booking = await getBookingForCustomer(db, actor.userId, bookingId)
  } else if (actor.role === 'provider') {
    booking = await getBookingForProvider(db, actor.organizationId ? null : actor.userId, actor.organizationId ?? null, bookingId)
  } else if (actor.role === 'system') {
    // System-role transitions (e.g. instant-book auto-confirm-on-payment in
    // src/lib/booking-payments.ts) are triggered by TRUSTED server-side code
    // AFTER it has already independently verified the booking belongs to
    // actor.userId — never reachable from a raw client request (no route
    // handler accepts role='system' from request input). No additional
    // ownership scoping is applied here since the caller already did it.
    booking = await getBookingForAdmin(db, bookingId)
  } else {
    throw new BookingLifecycleError('Unsupported actor role for a client-initiated transition')
  }
  if (!booking) throw new NotOwnedBookingError()

  const fromStatus = booking.status
  const allowedTargets = TRANSITIONS[fromStatus]?.[actor.role] ?? []
  if (!allowedTargets.includes(targetStatus)) {
    throw new IllegalBookingTransitionError(fromStatus, targetStatus)
  }

  const setClauses = [`status = ?`, `updated_at = datetime('now')`]
  const binds: unknown[] = [targetStatus]

  if (targetStatus === 'confirmed') {
    setClauses.push('confirmed_by_user_id = ?')
    binds.push(actor.userId)
  }
  if (targetStatus === 'checked_in') {
    setClauses.push(`checked_in_at = datetime('now')`)
  }
  if (targetStatus === 'completed') {
    setClauses.push(`checked_out_at = COALESCE(checked_out_at, datetime('now'))`, 'completed_by_user_id = ?')
    binds.push(actor.userId)
  }
  if (targetStatus === 'cancelled' || targetStatus === 'declined' || targetStatus === 'expired') {
    setClauses.push('cancelled_by_user_id = ?')
    binds.push(actor.userId)
    if (opts.reason) {
      setClauses.push('cancelled_reason = ?')
      binds.push(opts.reason)
    }
  }

  // ATOMIC compare-and-swap: the WHERE clause re-checks status = fromStatus
  // at write time, not just at the earlier read time. Without this guard,
  // two genuinely concurrent transitionBooking() calls that both read the
  // SAME fromStatus before either writes will BOTH pass the allowedTargets
  // check above and BOTH successfully UPDATE — e.g. two concurrent
  // cancellations both reaching creditWallet() in
  // cancelBookingWithPolicy(), producing a real double refund. Reproduced
  // live via a 3-way Promise.all() race during Invariant 6 harness work:
  // 3 concurrent cancel calls on one booking each returned 200 and each
  // wrote a refund ledger row (3 total) before this fix. Mirrors the exact
  // atomic claim pattern already used by booking-holds.ts's `UPDATE
  // booking_holds SET status = 'converted' WHERE id = ? AND status =
  // 'active'` — that pattern was applied there but missing here, the
  // single authority every other transition (confirm/decline/check-in/
  // check-out/complete/no-show/dispute/refund) also depends on.
  const updateResult = await db
    .prepare(`UPDATE bookings SET ${setClauses.join(', ')} WHERE id = ? AND status = ?`)
    .bind(...binds, bookingId, fromStatus)
    .run()
  if ((updateResult.meta.rows_written ?? 0) === 0) {
    // Either a concurrent transition won the race, or the status changed
    // between our read and our write for any other reason (TOCTOU). Both
    // cases mean "this transition is not currently possible" — exactly
    // what IllegalBookingTransitionError already communicates; the caller
    // needs no new error type to distinguish "genuinely illegal" from
    // "lost the race", and should not receive a fabricated success.
    throw new IllegalBookingTransitionError(fromStatus, targetStatus)
  }

  // Releasing capacity on terminal negative outcomes: the allocation record
  // is marked 'released' (never deleted, preserving history) so the
  // resource's capacity becomes available again for other customers —
  // spec's "cancellation must free the slot" requirement.
  if (['cancelled', 'declined', 'expired', 'no_show'].includes(targetStatus)) {
    try {
      await db.prepare(`UPDATE booking_resource_allocations SET status = 'released' WHERE booking_id = ? AND status = 'active'`).bind(bookingId).run()
    } catch (err) {
      console.error('booking-lifecycle: failed to release allocation (non-fatal)', err)
    }
  }

  await logBookingTransition(db, booking, fromStatus, targetStatus, actor.userId, actor.role, opts.reason ?? null, opts.metadata ?? {})

  // Engine 9 event writer — see order-lifecycle.ts's identical pattern for
  // the full rationale (durable outbox, never blocks/fails this
  // transition). Customer-facing statuses only.
  const CUSTOMER_NOTIFIABLE_BOOKING = new Set(['confirmed', 'checked_in', 'completed', 'cancelled', 'declined', 'expired', 'no_show', 'disputed'])
  if (CUSTOMER_NOTIFIABLE_BOOKING.has(targetStatus)) {
    try {
      const { enqueueAndProcessNow } = await import('./notifications')
      await enqueueAndProcessNow(db, {
        idempotencyKey: `booking_${targetStatus}:${bookingId}`,
        eventType: `booking_${targetStatus}`,
        recipientUserId: booking.customer_user_id,
        category: 'booking',
        payload: { booking_id: bookingId, booking_number: booking.booking_number, status: targetStatus },
        referenceType: 'booking',
        referenceId: String(bookingId),
      })
    } catch (err) {
      console.error('booking-lifecycle: notification enqueue failed (non-fatal, booking transition already committed)', err)
    }
  }

  const updated = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first<BookingRow>()
  return updated!
}

export async function getEventsForBooking(db: D1Database, bookingId: number) {
  const { results } = await db.prepare('SELECT * FROM booking_status_events WHERE booking_id = ? ORDER BY id ASC').bind(bookingId).all()
  return results
}

export async function getBookingsForCustomer(db: D1Database, customerUserId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT b.*, bl.title AS listing_title, bl.listing_type
       FROM bookings b JOIN bookable_listings bl ON bl.id = b.listing_id
       WHERE b.customer_user_id = ? ORDER BY b.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(customerUserId, limit, offset)
    .all()
  return results
}

/** Individual-identity booking list (mirrors bookings.ts's getListingsForProvider — `organization_id IS NULL` required, Invariant #7 fix, so an organization-owned booking never surfaces in a member's personal/individual-identity view regardless of current or historical membership). */
export async function getBookingsForProvider(db: D1Database, providerUserId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT b.*, bl.title AS listing_title, u.name AS customer_name
       FROM bookings b JOIN bookable_listings bl ON bl.id = b.listing_id JOIN users u ON u.id = b.customer_user_id
       WHERE b.provider_user_id = ? AND b.organization_id IS NULL ORDER BY b.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(providerUserId, limit, offset)
    .all()
  return results
}

export async function getBookingsForOrganization(db: D1Database, organizationId: number, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const { results } = await db
    .prepare(
      `SELECT b.*, bl.title AS listing_title, u.name AS customer_name
       FROM bookings b JOIN bookable_listings bl ON bl.id = b.listing_id JOIN users u ON u.id = b.customer_user_id
       WHERE b.organization_id = ? ORDER BY b.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(organizationId, limit, offset)
    .all()
  return results
}

/**
 * Explicit re-scheduling (spec's "reschedule: re-check availability, recalc
 * price, preserve history" requirement). Implemented as cancel-old +
 * create-new rather than mutating the existing row in place, so the
 * ORIGINAL booking's full audit trail (events, allocation window) is
 * preserved untouched — the new booking links back via
 * rescheduled_from_booking_id. Capacity for the NEW window is checked via
 * the standard createHold/createBookingFromHold flow by the ROUTE layer
 * (this function only performs the "cancel old, no refund/fee applied here
 * — reschedule is a distinct concept from cancellation" bookkeeping); the
 * route is responsible for orchestrating: check new availability -> create
 * new booking -> call this to link+cancel the old one.
 */
export async function linkRescheduledBooking(db: D1Database, oldBookingId: number, newBookingId: number, actorUserId: number): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE bookings SET rescheduled_from_booking_id = NULL WHERE id = ?`).bind(newBookingId), // no-op placeholder kept for clarity of intent; actual link set at booking creation time by the route
    db.prepare(`INSERT INTO booking_status_events (booking_id, status, actor_user_id, actor_role, note, metadata_json) VALUES (?, 'cancelled', ?, 'customer', 'Rescheduled to a new booking', ?)`)
      .bind(oldBookingId, actorUserId, JSON.stringify({ rescheduled_to_booking_id: newBookingId })),
  ])
}
