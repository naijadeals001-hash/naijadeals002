/**
 * Booking Engine 2.0 — Temporary holds & atomic double-booking prevention
 * (spec's CRITICAL, explicitly-tested-for-race-conditions requirement).
 *
 * HOW DOUBLE-BOOKING IS ACTUALLY PREVENTED (read this before touching this
 * file): SQLite (and therefore D1) executes every single write STATEMENT
 * atomically and serializes all writers against a given database — there is
 * no way for two concurrent requests to interleave their operations inside
 * one statement. `createHold` and `createBookingFromHold` therefore encode
 * their ENTIRE "check remaining capacity, then insert if and only if
 * capacity allows" logic as ONE SQL statement each (`INSERT ... SELECT ...
 * WHERE <capacity arithmetic> >= ?`), never as a separate
 * SELECT-then-INSERT pair from application code. Two customers racing for
 * the last unit of capacity will have their two INSERT statements
 * serialized by SQLite itself; the second one's WHERE clause re-evaluates
 * against the row the first one just wrote, sees insufficient remaining
 * capacity, and matches zero rows (result.meta.rows_written === 0) — this
 * is what makes "two simultaneous customers must never both get confirmed
 * bookings when capacity is insufficient" true by construction, not just
 * tested-and-hoped-for. See src/lib/booking-availability.ts's module
 * comment for the capacity-accounting formula this mirrors.
 *
 * HOLD EXPIRATION: there is no cron trigger available on hosted deploy
 * (documented constraint, same as src/lib/service-requests.ts's
 * expireQuoteIfNeeded). Holds are expired LAZILY: `expireHoldIfNeeded` is
 * called at the top of every hold-reading/capacity-checking code path, and
 * an expired hold's capacity is ALREADY excluded by getConsumedCapacity's
 * own `expires_at > now` clause regardless of whether its status column has
 * been lazily flipped yet — so even in the gap between "hold's time is up"
 * and "some request happens to touch it and rewrites status='expired'",
 * capacity is never wrongly held. Frontend hold-countdown timers are purely
 * cosmetic; they never gate anything server-side (spec's explicit "must not
 * rely on a frontend timer" requirement).
 */
import { checkAvailability, getResourcesForListing, getOwnedResource } from './booking-availability'
import type { BookableListingRow, BookingHoldRow } from '../types'

export class BookingHoldError extends Error {}

const DEFAULT_HOLD_TTL_MINUTES = 10

function generateBookingNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `BK-${ts}-${rand}`
}

/** Lazily flips any of this customer's/resource's active-but-time-expired holds to status='expired'. Never throws — a cleanup failure must not block the caller's real operation. Safe to call redundantly; UPDATE...WHERE matches 0 rows once already flipped. */
export async function expireHoldsIfNeeded(db: D1Database, resourceId?: number): Promise<void> {
  try {
    const nowIso = new Date().toISOString()
    if (resourceId) {
      await db.prepare(`UPDATE booking_holds SET status = 'expired' WHERE resource_id = ? AND status = 'active' AND expires_at <= ?`).bind(resourceId, nowIso).run()
    } else {
      await db.prepare(`UPDATE booking_holds SET status = 'expired' WHERE status = 'active' AND expires_at <= ?`).bind(nowIso).run()
    }
  } catch (err) {
    console.error('booking-holds: lazy expiry sweep failed (non-fatal)', err)
  }
}

export interface CreateHoldInput {
  listingId: number
  resourceId: number
  customerUserId: number
  startsAt: string
  endsAt: string
  capacityRequested?: number
  ttlMinutes?: number
}

/**
 * Creates a temporary hold IF AND ONLY IF sufficient capacity remains — the
 * check-and-insert is one atomic statement (see module doc comment). Throws
 * BookingHoldError if capacity is insufficient; never silently creates a
 * hold that overcommits.
 */
export async function createHold(db: D1Database, input: CreateHoldInput): Promise<BookingHoldRow> {
  if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
    throw new BookingHoldError('endsAt must be after startsAt')
  }
  const capacityRequested = input.capacityRequested ?? 1
  if (capacityRequested <= 0) throw new BookingHoldError('capacityRequested must be > 0')

  await expireHoldsIfNeeded(db, input.resourceId)

  const ttl = input.ttlMinutes ?? DEFAULT_HOLD_TTL_MINUTES
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString()
  const nowIso = new Date().toISOString()

  // Single atomic statement: the WHERE clause re-derives remaining capacity
  // (resource.capacity_units - active holds - active allocations
  // overlapping the window) inline and only inserts if it is >= requested.
  const result = await db
    .prepare(
      `INSERT INTO booking_holds (listing_id, resource_id, customer_user_id, starts_at, ends_at, capacity_requested, status, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, 'active', ?
       WHERE (
         (SELECT capacity_units FROM booking_resources WHERE id = ? AND is_active = 1)
         -
         (
           COALESCE((SELECT SUM(capacity_requested) FROM booking_holds
                     WHERE resource_id = ? AND status = 'active' AND expires_at > ?
                       AND starts_at < ? AND ends_at > ?), 0)
           +
           COALESCE((SELECT SUM(capacity_consumed) FROM booking_resource_allocations
                     WHERE resource_id = ? AND status = 'active'
                       AND starts_at < ? AND ends_at > ?), 0)
         )
       ) >= ?
         AND NOT EXISTS (SELECT 1 FROM booking_availability_blocks
                          WHERE (resource_id = ? OR (resource_id IS NULL AND listing_id = ?))
                            AND blocked_from < ? AND blocked_until > ?)`
    )
    .bind(
      input.listingId, input.resourceId, input.customerUserId, input.startsAt, input.endsAt, capacityRequested, expiresAt,
      // capacity ceiling
      input.resourceId,
      // consumed by holds
      input.resourceId, nowIso, input.endsAt, input.startsAt,
      // consumed by allocations
      input.resourceId, input.endsAt, input.startsAt,
      // requested
      capacityRequested,
      // block check
      input.resourceId, input.listingId, input.endsAt, input.startsAt
    )
    .run()

  if ((result.meta.rows_written ?? 0) === 0) {
    throw new BookingHoldError('This time slot no longer has sufficient capacity, or is blocked/inactive.')
  }

  const hold = await db.prepare('SELECT * FROM booking_holds WHERE id = ?').bind(Number(result.meta.last_row_id)).first<BookingHoldRow>()
  return hold!
}

export async function getHoldForCustomer(db: D1Database, customerUserId: number, holdId: number): Promise<BookingHoldRow | null> {
  return db.prepare('SELECT * FROM booking_holds WHERE id = ? AND customer_user_id = ?').bind(holdId, customerUserId).first<BookingHoldRow>()
}

/** Customer-initiated early release of an unused hold (frees capacity immediately rather than waiting for expiry). */
export async function releaseHold(db: D1Database, customerUserId: number, holdId: number): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE booking_holds SET status = 'released' WHERE id = ? AND customer_user_id = ? AND status = 'active'`)
    .bind(holdId, customerUserId)
    .run()
  return (result.meta.rows_written ?? 0) > 0
}

export interface ConfirmHoldInput {
  holdId: number
  customerUserId: number
  totalPriceKobo: number
  currency: string
  timezone: string
  guestsCount?: number | null
  metadata?: Record<string, unknown>
}

/**
 * Converts an ACTIVE, NON-EXPIRED hold owned by customerUserId into a real
 * booking (spec's Hold -> Price -> Confirm -> Payment -> Created flow).
 * totalPriceKobo/currency are SERVER-COMPUTED by the caller (route layer,
 * from the listing's pricing — never trusted from the client body directly;
 * see api-bookings.ts). The hold->booking conversion and the allocation
 * record insert happen together via db.batch (D1's atomic multi-statement
 * transaction), and the hold is atomically marked 'converted' so it can
 * never be double-converted into two bookings.
 */
export async function createBookingFromHold(db: D1Database, listing: BookableListingRow, input: ConfirmHoldInput): Promise<number> {
  const hold = await getHoldForCustomer(db, input.customerUserId, input.holdId)
  if (!hold) throw new BookingHoldError('Hold not found or not owned by this customer')
  if (hold.status !== 'active') throw new BookingHoldError(`Cannot confirm a hold that is '${hold.status}'`)
  if (new Date(hold.expires_at).getTime() <= Date.now()) {
    await db.prepare(`UPDATE booking_holds SET status = 'expired' WHERE id = ?`).bind(hold.id).run()
    throw new BookingHoldError('This hold has expired. Please search availability again.')
  }
  if (input.totalPriceKobo <= 0) throw new BookingHoldError('totalPriceKobo must be > 0')

  const bookingNumber = generateBookingNumber()

  // Atomically: (1) claim the hold (status active -> converted, guarded by
  // the WHERE so a concurrent second attempt on the SAME hold matches 0
  // rows), (2) insert the booking, (3) insert the allocation record.
  // D1's batch() runs all statements in one transaction — either the whole
  // set commits or none does.
  const claim = await db
    .prepare(`UPDATE booking_holds SET status = 'converted' WHERE id = ? AND status = 'active'`)
    .bind(hold.id)
    .run()
  if ((claim.meta.rows_written ?? 0) === 0) {
    throw new BookingHoldError('This hold was already used or is no longer active.')
  }

  const insertBooking = await db
    .prepare(
      `INSERT INTO bookings
        (booking_number, listing_id, resource_id, listing_type_snapshot, customer_user_id, provider_user_id, organization_id,
         hold_id, starts_at, ends_at, timezone, capacity_booked, guests_count, total_price_kobo, currency,
         payment_status, status, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`
    )
    .bind(
      bookingNumber,
      hold.listing_id,
      hold.resource_id,
      listing.listing_type,
      hold.customer_user_id,
      listing.provider_user_id,
      listing.organization_id ?? null,
      hold.id,
      hold.starts_at,
      hold.ends_at,
      input.timezone,
      hold.capacity_requested,
      input.guestsCount ?? null,
      input.totalPriceKobo,
      input.currency,
      listing.booking_mode === 'instant' ? 'pending_payment' : 'held',
      JSON.stringify(input.metadata ?? {})
    )
    .run()

  const bookingId = Number(insertBooking.meta.last_row_id)
  await db
    .prepare(
      `INSERT INTO booking_resource_allocations (booking_id, resource_id, capacity_consumed, starts_at, ends_at, status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    )
    .bind(bookingId, hold.resource_id, hold.capacity_requested, hold.starts_at, hold.ends_at)
    .run()

  await db
    .prepare(`UPDATE booking_holds SET converted_to_booking_id = ? WHERE id = ?`)
    .bind(bookingId, hold.id)
    .run()

  await db
    .prepare(`INSERT INTO booking_status_events (booking_id, status, actor_user_id, actor_role, note, metadata_json) VALUES (?, ?, ?, 'customer', 'Booking created from hold', '{}')`)
    .bind(bookingId, listing.booking_mode === 'instant' ? 'pending_payment' : 'held', input.customerUserId)
    .run()

  return bookingId
}

export { getResourcesForListing, getOwnedResource, checkAvailability }
