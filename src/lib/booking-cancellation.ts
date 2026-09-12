/**
 * Booking Engine 2.0 — Policy-driven cancellation (spec: "the Booking
 * Engine decides permission + rule, the Payment Engine executes the
 * refund"). No new ledger — refunds/charges execute through the EXISTING
 * wallet_ledger via src/lib/wallet.ts's creditWallet/debitWallet, exactly
 * mirroring Marketplace 2.1's src/lib/refunds.ts pattern.
 */
import { transitionBooking, type BookingActor } from './booking-lifecycle'
import { creditWallet } from './wallet'
import type { BookingRow, BookingCancellationPolicyRow } from '../types'

export class BookingCancellationError extends Error {}

/** Fetches the effective cancellation policy for a booking: booking-level override, else the listing's own policy, else a hardcoded sane default (100% refund if >24h out, 0% after) — never silently 0% for a listing with no configured policy (spec: reusable structures, not hardcoded NAMES, but a safe numeric default is required so a listing without an explicit policy still behaves sanely). */
export async function getEffectivePolicyForBooking(db: D1Database, booking: BookingRow): Promise<BookingCancellationPolicyRow> {
  if (booking.cancellation_policy_id) {
    const p = await db.prepare('SELECT * FROM booking_cancellation_policies WHERE id = ?').bind(booking.cancellation_policy_id).first<BookingCancellationPolicyRow>()
    if (p) return p
  }
  const listing = await db.prepare('SELECT cancellation_policy_id FROM bookable_listings WHERE id = ?').bind(booking.listing_id).first<{ cancellation_policy_id: number | null }>()
  if (listing?.cancellation_policy_id) {
    const p = await db.prepare('SELECT * FROM booking_cancellation_policies WHERE id = ?').bind(listing.cancellation_policy_id).first<BookingCancellationPolicyRow>()
    if (p) return p
  }
  return {
    id: 0,
    owner_user_id: null,
    organization_id: null,
    name: 'Default Moderate Policy',
    policy_type: 'moderate',
    cutoff_hours_before_start: 24,
    refund_percentage_before_cutoff: 100,
    refund_percentage_after_cutoff: 0,
    flat_fee_kobo: 0,
    is_active: 1,
    created_at: new Date().toISOString(),
  }
}

export interface CancellationQuote {
  policy: BookingCancellationPolicyRow
  hoursUntilStart: number
  isBeforeCutoff: boolean
  refundPercentage: number
  refundAmountKobo: number
  feeAmountKobo: number
}

/** Computes what a cancellation RIGHT NOW would cost/refund, without executing it — used to show the customer a quote before they confirm. */
export async function quoteCancellation(db: D1Database, booking: BookingRow): Promise<CancellationQuote> {
  const policy = await getEffectivePolicyForBooking(db, booking)
  const hoursUntilStart = (new Date(booking.starts_at).getTime() - Date.now()) / 3_600_000
  const isBeforeCutoff = hoursUntilStart >= policy.cutoff_hours_before_start
  const refundPercentage = isBeforeCutoff ? policy.refund_percentage_before_cutoff : policy.refund_percentage_after_cutoff

  const paidAmountKobo = booking.payment_status === 'escrow_held' || booking.payment_status === 'released' ? booking.total_price_kobo : 0
  const grossRefund = Math.round((paidAmountKobo * refundPercentage) / 100)
  const feeAmountKobo = Math.min(policy.flat_fee_kobo, grossRefund)
  const refundAmountKobo = Math.max(0, grossRefund - feeAmountKobo)

  return { policy, hoursUntilStart, isBeforeCutoff, refundPercentage, refundAmountKobo, feeAmountKobo }
}

/**
 * Executes a customer- or provider-initiated cancellation: computes the
 * policy-driven refund, transitions the booking to 'cancelled' via the
 * centralized state machine (never a raw status UPDATE), stamps the
 * fee/refund amounts, and — if a payment was actually captured (escrow_held
 * or released) — credits the customer's wallet for the refund portion via
 * the EXISTING creditWallet ledger. A booking still 'unpaid'/'held' simply
 * cancels with a 0 refund (nothing was ever captured).
 */
export async function cancelBookingWithPolicy(db: D1Database, bookingId: number, actor: BookingActor, reason?: string): Promise<{ booking: BookingRow; quote: CancellationQuote }> {
  const existing = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first<BookingRow>()
  if (!existing) throw new BookingCancellationError('Booking not found')

  const quote = await quoteCancellation(db, existing)

  const booking = await transitionBooking(db, bookingId, 'cancelled', actor, { reason, metadata: { refund_percentage: quote.refundPercentage } })

  await db
    .prepare(`UPDATE bookings SET cancellation_fee_kobo = ?, refund_amount_kobo = ? WHERE id = ?`)
    .bind(quote.feeAmountKobo, quote.refundAmountKobo, bookingId)
    .run()

  if (quote.refundAmountKobo > 0 && (existing.payment_status === 'escrow_held' || existing.payment_status === 'released')) {
    await creditWallet(db, existing.customer_user_id, quote.refundAmountKobo, 'booking_refund', String(bookingId), `Refund for cancelled booking ${existing.booking_number}`)
    await db.prepare(`UPDATE bookings SET payment_status = 'refunded' WHERE id = ?`).bind(bookingId).run()
  }

  const updated = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first<BookingRow>()
  return { booking: updated!, quote }
}

export async function createCancellationPolicy(db: D1Database, owner: { userId?: number; organizationId?: number }, input: { name: string; policyType: BookingCancellationPolicyRow['policy_type']; cutoffHoursBeforeStart: number; refundPercentageBeforeCutoff: number; refundPercentageAfterCutoff: number; flatFeeKobo?: number }): Promise<number> {
  if (!owner.userId && !owner.organizationId) throw new BookingCancellationError('A cancellation policy needs an owning user or organization')
  const result = await db
    .prepare(
      `INSERT INTO booking_cancellation_policies (owner_user_id, organization_id, name, policy_type, cutoff_hours_before_start, refund_percentage_before_cutoff, refund_percentage_after_cutoff, flat_fee_kobo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(owner.userId ?? null, owner.organizationId ?? null, input.name, input.policyType, input.cutoffHoursBeforeStart, input.refundPercentageBeforeCutoff, input.refundPercentageAfterCutoff, input.flatFeeKobo ?? 0)
    .run()
  return Number(result.meta.last_row_id)
}

export async function getPoliciesForProvider(db: D1Database, userId: number) {
  const { results } = await db.prepare('SELECT * FROM booking_cancellation_policies WHERE owner_user_id = ? AND is_active = 1 ORDER BY id ASC').bind(userId).all()
  return results
}

export async function getPoliciesForOrganization(db: D1Database, organizationId: number) {
  const { results } = await db.prepare('SELECT * FROM booking_cancellation_policies WHERE organization_id = ? AND is_active = 1 ORDER BY id ASC').bind(organizationId).all()
  return results
}
