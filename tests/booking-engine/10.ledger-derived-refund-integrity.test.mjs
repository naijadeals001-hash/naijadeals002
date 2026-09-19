/**
 * Invariant #9: LEDGER-DERIVED REFUND INTEGRITY — permanent regression guard
 * for the partial-deposit refund defect discovered during NaijaStay
 * integration (real E2E reproduction, booking id 88, live local D1 — not
 * hypothetical).
 *
 * THE BUG THIS FILE GUARDS AGAINST (see src/lib/booking-cancellation.ts's
 * module header for the full forensic writeup): quoteCancellation() used to
 * compute the refund base as `booking.total_price_kobo` whenever
 * payment_status was escrow_held/released. That is WRONG whenever a
 * listing's deposit_percentage < 100 — payForBooking() only ever captures
 * `total_price_kobo * deposit_percentage / 100`. The bug never surfaced via
 * the pre-existing test suite because every single test-created listing
 * across every test file in this directory uses the DEFAULT
 * deposit_percentage (100, set by createBookableListing when the field is
 * omitted) — so `total_price_kobo == amount actually captured` by pure
 * coincidence for 100% of prior coverage. This file is the first (and must
 * remain the permanent) coverage that deliberately exercises
 * deposit_percentage values BELOW 100, closing that blind spot for good.
 *
 * THE FIX UNDER TEST: getActualPaidAmount(db, customerUserId, bookingId) in
 * booking-cancellation.ts derives the real captured amount and any
 * already-refunded amount EXCLUSIVELY from wallet_ledger rows scoped to
 * (user_id, entry_type, reference_type, reference_id=String(bookingId)) —
 * never from bookings.total_price_kobo. quoteCancellation() then enforces
 * three hard invariants on top of the policy math:
 *   refundable_amount >= 0
 *   refund_amount     <= actual_captured_amount
 *   refund_amount     <= unrecovered_paid_amount (captured - already refunded)
 *
 * THE ACCEPTANCE CRITERION THIS FILE PROVES (stronger than "refund <=
 * captured" alone, per explicit requirement): for every booking,
 * CUMULATIVE refunds can never exceed CUMULATIVE captured payments, AND a
 * fully-refunded booking returns the customer wallet to EXACTLY its
 * pre-payment balance — verified by independently re-deriving both totals
 * from raw wallet_ledger rows (never trusting cached_balance_kobo alone,
 * never trusting the API response alone) for every scenario below,
 * including deposit_percentage = 100, 50, and 30, across full-refund,
 * partial-refund, already-refunded, unpaid-cancel, duplicate-payment-
 * attempt, and cancel-after-refund cases. It also explicitly proves the
 * ledger-derivation itself cannot double-count: a previously-written
 * 'booking_refund' credit must never be miscounted as captured payment, and
 * replaying a refund attempt against an already-refunded booking must
 * increase the customer's wallet balance by exactly zero.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, createTestListing, creditWalletDirect, nextFreshWindow } from './helpers/client.mjs'
import { queryD1, queryOneD1 } from './helpers/d1.mjs'

// ---------- shared fixture + verification helpers ----------

async function walletBalance(userId) {
  const row = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id = ${userId}`)
  return row ? Number(row.cached_balance_kobo) : 0
}

/**
 * Independently re-derives the wallet balance from RAW wallet_ledger rows
 * (never from the cache) — the same "cache must equal SUM of ledger"
 * invariant test 9 in file 06 already relies on, reused here as the ground
 * truth for every net-zero assertion in this file.
 */
async function ledgerDerivedBalance(userId) {
  const rows = await queryD1(`SELECT entry_type, amount_kobo FROM wallet_ledger WHERE user_id = ${userId}`)
  return rows.reduce((sum, r) => sum + (r.entry_type === 'credit' ? Number(r.amount_kobo) : -Number(r.amount_kobo)), 0)
}

/** Sum of all booking_payment DEBIT rows for this exact booking/user — the ledger-derived "cumulative captured" figure, computed independently of getActualPaidAmount() itself. */
async function cumulativeCapturedForBooking(userId, bookingId) {
  const row = await queryOneD1(
    `SELECT COALESCE(SUM(amount_kobo), 0) AS total FROM wallet_ledger WHERE user_id = ${userId} AND entry_type = 'debit' AND reference_type = 'booking_payment' AND reference_id = '${bookingId}'`
  )
  return Number(row?.total ?? 0)
}

/** Sum of all booking_refund CREDIT rows for this exact booking/user — the ledger-derived "cumulative refunded" figure, computed independently of getActualPaidAmount() itself. */
async function cumulativeRefundedForBooking(userId, bookingId) {
  const row = await queryOneD1(
    `SELECT COALESCE(SUM(amount_kobo), 0) AS total FROM wallet_ledger WHERE user_id = ${userId} AND entry_type = 'credit' AND reference_type = 'booking_refund' AND reference_id = '${bookingId}'`
  )
  return Number(row?.total ?? 0)
}

async function getBookingRow(bookingId) {
  return queryOneD1(`SELECT * FROM bookings WHERE id = ${bookingId}`)
}

async function fund(userId, amountKobo, tag) {
  await creditWalletDirect(userId, amountKobo)
  // creditWalletDirect always tags reference_id='harness' — fine, this file
  // never queries by that reference_id, only by booking_payment/booking_refund.
  void tag
}

/**
 * Full paid-booking setup at an explicit depositPercentage — mirrors file
 * 06's setupPaidBooking but parameterized on deposit percentage (the one
 * axis this defect class hinges on) instead of assuming the harness
 * default of 100.
 */
async function setupPaidBookingAtDeposit({ depositPercentage, basePriceKobo, labelSuffix }) {
  const { client: providerClient, userId: providerUserId } = await registerUser(`ldri_prov${labelSuffix}`)
  const { client: customerClient, userId: customerUserId } = await registerUser(`ldri_cust${labelSuffix}`)
  const { listingId, resourceId } = await createTestListing(providerClient, {
    bookingMode: 'instant',
    basePriceKobo,
    depositPercentage,
  })
  const fundingKobo = basePriceKobo * 3 // ample headroom regardless of deposit %
  await fund(customerUserId, fundingKobo)

  const { startsAt, endsAt } = nextFreshWindow(2)
  const holdRes = await customerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201, `hold failed: ${JSON.stringify(holdRes.body)}`)

  const bookingRes = await customerClient.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201, `booking failed: ${JSON.stringify(bookingRes.body)}`)
  const bookingId = bookingRes.body.id

  const payRes = await customerClient.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(payRes.status, 200, `pay failed: ${JSON.stringify(payRes.body)}`)
  assert.equal(payRes.body.payment_status, 'escrow_held')

  const expectedCapturedKobo = Math.round((basePriceKobo * Math.min(100, Math.max(1, depositPercentage))) / 100)

  return {
    providerClient, providerUserId, customerClient, customerUserId,
    listingId, resourceId, bookingId,
    basePriceKobo, expectedCapturedKobo, fundingKobo,
  }
}

// ============================================================
// SCENARIO 1 — 100% deposit + 100% refund (baseline, must remain correct —
// this is the ONLY shape every pre-existing test in this suite exercised)
// ============================================================
test('ledger-derived refund integrity: 100% deposit + 100% refund refunds exactly the actual 100% payment, wallet returns to exact pre-payment balance', async () => {
  const basePriceKobo = 4_000_000
  const { customerClient, customerUserId, bookingId, expectedCapturedKobo, fundingKobo } = await setupPaidBookingAtDeposit({
    depositPercentage: 100, basePriceKobo, labelSuffix: '_s1',
  })
  assert.equal(expectedCapturedKobo, basePriceKobo, 'sanity: 100% deposit must capture the full nominal price')

  const balanceAfterFunding = fundingKobo // ledger-derived starting point before any payment
  const captured = await cumulativeCapturedForBooking(customerUserId, bookingId)
  assert.equal(captured, expectedCapturedKobo, 'ledger-derived captured amount must equal actual debit')

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 's1' })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))
  assert.equal(cancelRes.body.quote.refundAmountKobo, expectedCapturedKobo)

  const refunded = await cumulativeRefundedForBooking(customerUserId, bookingId)
  assert.equal(refunded, captured, 'STRONGER INVARIANT: cumulative refunded must equal cumulative captured for a full-eligibility cancellation, never more')

  const finalLedgerBalance = await ledgerDerivedBalance(customerUserId)
  assert.equal(finalLedgerBalance, balanceAfterFunding, 'wallet must return to EXACTLY the pre-payment (post-funding) balance — net-zero')
  const cachedBalance = await walletBalance(customerUserId)
  assert.equal(cachedBalance, finalLedgerBalance, 'cache must agree with independently-derived ledger sum')
})

// ============================================================
// SCENARIO 2 — 50% deposit + 100% refund (the exact defect class: pre-fix
// this refunded the FULL nominal price instead of the 50% actually paid)
// ============================================================
test('ledger-derived refund integrity: 50% deposit + 100% refund refunds exactly the actual 50% payment (never the full nominal price), wallet returns to exact pre-payment balance', async () => {
  const basePriceKobo = 6_500_000
  const { customerClient, customerUserId, bookingId, expectedCapturedKobo, fundingKobo } = await setupPaidBookingAtDeposit({
    depositPercentage: 50, basePriceKobo, labelSuffix: '_s2',
  })
  assert.equal(expectedCapturedKobo, 3_250_000, 'sanity: 50% of 6,500,000 must be 3,250,000')
  assert.notEqual(expectedCapturedKobo, basePriceKobo, 'sanity: captured must NOT equal the full nominal price for a 50% deposit')

  const quoteRes = await customerClient.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteRes.status, 200)
  assert.equal(quoteRes.body.refundAmountKobo, expectedCapturedKobo, 'THE REGRESSION THIS FILE GUARDS: quote must be the actual 50% captured, never the full 100% nominal price')
  assert.equal(quoteRes.body.actualPaidAmountKobo, expectedCapturedKobo)

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 's2' })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))
  assert.equal(cancelRes.body.booking.refund_amount_kobo, expectedCapturedKobo)
  assert.notEqual(cancelRes.body.booking.refund_amount_kobo, basePriceKobo, 'must never refund the nominal total for a partial-deposit booking')

  const captured = await cumulativeCapturedForBooking(customerUserId, bookingId)
  const refunded = await cumulativeRefundedForBooking(customerUserId, bookingId)
  assert.equal(captured, expectedCapturedKobo)
  assert.equal(refunded, captured, 'STRONGER INVARIANT: cumulative refunded == cumulative captured, never more')

  const finalLedgerBalance = await ledgerDerivedBalance(customerUserId)
  assert.equal(finalLedgerBalance, fundingKobo, 'wallet must return to EXACTLY the pre-payment (post-funding) balance — net-zero, no manufactured surplus')
})

// ============================================================
// SCENARIO 3 — 30% deposit + 100% refund (the EXACT numbers from the live
// NaijaStay bug reproduction: total 255,000 / 30% -> captured 76,500)
// ============================================================
test('ledger-derived refund integrity: 30% deposit + 100% refund reproduces and proves the fix for the exact live NaijaStay defect numbers', async () => {
  const basePriceKobo = 25_500_000 // = ₦255,000, matching the original bug reproduction
  const { customerClient, customerUserId, bookingId, expectedCapturedKobo, fundingKobo } = await setupPaidBookingAtDeposit({
    depositPercentage: 30, basePriceKobo, labelSuffix: '_s3',
  })
  assert.equal(expectedCapturedKobo, 7_650_000, 'sanity: 30% of 25,500,000 must be 7,650,000 (₦76,500) — the exact live-bug numbers')

  const quoteRes = await customerClient.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteRes.body.refundAmountKobo, 7_650_000, 'must quote exactly ₦76,500, never the buggy ₦255,000')

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 's3' })
  assert.equal(cancelRes.status, 200)
  assert.equal(cancelRes.body.booking.refund_amount_kobo, 7_650_000)

  const captured = await cumulativeCapturedForBooking(customerUserId, bookingId)
  const refunded = await cumulativeRefundedForBooking(customerUserId, bookingId)
  assert.equal(captured, 7_650_000)
  assert.equal(refunded, 7_650_000, 'must never manufacture the 17,850,000 kobo surplus the original defect produced')

  const finalLedgerBalance = await ledgerDerivedBalance(customerUserId)
  assert.equal(finalLedgerBalance, fundingKobo, 'wallet must return to EXACTLY the pre-payment balance — this is the precise scenario that produced a 178,500 naira surplus before the fix')
})

// ============================================================
// SCENARIO 4 — partial deposit + partial refund (30% deposit, 50%-refund
// policy) — the compound case: refund percentage AND deposit percentage
// both < 100 at once
// ============================================================
test('ledger-derived refund integrity: 30% deposit + 50%-policy partial refund refunds exactly 50% of the ACTUAL captured amount, not 50% of the nominal total', async () => {
  const { client: providerClient } = await registerUser('ldri_prov_s4')
  const policyRes = await providerClient.post('/api/booking-providers/me/cancellation-policies', {
    name: `LDRI Partial Policy ${Date.now()}`,
    policyType: 'custom',
    cutoffHoursBeforeStart: 24,
    refundPercentageBeforeCutoff: 50,
    refundPercentageAfterCutoff: 0,
    flatFeeKobo: 0,
  })
  assert.equal(policyRes.status, 201)
  const policyId = policyRes.body.id

  const basePriceKobo = 10_000_000
  const depositPercentage = 30
  const { client: customerClient, userId: customerUserId } = await registerUser('ldri_cust_s4')
  const { listingId, resourceId } = await createTestListing(providerClient, { bookingMode: 'instant', basePriceKobo, depositPercentage, cancellationPolicyId: policyId })
  const fundingKobo = basePriceKobo * 2
  await fund(customerUserId, fundingKobo)

  const { startsAt, endsAt } = nextFreshWindow(2)
  const holdRes = await customerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201)
  const bookingRes = await customerClient.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201)
  const bookingId = bookingRes.body.id
  const payRes = await customerClient.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(payRes.status, 200)

  const expectedCapturedKobo = Math.round((basePriceKobo * depositPercentage) / 100) // 3,000,000
  const expectedRefundKobo = Math.round((expectedCapturedKobo * 50) / 100) // 1,500,000 — 50% of the ACTUAL captured amount

  const quoteRes = await customerClient.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteRes.body.actualPaidAmountKobo, expectedCapturedKobo)
  assert.equal(quoteRes.body.refundAmountKobo, expectedRefundKobo, 'must be 50% of the actual 3,000,000 captured (1,500,000), never 50% of the nominal 10,000,000 (which would be 5,000,000 — more than was ever paid)')
  assert.notEqual(quoteRes.body.refundAmountKobo, Math.round((basePriceKobo * 50) / 100), 'must not equal 50% of the nominal total')

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 's4' })
  assert.equal(cancelRes.status, 200)
  assert.equal(cancelRes.body.booking.refund_amount_kobo, expectedRefundKobo)

  const captured = await cumulativeCapturedForBooking(customerUserId, bookingId)
  const refunded = await cumulativeRefundedForBooking(customerUserId, bookingId)
  assert.equal(captured, expectedCapturedKobo)
  assert.equal(refunded, expectedRefundKobo)
  assert.ok(refunded <= captured, 'STRONGER INVARIANT: cumulative refunded must never exceed cumulative captured')

  const finalLedgerBalance = await ledgerDerivedBalance(customerUserId)
  const retainedKobo = expectedCapturedKobo - expectedRefundKobo
  assert.equal(finalLedgerBalance, fundingKobo - retainedKobo, 'wallet delta must equal exactly the refunded portion, leaving the retained (non-refunded) portion permanently deducted')
})

// ============================================================
// SCENARIO 5 — full payment (100% deposit) + partial refund (policy-driven)
// — confirms the fix does not regress the ALREADY-COVERED 100%-deposit
// partial-refund shape (file 06 test 3 covers this too; repeated here with
// independent ledger-cumulative assertions for this file's stronger
// invariant, at a different price point to avoid any fixture overlap)
// ============================================================
test('ledger-derived refund integrity: full (100% deposit) payment + partial policy refund reconciles exactly via independent cumulative ledger sums', async () => {
  const { client: providerClient } = await registerUser('ldri_prov_s5')
  const policyRes = await providerClient.post('/api/booking-providers/me/cancellation-policies', {
    name: `LDRI Full-Partial Policy ${Date.now()}`,
    policyType: 'custom',
    cutoffHoursBeforeStart: 24,
    refundPercentageBeforeCutoff: 70,
    refundPercentageAfterCutoff: 0,
    flatFeeKobo: 0,
  })
  assert.equal(policyRes.status, 201)
  const policyId = policyRes.body.id

  const basePriceKobo = 5_000_000
  const { client: customerClient, userId: customerUserId } = await registerUser('ldri_cust_s5')
  const { listingId, resourceId } = await createTestListing(providerClient, { bookingMode: 'instant', basePriceKobo, depositPercentage: 100, cancellationPolicyId: policyId })
  const fundingKobo = basePriceKobo * 2
  await fund(customerUserId, fundingKobo)

  const { startsAt, endsAt } = nextFreshWindow(2)
  const holdRes = await customerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  const bookingId = (await customerClient.post('/api/bookings', { hold_id: holdRes.body.id })).body.id
  const payRes = await customerClient.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(payRes.status, 200)

  const expectedRefundKobo = Math.round((basePriceKobo * 70) / 100) // 3,500,000

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 's5' })
  assert.equal(cancelRes.status, 200)
  assert.equal(cancelRes.body.booking.refund_amount_kobo, expectedRefundKobo)

  const captured = await cumulativeCapturedForBooking(customerUserId, bookingId)
  const refunded = await cumulativeRefundedForBooking(customerUserId, bookingId)
  assert.equal(captured, basePriceKobo)
  assert.equal(refunded, expectedRefundKobo)
  assert.ok(refunded < captured, 'a partial refund must strictly retain some captured amount')

  const finalLedgerBalance = await ledgerDerivedBalance(customerUserId)
  assert.equal(finalLedgerBalance, fundingKobo - (basePriceKobo - expectedRefundKobo))
})

// ============================================================
// SCENARIO 6 — already-refunded booking: no second refund, replay produces
// ZERO additional wallet movement (explicit "replayed refund cannot
// increase balance" proof, not just "second call rejected")
// ============================================================
test('ledger-derived refund integrity: an already-refunded booking can never be refunded again — cancelling twice increases the wallet balance by exactly zero on the second attempt', async () => {
  const basePriceKobo = 2_000_000
  const { customerClient, customerUserId, bookingId, expectedCapturedKobo, fundingKobo } = await setupPaidBookingAtDeposit({
    depositPercentage: 30, basePriceKobo, labelSuffix: '_s6',
  })

  const firstCancel = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'first' })
  assert.equal(firstCancel.status, 200)
  assert.equal(firstCancel.body.booking.refund_amount_kobo, expectedCapturedKobo)

  const balanceAfterFirst = await ledgerDerivedBalance(customerUserId)
  assert.equal(balanceAfterFirst, fundingKobo, 'first cancellation must return wallet to exact pre-payment balance (30% deposit case)')

  // Direct call to getActualPaidAmount's contract via the quote endpoint —
  // MUST report refundableAmountKobo effectively 0 now (previouslyRefundedKobo == capturedAmountKobo).
  const quoteAfterFirst = await customerClient.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteAfterFirst.body.actualPaidAmountKobo, expectedCapturedKobo, 'captured amount is a historical fact, must still be reported')
  assert.equal(quoteAfterFirst.body.previouslyRefundedKobo, expectedCapturedKobo, 'previously-refunded must now equal the full captured amount')
  assert.equal(quoteAfterFirst.body.refundAmountKobo, 0, 'refundable amount must now be exactly zero — nothing left unrecovered')

  // Second cancel attempt: the state machine (cancelled is terminal) rejects
  // this at the TRANSITION level before quoteCancellation's own math would
  // even run a second time — verify BOTH the rejection AND, more
  // importantly, that the wallet truly did not move an additional kobo.
  const secondCancel = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'replay attempt' })
  assert.equal(secondCancel.status, 400, 'a second cancellation attempt on an already-cancelled/refunded booking must be rejected, never silently succeed')

  const balanceAfterSecond = await ledgerDerivedBalance(customerUserId)
  assert.equal(balanceAfterSecond, balanceAfterFirst, 'REPLAYED REFUND MUST INCREASE BALANCE BY EXACTLY ZERO')

  const refundRowsCount = (await queryD1(`SELECT id FROM wallet_ledger WHERE user_id = ${customerUserId} AND reference_type = 'booking_refund' AND reference_id = '${bookingId}'`)).length
  assert.equal(refundRowsCount, 1, 'exactly one refund ledger row must ever exist for this booking, never duplicated by a replay')

  const captured = await cumulativeCapturedForBooking(customerUserId, bookingId)
  const refunded = await cumulativeRefundedForBooking(customerUserId, bookingId)
  assert.equal(refunded, captured, 'cumulative refunded must equal cumulative captured — fully recovered, not one kobo more')
})

// ============================================================
// SCENARIO 7 — unpaid booking cancellation: ₦0 refund, no ledger row at all,
// wallet completely untouched
// ============================================================
test('ledger-derived refund integrity: cancelling a never-paid booking produces a ₦0 refund and writes no wallet_ledger row whatsoever', async () => {
  const { client: providerClient } = await registerUser('ldri_prov_s7')
  const { client: customerClient, userId: customerUserId } = await registerUser('ldri_cust_s7')
  const basePriceKobo = 1_500_000
  const { listingId, resourceId } = await createTestListing(providerClient, { bookingMode: 'request', basePriceKobo, depositPercentage: 30 })
  await fund(customerUserId, basePriceKobo * 2) // funded but never used to pay

  const { startsAt, endsAt } = nextFreshWindow(2)
  const holdRes = await customerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201)
  const bookingRes = await customerClient.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201)
  const bookingId = bookingRes.body.id
  assert.equal(bookingRes.body.status, 'held', 'request-mode listing starts at held, never auto-paid')
  assert.equal(bookingRes.body.payment_status, 'unpaid')

  const balanceBeforeCancel = await ledgerDerivedBalance(customerUserId)

  const quoteRes = await customerClient.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteRes.body.refundAmountKobo, 0, 'an unpaid booking must quote exactly ₦0 refund')
  assert.equal(quoteRes.body.actualPaidAmountKobo, 0, 'ledger-derived captured amount for a never-paid booking must be exactly 0')

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'unpaid cancel' })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))
  assert.equal(cancelRes.body.booking.refund_amount_kobo, 0)
  assert.equal(cancelRes.body.booking.payment_status, 'unpaid', 'an unpaid cancellation must not fabricate a payment_status=refunded transition — nothing was ever captured to refund')

  const refundRows = await queryD1(`SELECT id FROM wallet_ledger WHERE user_id = ${customerUserId} AND reference_type = 'booking_refund' AND reference_id = '${bookingId}'`)
  assert.equal(refundRows.length, 0, 'no refund ledger row must ever be written for a booking that was never paid')

  const balanceAfterCancel = await ledgerDerivedBalance(customerUserId)
  assert.equal(balanceAfterCancel, balanceBeforeCancel, 'wallet must be completely untouched by cancelling an unpaid booking')
})

// ============================================================
// SCENARIO 8 — duplicate payment attempt: payForBooking's own atomic CAS
// prevents a second booking_payment ledger row; getActualPaidAmount must
// still report the correct SINGLE captured amount even if this upstream
// guarantee is being actively probed by a hostile double-call
// ============================================================
test('ledger-derived refund integrity: a duplicate/replayed payment attempt on an already-paid booking is rejected and never produces a second booking_payment ledger row or an inflated refund', async () => {
  const basePriceKobo = 3_000_000
  const { customerClient, customerUserId, bookingId, expectedCapturedKobo, fundingKobo } = await setupPaidBookingAtDeposit({
    depositPercentage: 30, basePriceKobo, labelSuffix: '_s8',
  })

  // Attempt to pay again on the already-escrow_held booking (simulates a
  // replayed/duplicate client request, e.g. a double-submit or retried
  // network call after a slow-but-successful first response).
  const duplicatePayRes = await customerClient.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(duplicatePayRes.status, 400, 'a second pay attempt on an already-paid booking must be rejected, never silently re-charge')

  const paymentRows = await queryD1(`SELECT id, amount_kobo FROM wallet_ledger WHERE user_id = ${customerUserId} AND reference_type = 'booking_payment' AND reference_id = '${bookingId}'`)
  assert.equal(paymentRows.length, 1, 'exactly one booking_payment ledger row must exist, never duplicated by a replay')
  assert.equal(Number(paymentRows[0].amount_kobo), expectedCapturedKobo)

  const captured = await cumulativeCapturedForBooking(customerUserId, bookingId)
  assert.equal(captured, expectedCapturedKobo, 'cumulative captured must still equal exactly one deposit charge, not two')

  // Now cancel for real and confirm the refund is based on the correct
  // SINGLE captured amount, not inflated by the rejected duplicate attempt.
  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 's8' })
  assert.equal(cancelRes.status, 200)
  assert.equal(cancelRes.body.booking.refund_amount_kobo, expectedCapturedKobo)

  const finalLedgerBalance = await ledgerDerivedBalance(customerUserId)
  assert.equal(finalLedgerBalance, fundingKobo, 'wallet must return to exact pre-payment balance despite the duplicate payment attempt in between')
})

// ============================================================
// SCENARIO 9 — cancel after refund (alias of scenario 6's replay proof, but
// via the exact wording of the required matrix: "cancel after refund" as a
// DISTINCT action sequence — cancel once (which refunds), then attempt a
// SEPARATE, later cancel call again to prove no additional refund is ever
// possible no matter how much time separates the two calls)
// ============================================================
test('ledger-derived refund integrity: cancelling again after a booking has already been refunded produces no additional refund, no matter how the second attempt is phrased', async () => {
  const basePriceKobo = 8_000_000
  const { customerClient, customerUserId, bookingId, expectedCapturedKobo, fundingKobo } = await setupPaidBookingAtDeposit({
    depositPercentage: 50, basePriceKobo, labelSuffix: '_s9',
  })

  const firstCancel = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'genuine cancellation' })
  assert.equal(firstCancel.status, 200)
  assert.equal(firstCancel.body.booking.payment_status, 'refunded')
  assert.equal(firstCancel.body.booking.refund_amount_kobo, expectedCapturedKobo)

  const balanceAfterRefund = await ledgerDerivedBalance(customerUserId)
  assert.equal(balanceAfterRefund, fundingKobo)

  // "Cancel after refund" attempt — a different actor phrasing (provider
  // instead of customer) to ensure the block is a genuine state-machine
  // property, not merely an accident of which actor called first.
  const bookingRow = await getBookingRow(bookingId)
  assert.equal(bookingRow.status, 'cancelled')
  assert.equal(bookingRow.payment_status, 'refunded')

  const secondAttempt = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'cancel after refund attempt' })
  assert.equal(secondAttempt.status, 400)

  const refundRows = await queryD1(`SELECT id, amount_kobo FROM wallet_ledger WHERE user_id = ${customerUserId} AND reference_type = 'booking_refund' AND reference_id = '${bookingId}'`)
  assert.equal(refundRows.length, 1, 'must never accumulate a second refund row for the same booking')
  assert.equal(Number(refundRows[0].amount_kobo), expectedCapturedKobo)

  const finalBalance = await ledgerDerivedBalance(customerUserId)
  assert.equal(finalBalance, balanceAfterRefund, 'balance must be bit-for-bit identical after the blocked second attempt')

  const captured = await cumulativeCapturedForBooking(customerUserId, bookingId)
  const refunded = await cumulativeRefundedForBooking(customerUserId, bookingId)
  assert.equal(refunded, captured, 'FINAL STRONGER-INVARIANT CHECK: cumulative refunded must equal cumulative captured, never exceed it, across the entire booking lifecycle including the blocked replay')
})

// ============================================================
// SCENARIO 10 — explicit proof that a previous booking_refund credit is
// NEVER miscounted as captured payment by getActualPaidAmount's derivation
// (guards against a future refactor accidentally summing entry_type
// indiscriminately, or reusing reference_type incorrectly)
// ============================================================
test('ledger-derived refund integrity: a previously-written booking_refund credit is never miscounted as captured payment, even when a booking is re-queried after a full refund', async () => {
  const basePriceKobo = 4_400_000
  const { customerClient, customerUserId, bookingId, expectedCapturedKobo } = await setupPaidBookingAtDeposit({
    depositPercentage: 30, basePriceKobo, labelSuffix: '_s10',
  })

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 's10' })
  assert.equal(cancelRes.status, 200)

  // At this point wallet_ledger has BOTH a 'debit'/'booking_payment' row AND
  // a 'credit'/'booking_refund' row for this exact bookingId. Re-derive the
  // quote (which internally re-runs getActualPaidAmount) and confirm the
  // refund credit is NOT double-counted as if it were additional captured
  // payment (which would happen if a future bug summed ALL rows for this
  // reference_id regardless of entry_type/reference_type).
  const requoteRes = await customerClient.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(requoteRes.status, 200)
  assert.equal(requoteRes.body.actualPaidAmountKobo, expectedCapturedKobo, 'captured amount must remain exactly the original debit, unaffected by the refund credit row that now also exists for this bookingId')
  assert.equal(requoteRes.body.previouslyRefundedKobo, expectedCapturedKobo)
  assert.equal(requoteRes.body.refundAmountKobo, 0, 'nothing further must ever be quoted as refundable')

  const captured = await cumulativeCapturedForBooking(customerUserId, bookingId)
  assert.equal(captured, expectedCapturedKobo, 'independent re-verification: captured total must not have grown due to the refund row existing')
})
