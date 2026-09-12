/**
 * Booking Engine 2.0 — Payment integration boundary (spec: "Booking Engine
 * determines WHAT [full/deposit/partial], Payment Engine determines HOW").
 * No new ledger — every wallet movement goes through the EXISTING
 * wallet_ledger via src/lib/wallet.ts's debitWallet/creditWallet, exactly
 * mirroring how Marketplace/Service Engine orders pay.
 */
import { debitWallet, InsufficientFundsError } from './wallet'
import { transitionBooking, type BookingActor } from './booking-lifecycle'
import type { BookingRow } from '../types'

export class BookingPaymentError extends Error {}

/**
 * Customer pays for a held/pending_payment booking (spec's deposit_percentage
 * on the listing determines whether this is a full or partial upfront
 * charge — the REMAINING balance, if any, is tracked implicitly via
 * total_price_kobo vs the amount actually debited here; full accounts-
 * receivable tracking for partial/deposit bookings is a documented
 * follow-up, see REMAINING GAP in the final report). Debits the customer's
 * wallet for the computed amount, marks payment_status='escrow_held'
 * (funds held by the platform until the provider completes the service —
 * mirrors the Service Engine's escrow_held convention), and transitions the
 * booking through the state machine to 'confirmed' for instant-book
 * listings or leaves it at 'pending_payment'->'confirmed' only once the
 * provider explicitly accepts for request-mode listings.
 *
 * SECURITY/CORRECTNESS FIX (Invariant #8, security-regression checkpoint):
 * this function used to read `payment_status`, branch on it, and only
 * THEN debit the wallet — a textbook TOCTOU. Under light concurrency
 * (5-way, isolated runs) this never surfaced an anomaly, because D1's
 * statement-level serialization happened to make each loser's read
 * observe the winner's already-committed write in practice. Under
 * HEAVIER concurrency (running the full 01-09 suite together, 8-way races
 * across 5 bookings back-to-back) this same code produced a REAL,
 * reproduced 8x overcharge: iteration 3 of
 * 08.idempotency.test.mjs's test 3 returned 8x200 + 8 wallet_ledger rows
 * for ONE booking (see that test's failure output, captured before this
 * fix: "found 1: [{iteration:3, bookingId:437, okCount:8,
 * ledgerRowCount:8, ...}]"). Root cause: nothing atomically CLAIMED the
 * booking before the wallet was touched, so N concurrent calls could all
 * pass the `payment_status !== 'unpaid'` check before any of them wrote.
 *
 * THE FIX mirrors the EXACT pattern already proven correct by
 * transitionBooking()'s CAS guard (booking-lifecycle.ts): atomically CLAIM
 * the booking FIRST via `UPDATE ... WHERE id = ? AND payment_status =
 * 'unpaid'`, and only debit the wallet if that claim's rows_written is 1.
 * If the wallet debit then fails (e.g. insufficient funds), the claim is
 * explicitly rolled back (`payment_status` reverted to 'unpaid') so the
 * booking is never left stuck in a claimed-but-unpaid limbo state and the
 * customer can legitimately retry after topping up. Every concurrent
 * loser's claim UPDATE now affects 0 rows and is rejected BEFORE it ever
 * reaches debitWallet — structurally impossible to double-charge,
 * regardless of load, not merely "safe in the load levels tested so far."
 */
export async function payForBooking(db: D1Database, bookingId: number, customerUserId: number, depositPercentage: number): Promise<BookingRow> {
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND customer_user_id = ?').bind(bookingId, customerUserId).first<BookingRow>()
  if (!booking) throw new BookingPaymentError('Booking not found or not owned by this customer')
  if (booking.payment_status !== 'unpaid') throw new BookingPaymentError(`This booking is already ${booking.payment_status}`)
  if (!['held', 'pending_payment'].includes(booking.status)) throw new BookingPaymentError(`Cannot pay for a booking in status '${booking.status}'`)

  const amountToChargeKobo = Math.round((booking.total_price_kobo * Math.min(100, Math.max(1, depositPercentage))) / 100)
  const paymentReference = `WALLET-${Date.now()}`

  // ATOMIC CLAIM (compare-and-swap): only ONE concurrent caller can ever
  // win this UPDATE, because the WHERE clause re-checks payment_status =
  // 'unpaid' at write time, not at the earlier read time above. Every
  // loser gets rows_written = 0 and is rejected here, BEFORE touching the
  // wallet — exactly the guarantee transitionBooking() already relies on
  // for booking.status (see that function's own CAS comment).
  const claimResult = await db
    .prepare(`UPDATE bookings SET payment_status = 'escrow_held', payment_reference = ? WHERE id = ? AND payment_status = 'unpaid'`)
    .bind(paymentReference, bookingId)
    .run()
  if ((claimResult.meta.rows_written ?? 0) === 0) {
    // Lost the race (or the status changed between our read and this
    // write for any other reason) — re-read the fresh status so the error
    // message is accurate, then reject. Never a fabricated success.
    const fresh = await db.prepare('SELECT payment_status FROM bookings WHERE id = ?').bind(bookingId).first<{ payment_status: string }>()
    throw new BookingPaymentError(`This booking is already ${fresh?.payment_status ?? booking.payment_status}`)
  }

  try {
    await debitWallet(db, customerUserId, amountToChargeKobo, 'booking_payment', String(bookingId), `Payment for booking ${booking.booking_number}`)
  } catch (err) {
    // Roll back the claim so the booking isn't left stuck in
    // 'escrow_held' with no actual money ever having moved — the
    // customer must be able to legitimately retry (e.g. after topping up
    // their wallet) without being told "this booking is already paid".
    await db.prepare(`UPDATE bookings SET payment_status = 'unpaid', payment_reference = NULL WHERE id = ? AND payment_status = 'escrow_held' AND payment_reference = ?`).bind(bookingId, paymentReference).run()
    if (err instanceof InsufficientFundsError) throw new BookingPaymentError('Insufficient wallet balance to pay for this booking')
    throw err
  }

  const actor: BookingActor = { userId: customerUserId, role: 'customer' }
  // Instant-book listings auto-confirm on payment (system-role transition);
  // request-mode listings stay at pending_payment awaiting explicit
  // provider acceptance (transitionBooking called separately by the
  // provider's confirm endpoint).
  const listing = await db.prepare('SELECT booking_mode FROM bookable_listings WHERE id = ?').bind(booking.listing_id).first<{ booking_mode: string }>()
  if (listing?.booking_mode === 'instant' && booking.status === 'pending_payment') {
    return transitionBooking(db, bookingId, 'confirmed', { userId: customerUserId, role: 'system' }, { metadata: { auto_confirmed: 'instant_booking_mode' } })
  }

  const updated = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first<BookingRow>()
  return updated!
}
