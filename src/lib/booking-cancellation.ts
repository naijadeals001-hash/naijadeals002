/**
 * Booking Engine 2.0 — Policy-driven cancellation (spec: "the Booking
 * Engine decides permission + rule, the Payment Engine executes the
 * refund"). No new ledger — refunds/charges execute through the EXISTING
 * wallet_ledger via src/lib/wallet.ts's creditWallet/debitWallet, exactly
 * mirroring Marketplace 2.1's src/lib/refunds.ts pattern.
 *
 * INVARIANT #9 (financial correctness fix — "actual paid amount" must be
 * ledger-derived, never assumed from booking.total_price_kobo):
 *
 * BUG (found via live NaijaStay E2E reproduction, booking id 88, real D1
 * rows, not hypothetical): quoteCancellation() used to compute
 * `paidAmountKobo = booking.total_price_kobo` whenever payment_status was
 * escrow_held/released. That is WRONG whenever a listing has
 * deposit_percentage < 100 — payForBooking() (src/lib/booking-payments.ts)
 * only ever captures `total_price_kobo * deposit_percentage / 100`, so
 * `escrow_held` does NOT imply the full total was paid. This bug never
 * manifested for NaijaGigs because all 123 pre-existing listings happen to
 * use deposit_percentage=100 (total == captured, by coincidence) — NaijaStay
 * is the first vertical to use realistic partial deposits (30%/50%) and
 * exposed a genuinely shared Booking Engine defect. Reproduced: booking 88,
 * total_price_kobo=25,500,000 (₦255,000), 30% deposit actually captured
 * 7,650,000 (₦76,500), but the old code refunded the full 25,500,000 —
 * manufacturing 17,850,000 kobo (₦178,500) that was never paid in.
 *
 * FIX (Option 2, chosen over adding a new amount_paid_kobo schema column):
 * the wallet_ledger is the ONE authoritative record of money that actually
 * moved (see wallet.ts's own module doc). getActualPaidAmount() below
 * derives the real captured amount and any already-refunded amount
 * EXCLUSIVELY from ledger rows scoped to this exact booking's two
 * discriminators (reference_type='booking_payment' / 'booking_refund',
 * reference_id=String(bookingId) — confirmed via grep to be the ONLY two
 * call sites that ever write these reference_type values anywhere in this
 * codebase), further scoped by user_id and entry_type as belt-and-braces
 * safety so this can never accidentally sum an unrelated user's rows or an
 * unrelated entry_type. This deliberately does NOT do a blind
 * `SUM(all booking_payment rows)` — it nets out previously_refunded_amount
 * so a booking that was already partially refunded can never be refunded
 * again beyond what remains unrecovered.
 *
 *   refundable_amount = actual_captured_amount - previously_refunded_amount
 *
 * Enforced invariants (quoteCancellation, below):
 *   refundable_amount   >= 0
 *   refund_amount       <= actual_captured_amount
 *   refund_amount       <= unrecovered_paid_amount (== refundable_amount)
 *
 * See tests/booking-engine/10.ledger-derived-refund-integrity.test.mjs for
 * the permanent regression matrix (100/50/30% deposit x full/partial
 * refund, already-refunded, unpaid-cancel, duplicate-payment,
 * cancel-after-refund) proving "money out can never exceed money in" for a
 * booking, across every deposit_percentage this engine supports.
 */
import { transitionBooking, type BookingActor } from './booking-lifecycle'
import { creditWallet } from './wallet'
import type { BookingRow, BookingCancellationPolicyRow } from '../types'

export class BookingCancellationError extends Error {}

/**
 * Ledger-derived summary of what was ACTUALLY captured for a booking and how
 * much of that has ALREADY been refunded — the sole source of truth for
 * refund eligibility. Never derives anything from bookings.total_price_kobo
 * (that is the booking's nominal economic value, not necessarily the amount
 * of money that moved). Scoped by (customerUserId, bookingId) so this can
 * never cross-contaminate between users or bookings.
 *
 * EXCLUSIONS (explicit, per hardening requirement — this must never be a
 * naive blind SUM of "everything tagged booking_payment"):
 *   - Only entry_type='debit' rows count as captured payment (excludes any
 *     row that isn't a real debit against this user, e.g. a hypothetical
 *     future credit-typed adjustment mistakenly tagged with the same
 *     reference_type).
 *   - Only entry_type='credit' rows count as previously-refunded (mirror
 *     guard on the refund side).
 *   - reference_type is scoped EXACTLY to 'booking_payment' / 'booking_refund'
 *     — never a broader LIKE/wildcard match — so unrelated ledger movements
 *     (test_funding, marketplace order payments, other bookings) can never
 *     leak into this booking's total.
 *   - reference_id is scoped EXACTLY to String(bookingId) — never matches a
 *     different booking's payment/refund rows.
 *   - user_id is scoped to the booking's own customer_user_id — a row that
 *     somehow matched reference_type/reference_id but belonged to a
 *     different user could never be this booking's money and is excluded.
 *   - Authorization holds that were never captured produce no
 *     'booking_payment' row at all (payForBooking only inserts one AFTER a
 *     successful debitWallet() call), so there is nothing to exclude there
 *     by construction — not something this query needs to filter out, but
 *     documented so the absence of a special case is a deliberate fact, not
 *     an oversight.
 *   - Duplicate/replayed payment events: payForBooking()'s own atomic CAS
 *     (`WHERE payment_status = 'unpaid'`) already prevents a second
 *     'booking_payment' row from ever being written for the same booking —
 *     so a naive SUM here is safe in practice; this function still sums
 *     rather than assumes exactly one row, so it fails safe (reports the
 *     true total) even if that upstream guarantee were ever violated.
 */
export interface ActualPaymentSummary {
  /** Total actually captured (debited) for this booking, ledger-derived. */
  capturedAmountKobo: number
  /** Total already refunded (credited back) for this booking, ledger-derived. */
  previouslyRefundedKobo: number
  /** capturedAmountKobo - previouslyRefundedKobo, floored at 0. Never negative. */
  refundableAmountKobo: number
}

export async function getActualPaidAmount(db: D1Database, customerUserId: number, bookingId: number): Promise<ActualPaymentSummary> {
  const bookingIdStr = String(bookingId)

  const capturedRow = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_kobo), 0) AS total FROM wallet_ledger
       WHERE user_id = ? AND entry_type = 'debit' AND reference_type = 'booking_payment' AND reference_id = ?`
    )
    .bind(customerUserId, bookingIdStr)
    .first<{ total: number }>()

  const refundedRow = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_kobo), 0) AS total FROM wallet_ledger
       WHERE user_id = ? AND entry_type = 'credit' AND reference_type = 'booking_refund' AND reference_id = ?`
    )
    .bind(customerUserId, bookingIdStr)
    .first<{ total: number }>()

  const capturedAmountKobo = Number(capturedRow?.total ?? 0)
  const previouslyRefundedKobo = Number(refundedRow?.total ?? 0)
  const refundableAmountKobo = Math.max(0, capturedAmountKobo - previouslyRefundedKobo)

  return { capturedAmountKobo, previouslyRefundedKobo, refundableAmountKobo }
}

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
  /** Ledger-derived actual amount captured for this booking (Invariant #9) — surfaced for transparency/debugging, never trust total_price_kobo as a stand-in for this. */
  actualPaidAmountKobo: number
  /** Ledger-derived amount already refunded prior to this quote (Invariant #9). Non-zero here means a PARTIAL refund already happened for this booking. */
  previouslyRefundedKobo: number
}

/**
 * Computes what a cancellation RIGHT NOW would cost/refund, without
 * executing it — used to show the customer a quote before they confirm.
 *
 * INVARIANT #9: the refund base is the LEDGER-DERIVED actual captured
 * amount (getActualPaidAmount), never booking.total_price_kobo — see this
 * file's module header for the full defect history and rationale. A
 * booking whose payment_status is escrow_held/released but whose
 * deposit_percentage was < 100 must only ever be refundable up to what was
 * genuinely debited from the customer's wallet.
 */
export async function quoteCancellation(db: D1Database, booking: BookingRow): Promise<CancellationQuote> {
  const policy = await getEffectivePolicyForBooking(db, booking)
  const hoursUntilStart = (new Date(booking.starts_at).getTime() - Date.now()) / 3_600_000
  const isBeforeCutoff = hoursUntilStart >= policy.cutoff_hours_before_start
  const refundPercentage = isBeforeCutoff ? policy.refund_percentage_before_cutoff : policy.refund_percentage_after_cutoff

  const { capturedAmountKobo, previouslyRefundedKobo, refundableAmountKobo } = await getActualPaidAmount(db, booking.customer_user_id, booking.id)

  // The policy's refund percentage applies to what was ACTUALLY captured,
  // not the nominal booking total. A 100%-refund-eligible cancellation on a
  // 30%-deposit booking must refund 100% of the 30% actually paid, not 100%
  // of the full nominal price.
  const grossRefund = Math.round((capturedAmountKobo * refundPercentage) / 100)
  const feeAmountKobo = Math.min(policy.flat_fee_kobo, grossRefund)
  let refundAmountKobo = Math.max(0, grossRefund - feeAmountKobo)

  // INVARIANT ENFORCEMENT (non-negotiable, per explicit hardening
  // requirement): no matter what the policy math above produces, a refund
  // can NEVER exceed what remains unrecovered for this booking. This is the
  // final backstop against the entire defect class — even if a future
  // policy/fee change introduced a new bug upstream, this line alone
  // guarantees "money out can never exceed money in" for a booking.
  refundAmountKobo = Math.min(refundAmountKobo, refundableAmountKobo)
  refundAmountKobo = Math.min(refundAmountKobo, capturedAmountKobo)
  refundAmountKobo = Math.max(0, refundAmountKobo)

  return { policy, hoursUntilStart, isBeforeCutoff, refundPercentage, refundAmountKobo, feeAmountKobo, actualPaidAmountKobo: capturedAmountKobo, previouslyRefundedKobo }
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
