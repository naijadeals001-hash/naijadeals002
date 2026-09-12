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
 */
export async function payForBooking(db: D1Database, bookingId: number, customerUserId: number, depositPercentage: number): Promise<BookingRow> {
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND customer_user_id = ?').bind(bookingId, customerUserId).first<BookingRow>()
  if (!booking) throw new BookingPaymentError('Booking not found or not owned by this customer')
  if (booking.payment_status !== 'unpaid') throw new BookingPaymentError(`This booking is already ${booking.payment_status}`)
  if (!['held', 'pending_payment'].includes(booking.status)) throw new BookingPaymentError(`Cannot pay for a booking in status '${booking.status}'`)

  const amountToChargeKobo = Math.round((booking.total_price_kobo * Math.min(100, Math.max(1, depositPercentage))) / 100)

  try {
    await debitWallet(db, customerUserId, amountToChargeKobo, 'booking_payment', String(bookingId), `Payment for booking ${booking.booking_number}`)
  } catch (err) {
    if (err instanceof InsufficientFundsError) throw new BookingPaymentError('Insufficient wallet balance to pay for this booking')
    throw err
  }

  await db.prepare(`UPDATE bookings SET payment_status = 'escrow_held', payment_reference = ? WHERE id = ?`).bind(`WALLET-${Date.now()}`, bookingId).run()

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
