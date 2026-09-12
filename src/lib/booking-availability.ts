/**
 * Booking Engine 2.0 — Availability computation (spec's core "AVAILABLE /
 * UNAVAILABLE / BLOCKED / BOOKED / MAINTENANCE / CLOSED" model).
 *
 * CAPACITY MODEL: a booking_resources row has capacity_units (never assumed
 * to be 1). At any given moment, a resource's REMAINING capacity for a
 * window = capacity_units - SUM(capacity consumed by active holds AND
 * active bookings overlapping that window). This module is the single
 * source of truth for that computation — every hold-creation and
 * booking-creation path MUST call `getRemainingCapacity` (or the atomic
 * `hasCapacityFor` used inside a transaction) rather than re-deriving
 * availability ad-hoc, exactly mirroring src/lib/services.ts's
 * isResourceAvailable single-responsibility pattern for the (simpler,
 * capacity-less) Service Engine case.
 *
 * TIMEZONE: all starts_at/ends_at are stored as ISO 8601 UTC strings (same
 * convention as the pre-existing bookings.starts_at/ends_at, migration
 * 0024). A resource's owning bookable_listing carries an explicit
 * `timezone` column (migration 0041) used ONLY for display/day-of-week
 * resolution of recurring rules — comparisons between two stored instants
 * are always done in UTC, which is what makes "a Lagos booking must not
 * shift on a different-timezone server" true by construction (no server
 * local time is ever consulted).
 */
import type { BookableListingRow, BookingResourceRow } from '../types'

export class BookingAvailabilityError extends Error {}

function toHHMM(iso: string): string {
  return iso.slice(11, 16)
}

/**
 * Resolves the day-of-week (0=Sunday, matching SQLite's strftime('%w')) an
 * ISO timestamp falls on, IN THE LISTING'S TIMEZONE — not the server's.
 * Since this runtime doesn't ship a full IANA tz database, we approximate
 * via a fixed per-country UTC offset table (spec's own "African markets"
 * scope — every listed timezone here is UTC+0..+3, no DST anywhere in
 * Africa) rather than pulling in a heavy tz library, while still being
 * correct for every currently-seeded country (migration 0040/0041).
 */
const TZ_OFFSET_HOURS: Record<string, number> = {
  'Africa/Lagos': 1,
  'Africa/Accra': 0,
  'Africa/Nairobi': 3,
  'Africa/Johannesburg': 2,
  'Africa/Kampala': 3,
  'Africa/Dar_es_Salaam': 3,
  'Africa/Kigali': 2,
  'Africa/Dakar': 0,
  'Africa/Abidjan': 0,
  'Africa/Douala': 1,
}

export function resolveDayOfWeekInTimezone(iso: string, timezone: string): number {
  const offsetHours = TZ_OFFSET_HOURS[timezone] ?? 0
  const utcDate = new Date(iso)
  const localMs = utcDate.getTime() + offsetHours * 3600_000
  return new Date(localMs).getUTCDay()
}

export function localHHMM(iso: string, timezone: string): string {
  const offsetHours = TZ_OFFSET_HOURS[timezone] ?? 0
  const utcDate = new Date(iso)
  const localMs = utcDate.getTime() + offsetHours * 3600_000
  return new Date(localMs).toISOString().slice(11, 16)
}

/** Checks a window against the resource's recurring weekly rules (capacity_override aware). Returns the capacity ceiling implied by rules for this window, or null if no rule covers it (caller decides whether "no rule" means closed or open — see isWithinScheduledHours). */
export async function getScheduledCapacityCeiling(
  db: D1Database,
  resource: BookingResourceRow,
  listing: BookableListingRow,
  startsAt: string,
  endsAt: string
): Promise<number | null> {
  const dayOfWeek = resolveDayOfWeekInTimezone(startsAt, listing.timezone)
  const startHHMM = localHHMM(startsAt, listing.timezone)
  const endHHMM = localHHMM(endsAt, listing.timezone)
  const dateOnly = startsAt.slice(0, 10)

  const rule = await db
    .prepare(
      `SELECT * FROM booking_availability_rules
       WHERE resource_id = ? AND day_of_week = ? AND is_active = 1
         AND start_time <= ? AND end_time >= ?
         AND (effective_from IS NULL OR effective_from <= ?)
         AND (effective_until IS NULL OR effective_until >= ?)
       ORDER BY capacity_override ASC LIMIT 1`
    )
    .bind(resource.id, dayOfWeek, startHHMM, endHHMM, dateOnly, dateOnly)
    .first<{ capacity_override: number | null }>()

  if (!rule) return null
  return rule.capacity_override ?? resource.capacity_units
}

/** Returns true if [startsAt, endsAt) overlaps ANY blackout/override block for this resource or its parent listing (migration 0024's booking_availability_blocks, extended with resource_id by migration 0039). */
export async function isBlockedByOverride(db: D1Database, listingId: number, resourceId: number, startsAt: string, endsAt: string): Promise<boolean> {
  const block = await db
    .prepare(
      `SELECT 1 FROM booking_availability_blocks
       WHERE (resource_id = ? OR (resource_id IS NULL AND listing_id = ?))
         AND blocked_from < ? AND blocked_until > ? LIMIT 1`
    )
    .bind(resourceId, listingId, endsAt, startsAt)
    .first()
  return !!block
}

/**
 * The single capacity-accounting query: how many capacity_units of this
 * resource are currently consumed by ACTIVE holds + ACTIVE booking
 * allocations overlapping [startsAt, endsAt). Active holds are those with
 * status='active' AND expires_at > now (an expired-but-not-yet-lazily-
 * cleaned hold must NOT count against capacity — see expireHoldIfNeeded in
 * booking-holds.ts, called before this in every real request path).
 */
export async function getConsumedCapacity(db: D1Database, resourceId: number, startsAt: string, endsAt: string): Promise<number> {
  const nowIso = new Date().toISOString()
  const [holdsRow, allocRow] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(capacity_requested), 0) AS total FROM booking_holds
         WHERE resource_id = ? AND status = 'active' AND expires_at > ?
           AND starts_at < ? AND ends_at > ?`
      )
      .bind(resourceId, nowIso, endsAt, startsAt)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(capacity_consumed), 0) AS total FROM booking_resource_allocations
         WHERE resource_id = ? AND status = 'active'
           AND starts_at < ? AND ends_at > ?`
      )
      .bind(resourceId, endsAt, startsAt)
      .first<{ total: number }>(),
  ])
  return (holdsRow?.total ?? 0) + (allocRow?.total ?? 0)
}

export interface AvailabilityResult {
  available: boolean
  reason?: 'outside_scheduled_hours' | 'blocked' | 'insufficient_capacity'
  remainingCapacity: number
  totalCapacity: number
}

/**
 * THE single availability-check entry point (spec's core requirement: never
 * offer a slot that's theoretically bookable but actually full/blocked).
 * requestedCapacity defaults to 1 (a single seat/room/appointment slot).
 *
 * NOTE ON RECURRING RULES: if a resource has ZERO booking_availability_rules
 * rows at all (the common case for a simple instant-book listing with no
 * explicit weekly schedule — e.g. a rental item with no "office hours"),
 * scheduling is treated as OPEN 24/7 by default rather than closed — a
 * resource only becomes hour-restricted once its provider explicitly
 * defines rules. This matches the spec's "not hardcoded per vertical"
 * intent: providers who need working hours define rules; providers who
 * don't (most rentals/events/pooled inventory) are not forced to.
 */
export async function checkAvailability(
  db: D1Database,
  listing: BookableListingRow,
  resource: BookingResourceRow,
  startsAt: string,
  endsAt: string,
  requestedCapacity = 1
): Promise<AvailabilityResult> {
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new BookingAvailabilityError('endsAt must be after startsAt')
  }

  const hasAnyRules = await db.prepare('SELECT 1 FROM booking_availability_rules WHERE resource_id = ? AND is_active = 1 LIMIT 1').bind(resource.id).first()
  let capacityCeiling = resource.capacity_units
  if (hasAnyRules) {
    const ceiling = await getScheduledCapacityCeiling(db, resource, listing, startsAt, endsAt)
    if (ceiling === null) {
      return { available: false, reason: 'outside_scheduled_hours', remainingCapacity: 0, totalCapacity: resource.capacity_units }
    }
    capacityCeiling = Math.min(capacityCeiling, ceiling)
  }

  const blocked = await isBlockedByOverride(db, listing.id, resource.id, startsAt, endsAt)
  if (blocked) {
    return { available: false, reason: 'blocked', remainingCapacity: 0, totalCapacity: resource.capacity_units }
  }

  const consumed = await getConsumedCapacity(db, resource.id, startsAt, endsAt)
  const remaining = capacityCeiling - consumed

  if (remaining < requestedCapacity) {
    return { available: false, reason: 'insufficient_capacity', remainingCapacity: Math.max(0, remaining), totalCapacity: resource.capacity_units }
  }

  return { available: true, remainingCapacity: remaining, totalCapacity: resource.capacity_units }
}

/** Capacity reporting for search/listing pages (spec's "total/reserved/available exposed to search" requirement) — a snapshot for a specific window, not a booking attempt. */
export async function getCapacityReport(db: D1Database, resource: BookingResourceRow, startsAt: string, endsAt: string) {
  const consumed = await getConsumedCapacity(db, resource.id, startsAt, endsAt)
  return {
    resource_id: resource.id,
    total_capacity: resource.capacity_units,
    reserved_capacity: consumed,
    available_capacity: Math.max(0, resource.capacity_units - consumed),
  }
}

/** All resources for a listing (a listing always has >=1, created alongside it — see bookings.ts's createBookableListing). */
export async function getResourcesForListing(db: D1Database, listingId: number): Promise<BookingResourceRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM booking_resources WHERE listing_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC')
    .bind(listingId)
    .all<BookingResourceRow>()
  return results
}

export async function getOwnedResource(db: D1Database, listingId: number, resourceId: number): Promise<BookingResourceRow | null> {
  return db.prepare('SELECT * FROM booking_resources WHERE id = ? AND listing_id = ?').bind(resourceId, listingId).first<BookingResourceRow>()
}
