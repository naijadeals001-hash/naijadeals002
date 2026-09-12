/**
 * Invariant #6 (gate mandate, minimum-8 list): cancellation + refund/wallet
 * consistency — a MONEY-SAFETY invariant. Verifies booking status + payment
 * status + refund amount + wallet_ledger + booking_status_events remain
 * internally consistent throughout cancellation.
 *
 * ACTUAL ARCHITECTURE (verified by inspection before writing this file —
 * see the "Invariant 6 Report" for full detail, summarized here so the
 * intent of each assertion below is traceable to real code, not spec
 * assumption):
 *
 *   - src/lib/booking-cancellation.ts's cancelBookingWithPolicy() is the
 *     ONLY entry point. It: (1) reads the booking once, (2) computes a
 *     policy-driven refund quote, (3) calls transitionBooking(...,
 *     'cancelled', ...) — the ONE authority for status changes, (4) stamps
 *     cancellation_fee_kobo/refund_amount_kobo on the booking row, (5) IFF
 *     refundAmountKobo > 0 AND the booking's payment_status was
 *     escrow_held/released, credits the customer's wallet via the single
 *     authoritative wallet_ledger (src/lib/wallet.ts's creditWallet) and
 *     sets payment_status='refunded'.
 *
 *   - UNLIKE Marketplace Engine 2.1's refunds.ts, Booking Engine 2.0 has NO
 *     separate `refunds` commerce-context table — refund traceability is
 *     wallet_ledger rows with reference_type='booking_refund',
 *     reference_id=<bookingId> ONLY. This is documented, not fabricated.
 *
 *   - "Cancellation policy enforcement" in this codebase does NOT mean
 *     "cancellation is blocked". There is no code path that refuses to
 *     cancel a booking based on policy — the policy only controls the
 *     REFUND PERCENTAGE (0-100%, cutoff-dependent). An after-cutoff /
 *     strict policy still lets the cancellation succeed; it simply zeroes
 *     the refund. Test 2 verifies this actual contract.
 *
 *   - There is NO provider payout/escrow-release anywhere in Booking Engine
 *     2.0 (confirmed: zero creditWallet calls targeting provider_user_id in
 *     booking-lifecycle.ts / booking-payments.ts / booking-cancellation.ts
 *     — already flagged as a documented gap in booking-payments.ts's own
 *     header comment). "Provider-side financial state is consistent" in
 *     this codebase currently means "unaffected" — verified explicitly
 *     below, not assumed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, createTestListing, creditWalletDirect, nextFreshWindow, freshWindow } from './helpers/client.mjs'
import { queryD1, queryOneD1 } from './helpers/d1.mjs'

// ---------- local fixture helpers (specific to this invariant's money flow) ----------

/** Creates a cancellation policy owned by `providerClient`'s user, returns its id. */
async function createPolicy(providerClient, { cutoffHours = 24, beforePct = 100, afterPct = 0, flatFeeKobo = 0, name } = {}) {
  const res = await providerClient.post('/api/booking-providers/me/cancellation-policies', {
    name: name ?? `Harness Policy ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    policyType: 'custom',
    cutoffHoursBeforeStart: cutoffHours,
    refundPercentageBeforeCutoff: beforePct,
    refundPercentageAfterCutoff: afterPct,
    flatFeeKobo,
  })
  assert.equal(res.status, 201, `createPolicy failed: ${JSON.stringify(res.body)}`)
  return res.body.id
}

/**
 * Full happy-path setup: registers a fresh provider+customer (UNLESS an
 * existing `provider` {client, userId} is passed in — required whenever the
 * caller needs to create a cancellationPolicy BEFORE the listing exists,
 * since a policy's owner_user_id must match the listing's actual
 * provider_user_id or the ownership check in POST
 * /booking-providers/me/bookable-listings correctly 404s it), creates an
 * instant-mode listing (optionally with a custom cancellationPolicyId),
 * funds the customer's wallet, holds+books+pays for a window `hoursFromNow`
 * out — instant-mode auto-confirms on payment, landing the booking at
 * status='confirmed', payment_status='escrow_held'. Returns everything a
 * cancellation test needs.
 */
async function setupPaidBooking({ hoursFromNow, basePriceKobo = 1_000_000, cancellationPolicyId, labelSuffix = '', provider } = {}) {
  const { client: providerClient, userId: providerUserId } = provider ?? (await registerUser(`cxl_prov${labelSuffix}`))
  const { client: customerClient, userId: customerUserId } = await registerUser(`cxl_cust${labelSuffix}`)
  const { listingId, resourceId } = await createTestListing(providerClient, {
    bookingMode: 'instant',
    basePriceKobo,
    cancellationPolicyId,
  })
  await creditWalletDirect(customerUserId, basePriceKobo * 2) // headroom

  const { startsAt, endsAt } = hoursFromNow !== undefined ? freshWindow(hoursFromNow, 2) : nextFreshWindow(2)

  const holdRes = await customerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201, `hold failed: ${JSON.stringify(holdRes.body)}`)

  const bookingRes = await customerClient.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201, `booking failed: ${JSON.stringify(bookingRes.body)}`)
  const bookingId = bookingRes.body.id
  assert.equal(bookingRes.body.status, 'pending_payment', 'instant-mode listing must start pending_payment before pay')

  const payRes = await customerClient.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(payRes.status, 200, `pay failed: ${JSON.stringify(payRes.body)}`)
  assert.equal(payRes.body.status, 'confirmed', 'instant-mode must auto-confirm on payment')
  assert.equal(payRes.body.payment_status, 'escrow_held')

  return { providerClient, providerUserId, customerClient, customerUserId, listingId, resourceId, bookingId, totalPriceKobo: payRes.body.total_price_kobo }
}

async function walletBalance(userId) {
  const row = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id = ${userId}`)
  return row ? Number(row.cached_balance_kobo) : 0
}

async function refundLedgerRows(bookingId) {
  return queryD1(`SELECT * FROM wallet_ledger WHERE reference_type = 'booking_refund' AND reference_id = '${bookingId}'`)
}

async function cancelledEventRows(bookingId) {
  return queryD1(`SELECT * FROM booking_status_events WHERE booking_id = ${bookingId} AND status = 'cancelled' ORDER BY id ASC`)
}

async function getBookingRow(bookingId) {
  return queryOneD1(`SELECT * FROM bookings WHERE id = ${bookingId}`)
}

// ============================================================
// TEST 1 — Eligible cancellation (well before cutoff, default policy)
// ============================================================
test('cancellation: eligible cancellation before cutoff refunds 100% via default policy, verified against real D1 rows', async () => {
  const { customerClient, customerUserId, providerUserId, bookingId, totalPriceKobo } = await setupPaidBooking({ hoursFromNow: 24 * 40 }) // 40 days out, default policy cutoff=24h -> well before cutoff

  const balanceBeforeCancel = await walletBalance(customerUserId)
  const providerBalanceBefore = await walletBalance(providerUserId)

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'change of plans' })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))
  assert.equal(cancelRes.body.booking.status, 'cancelled')
  assert.equal(cancelRes.body.quote.refundPercentage, 100)

  // Ground truth: booking row itself.
  const row = await getBookingRow(bookingId)
  assert.equal(row.status, 'cancelled')
  assert.equal(row.payment_status, 'refunded')
  assert.equal(Number(row.refund_amount_kobo), totalPriceKobo, 'full refund must equal the exact amount paid')
  assert.equal(Number(row.cancellation_fee_kobo), 0)
  assert.equal(Number(row.cancelled_by_user_id), customerUserId, 'cancelled_by_user_id must record the real actor, not fabricated')
  assert.equal(row.cancelled_reason, 'change of plans')

  // Ground truth: exactly one refund ledger row, amount matches exactly.
  const refundRows = await refundLedgerRows(bookingId)
  assert.equal(refundRows.length, 1, `expected exactly one refund ledger row, got ${refundRows.length}`)
  assert.equal(Number(refundRows[0].amount_kobo), totalPriceKobo)
  assert.equal(refundRows[0].entry_type, 'credit')

  // Ground truth: wallet balance moved by exactly the refund amount, no more no less.
  const balanceAfterCancel = await walletBalance(customerUserId)
  assert.equal(balanceAfterCancel, balanceBeforeCancel + totalPriceKobo, 'wallet balance delta must equal exact refund amount')

  // Ground truth: exactly one 'cancelled' status event, correct actor.
  const events = await cancelledEventRows(bookingId)
  assert.equal(events.length, 1)
  assert.equal(Number(events[0].actor_user_id), customerUserId)
  assert.equal(events[0].actor_role, 'customer')

  // Provider-side financial state: this codebase has NO provider payout
  // mechanism anywhere in Booking Engine 2.0 (verified by inspection) — so
  // "consistent" here means "correctly unaffected by a customer-side
  // refund", not "correctly paid out". Verified explicitly, not assumed.
  const providerBalanceAfter = await walletBalance(providerUserId)
  assert.equal(providerBalanceAfter, providerBalanceBefore, 'provider wallet must be untouched by a customer refund (no payout mechanism exists in this engine)')
})

// ============================================================
// TEST 2 — Cancellation policy enforcement (after-cutoff => 0% refund;
// cancellation itself still succeeds — that is the actual contract in this
// codebase, not a blocked cancellation)
// ============================================================
test('cancellation: after-cutoff policy zeroes the refund (cancellation still succeeds; no refund is fabricated); client cannot smuggle a refund amount or foreign policy id', async () => {
  const provider = await registerUser('cxl_policy_prov')
  const { client: providerClient } = provider
  const strictPolicyId = await createPolicy(providerClient, { cutoffHours: 24, beforePct: 100, afterPct: 0, flatFeeKobo: 0 })

  // SECURITY REGRESSION CHECK (organizationId injection / cancellationPolicyId
  // theft — Booking Engine 2.0 57-check gate findings): explicitly re-verify
  // neither vulnerability is reproducible while this invariant attaches
  // cancellation policies to listings.
  const { client: attackerClient } = await registerUser('cxl_policy_attacker')
  const theftAttempt = await attackerClient.post('/api/booking-providers/me/bookable-listings', {
    listingType: 'gig_service', title: 'Theft attempt', countryIso: 'NG', basePriceKobo: 100000,
    cancellationPolicyId: strictPolicyId, // belongs to providerClient, NOT attackerClient
  })
  assert.equal(theftAttempt.status, 404, 'cancellationPolicyId theft regression: attacker must not attach another provider\'s policy')
  const orgInjectionAttempt = await attackerClient.post('/api/booking-providers/me/bookable-listings', {
    listingType: 'gig_service', title: 'Org injection attempt', countryIso: 'NG', basePriceKobo: 100000,
    organizationId: 1,
  })
  assert.equal(orgInjectionAttempt.status, 201, JSON.stringify(orgInjectionAttempt.body))
  const createdListing = await queryOneD1(`SELECT organization_id FROM bookable_listings WHERE id = ${orgInjectionAttempt.body.id}`)
  assert.equal(createdListing.organization_id, null, 'organizationId injection regression: client-supplied organizationId must be nulled, never honored')

  // Now the actual invariant-6 scenario: window inside the 24h cutoff.
  const { customerClient, customerUserId, bookingId, totalPriceKobo } = await setupPaidBooking({
    hoursFromNow: 2, // inside the 24h cutoff -> after-cutoff refund percentage applies
    cancellationPolicyId: strictPolicyId,
    labelSuffix: '_policy2',
    provider,
  })

  const balanceBeforeCancel = await walletBalance(customerUserId)
  const refundRowsBefore = await refundLedgerRows(bookingId)
  assert.equal(refundRowsBefore.length, 0)

  // Attacker-style body: try to smuggle a refund amount / different policy id / fee via the cancel request itself.
  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, {
    reason: 'too late',
    refund_amount_kobo: 999_999_999,
    cancellationPolicyId: 999999,
    cancellation_fee_kobo: -500000,
  })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))
  assert.equal(cancelRes.body.quote.refundPercentage, 0, 'after-cutoff refund percentage must be 0 per the configured strict policy')
  assert.equal(cancelRes.body.booking.status, 'cancelled', 'cancellation itself succeeds even though refund is zero — this codebase does not block cancellation via policy')

  const row = await getBookingRow(bookingId)
  assert.equal(Number(row.refund_amount_kobo), 0, 'client-supplied refund_amount_kobo must be completely ignored')
  assert.equal(Number(row.cancellation_fee_kobo), 0, 'client-supplied cancellation_fee_kobo must be completely ignored')
  assert.equal(row.payment_status, 'escrow_held', 'a zero-refund cancellation does not flip payment_status to refunded — nothing was refunded (documented behavior, see NOT IMPLEMENTED)')

  const refundRowsAfter = await refundLedgerRows(bookingId)
  assert.equal(refundRowsAfter.length, 0, 'no refund ledger row must be created when refund percentage is 0')

  const balanceAfterCancel = await walletBalance(customerUserId)
  assert.equal(balanceAfterCancel, balanceBeforeCancel, 'wallet balance must be completely unchanged for a zero-refund cancellation')

  assert.notEqual(totalPriceKobo, 0) // sanity: booking really was paid, refund really is legitimately zero, not a broken fixture
})

// ============================================================
// TEST 3 — Partial refund
// ============================================================
test('cancellation: partial refund (50% policy + flat fee) reconciles exactly — paid - refund = retained, derived from the policy config we set, not from the function under test', async () => {
  const provider = await registerUser('cxl_partial_prov')
  const { client: providerClient } = provider
  const beforePct = 50
  const flatFeeKobo = 10_000
  const policyId = await createPolicy(providerClient, { cutoffHours: 24, beforePct, afterPct: 0, flatFeeKobo })

  const basePriceKobo = 1_000_000
  const { customerClient, customerUserId, bookingId } = await setupPaidBooking({
    hoursFromNow: 24 * 10, // well before cutoff
    basePriceKobo,
    cancellationPolicyId: policyId,
    labelSuffix: '_partial',
    provider,
  })

  // Independently derived expectation from the RAW policy numbers we configured (not from quoteCancellation/cancelBookingWithPolicy).
  const expectedGross = Math.round((basePriceKobo * beforePct) / 100) // 500,000
  const expectedFee = Math.min(flatFeeKobo, expectedGross) // 10,000
  const expectedRefund = expectedGross - expectedFee // 490,000
  const expectedRetained = basePriceKobo - expectedRefund // 510,000

  const balanceBefore = await walletBalance(customerUserId)
  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'partial refund test' })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))

  const row = await getBookingRow(bookingId)
  assert.equal(Number(row.refund_amount_kobo), expectedRefund, `expected ${expectedRefund} kobo refund from raw policy math`)
  assert.equal(Number(row.cancellation_fee_kobo), expectedFee)
  assert.equal(row.payment_status, 'refunded')
  assert.equal(basePriceKobo - Number(row.refund_amount_kobo), expectedRetained, 'paid - refund must equal the independently-derived retained amount')

  const refundRows = await refundLedgerRows(bookingId)
  assert.equal(refundRows.length, 1)
  assert.equal(Number(refundRows[0].amount_kobo), expectedRefund)

  const balanceAfter = await walletBalance(customerUserId)
  assert.equal(balanceAfter, balanceBefore + expectedRefund)
})

// ============================================================
// TEST 4 — Full refund
// ============================================================
test('cancellation: full refund (100% policy) produces exactly one refund, wallet reflects exactly one credit, no duplicate', async () => {
  const provider = await registerUser('cxl_full_prov')
  const { client: providerClient } = provider
  const policyId = await createPolicy(providerClient, { cutoffHours: 24, beforePct: 100, afterPct: 0, flatFeeKobo: 0 })
  const basePriceKobo = 2_000_000

  const { customerClient, customerUserId, bookingId } = await setupPaidBooking({
    hoursFromNow: 24 * 5,
    basePriceKobo,
    cancellationPolicyId: policyId,
    labelSuffix: '_full',
    provider,
  })

  const balanceBefore = await walletBalance(customerUserId)
  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'full refund test' })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))

  const row = await getBookingRow(bookingId)
  assert.equal(Number(row.refund_amount_kobo), basePriceKobo)
  assert.equal(row.payment_status, 'refunded')
  assert.equal(row.status, 'cancelled')

  const refundRows = await refundLedgerRows(bookingId)
  assert.equal(refundRows.length, 1, 'exactly one refund row, never duplicated')
  assert.equal(Number(refundRows[0].amount_kobo), basePriceKobo)

  const balanceAfter = await walletBalance(customerUserId)
  assert.equal(balanceAfter, balanceBefore + basePriceKobo, 'no duplicate credit')

  const events = await cancelledEventRows(bookingId)
  assert.equal(events.length, 1)
})

// ============================================================
// TEST 5 — Already cancelled (canonical contract: typed conflict, NOT idempotent success)
// ============================================================
test('cancellation: cancelling an already-cancelled booking is rejected (400, IllegalBookingTransitionError) — never a second refund/credit/event', async () => {
  const { customerClient, customerUserId, bookingId, totalPriceKobo } = await setupPaidBooking({ hoursFromNow: 24 * 20, labelSuffix: '_double' })

  const firstCancel = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'first' })
  assert.equal(firstCancel.status, 200, JSON.stringify(firstCancel.body))

  const balanceAfterFirst = await walletBalance(customerUserId)
  const refundRowsAfterFirst = await refundLedgerRows(bookingId)
  assert.equal(refundRowsAfterFirst.length, 1)
  assert.equal(Number(refundRowsAfterFirst[0].amount_kobo), totalPriceKobo)

  const secondCancel = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'second attempt' })
  assert.equal(secondCancel.status, 400, JSON.stringify(secondCancel.body))
  assert.match(secondCancel.body.error, /cannot transition/i, 'canonical contract is a typed IllegalBookingTransitionError, not silent idempotent success')

  // Nothing must have moved a second time.
  const balanceAfterSecond = await walletBalance(customerUserId)
  assert.equal(balanceAfterSecond, balanceAfterFirst, 'no second wallet credit')

  const refundRowsAfterSecond = await refundLedgerRows(bookingId)
  assert.equal(refundRowsAfterSecond.length, 1, 'no duplicate refund ledger row')

  const events = await cancelledEventRows(bookingId)
  assert.equal(events.length, 1, 'no duplicate cancellation event')

  const row = await getBookingRow(bookingId)
  assert.equal(row.status, 'cancelled')
  assert.equal(Number(row.refund_amount_kobo), totalPriceKobo, 'refund_amount_kobo must not have been overwritten/corrupted by the rejected second attempt')
})

// ============================================================
// TEST 6 — Concurrent cancellation (MANDATORY, genuine Promise.all race)
//
// BUG FOUND + FIXED via this exact test methodology (see Invariant 6
// report): transitionBooking()'s status-changing UPDATE originally had NO
// `WHERE status = ?` compare-and-swap guard (unlike booking-holds.ts's
// atomic claim pattern). A live 3-way Promise.all() stress run (mixed
// customer/provider actors, 15 iterations outside this file, then repeated
// at 6-way width x 20 iterations after the fix) reproduced a genuine TRIPLE
// refund on iteration 0 before the fix, and 0 anomalies across 35 total
// stress iterations after. This in-suite test uses a 4-way mixed-actor race
// (2 customer calls + 2 provider calls, all genuinely concurrent) so the
// permanent regression harness itself would have caught the original bug.
// ============================================================
test('cancellation: four genuinely concurrent cancel requests (mixed customer/provider actors) on the same booking produce exactly one refund, one credit, one terminal state', async () => {
  const { providerClient, customerClient, customerUserId, bookingId, totalPriceKobo } = await setupPaidBooking({ hoursFromNow: 24 * 15, labelSuffix: '_race' })

  const balanceBefore = await walletBalance(customerUserId)

  const [r1, r2, r3, r4] = await Promise.all([
    customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'race-A' }),
    providerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'race-B' }),
    customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'race-C' }),
    providerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'race-D' }),
  ])
  const results = [r1, r2, r3, r4]
  const statuses = results.map((r) => r.status)
  const winners = statuses.filter((s) => s === 200).length
  const losers = statuses.filter((s) => s === 400).length
  assert.equal(winners, 1, `expected exactly one winner (200) from a genuine 4-way race, got ${winners} — statuses: ${JSON.stringify(statuses)}, bodies: ${JSON.stringify(results.map((r) => r.body))}`)
  assert.equal(losers, 3, `expected exactly three losers (400), got ${losers}`)

  for (const r of results) {
    if (r.status === 400) {
      assert.match(r.body.error, /cannot transition/i, 'every losing concurrent request must receive the canonical IllegalBookingTransitionError response, not a fabricated success')
    }
  }

  // Ground truth: exactly ONE refund credit, no double/triple refund.
  const refundRows = await refundLedgerRows(bookingId)
  assert.equal(refundRows.length, 1, `expected exactly 1 refund ledger row after a 4-way race, got ${refundRows.length} — DOUBLE/TRIPLE REFUND if > 1`)
  assert.equal(Number(refundRows[0].amount_kobo), totalPriceKobo)

  const balanceAfter = await walletBalance(customerUserId)
  assert.equal(balanceAfter, balanceBefore + totalPriceKobo, 'wallet balance must reflect exactly one credit, never more')

  // Ground truth: exactly one terminal 'cancelled' state, exactly one status event.
  const row = await getBookingRow(bookingId)
  assert.equal(row.status, 'cancelled')
  assert.equal(row.payment_status, 'refunded')

  const events = await cancelledEventRows(bookingId)
  assert.equal(events.length, 1, `expected exactly 1 'cancelled' status event, got ${events.length} — the race must not produce a duplicate audit event`)
})

// ============================================================
// TEST 7 — Cross-tenant cancellation
// ============================================================
test('cancellation: an unrelated customer cannot cancel another customer\'s booking (404, no financial mutation, no existence leak)', async () => {
  const { bookingId, customerUserId, totalPriceKobo } = await setupPaidBooking({ hoursFromNow: 24 * 20, labelSuffix: '_xtenant' })
  const { client: attackerClient } = await registerUser('cxl_xtenant_attacker')

  const before = await getBookingRow(bookingId)
  const balanceBefore = await walletBalance(customerUserId)

  const res = await attackerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'hijack' })
  assert.equal(res.status, 404)
  assert.equal(res.body.error, 'Booking not found', 'must not hint the booking exists but is inaccessible')

  const after = await getBookingRow(bookingId)
  assert.equal(after.status, before.status, 'booking state must be completely unchanged')
  assert.equal(Number(after.refund_amount_kobo), 0)
  assert.equal(after.payment_status, before.payment_status)

  const refundRows = await refundLedgerRows(bookingId)
  assert.equal(refundRows.length, 0, 'no refund must ever be created by a cross-tenant attempt')

  const balanceAfter = await walletBalance(customerUserId)
  assert.equal(balanceAfter, balanceBefore, 'victim wallet must be untouched')
  assert.ok(totalPriceKobo > 0) // sanity
})

// ============================================================
// TEST 8 — Provider RBAC around cancellation/refund (actual contract, not assumed)
// ============================================================
test('cancellation: provider may legitimately cancel their own booking, but cannot redirect the refund to themselves, pay as the customer, or force a refunded transition', async () => {
  const { providerClient, providerUserId, customerClient, customerUserId, bookingId, totalPriceKobo } = await setupPaidBooking({ hoursFromNow: 24 * 12, labelSuffix: '_provrbac' })

  // (a) Provider CANNOT pay for the booking as if they were the customer —
  // payForBooking scopes strictly by customer_user_id.
  const payAttempt = await providerClient.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(payAttempt.status, 400)
  assert.match(payAttempt.body.error, /not found|not owned/i)

  // (b) Provider CANNOT force targetStatus='refunded' via the generic transition endpoint (not in validProviderTargets).
  const forceRefund = await providerClient.post(`/api/bookings/${bookingId}/transition`, { status: 'refunded' })
  assert.equal(forceRefund.status, 403)

  const providerBalanceBefore = await walletBalance(providerUserId)
  const customerBalanceBefore = await walletBalance(customerUserId)

  // (c) Provider legitimately cancelling their OWN confirmed booking IS a
  // real allowed RBAC transition in this codebase (confirmed -> provider:
  // [...,'cancelled',...]) — not fraud. Verify the refund still lands on
  // the CUSTOMER's wallet, never the provider's.
  const cancelRes = await providerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'provider-initiated cancellation' })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))

  const row = await getBookingRow(bookingId)
  assert.equal(row.status, 'cancelled')
  assert.equal(Number(row.cancelled_by_user_id), providerUserId, 'audit trail must correctly attribute the provider as actor, not fabricate the customer')

  const refundRows = await refundLedgerRows(bookingId)
  assert.equal(refundRows.length, 1)
  assert.equal(Number(refundRows[0].user_id), customerUserId, 'the refund credit must belong to the CUSTOMER, never the cancelling provider')

  const providerBalanceAfter = await walletBalance(providerUserId)
  const customerBalanceAfter = await walletBalance(customerUserId)
  assert.equal(providerBalanceAfter, providerBalanceBefore, 'provider cannot redirect any money to themselves by cancelling')
  assert.equal(customerBalanceAfter, customerBalanceBefore + totalPriceKobo, 'customer receives the full refund regardless of who (customer or provider) triggered it')
})

// ============================================================
// TEST 9 — Financial reconciliation, independently derived (not via the function under test)
// ============================================================
test('cancellation: financial reconciliation — debit ledger, credit ledger, cached balance, and booking row all independently agree', async () => {
  const provider = await registerUser('cxl_recon_prov')
  const { client: providerClient } = provider
  const beforePct = 70
  const flatFeeKobo = 0
  const policyId = await createPolicy(providerClient, { cutoffHours: 24, beforePct, afterPct: 0, flatFeeKobo })
  const basePriceKobo = 3_000_000

  const { customerClient, customerUserId, bookingId } = await setupPaidBooking({
    hoursFromNow: 24 * 6,
    basePriceKobo,
    cancellationPolicyId: policyId,
    labelSuffix: '_recon',
    provider,
  })

  // Independent expectation from raw policy numbers (never calling quoteCancellation ourselves).
  const expectedRefund = Math.round((basePriceKobo * beforePct) / 100)

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'reconciliation test' })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))

  // 1. Independent ledger-vs-cache reconciliation for the customer: cached
  // balance must equal the raw SUM of every ledger row for this user — this
  // is the wallet system's OWN internal invariant (wallet.ts's module doc:
  // "cached_balance_kobo... MUST always equal SUM of wallet_ledger"),
  // verified here from raw rows, not trusted from the cache alone.
  const ledgerRows = await queryD1(`SELECT entry_type, amount_kobo FROM wallet_ledger WHERE user_id = ${customerUserId}`)
  const computedBalance = ledgerRows.reduce((sum, r) => sum + (r.entry_type === 'credit' ? Number(r.amount_kobo) : -Number(r.amount_kobo)), 0)
  const cachedBalance = await walletBalance(customerUserId)
  assert.equal(cachedBalance, computedBalance, 'cached_balance_kobo must exactly equal the independently-summed raw ledger for this user')

  // 2. The specific debit (payment) row for this booking.
  const debitRow = await queryOneD1(`SELECT amount_kobo FROM wallet_ledger WHERE user_id = ${customerUserId} AND reference_type = 'booking_payment' AND reference_id = '${bookingId}'`)
  assert.ok(debitRow, 'payment debit row must exist')
  assert.equal(Number(debitRow.amount_kobo), basePriceKobo)

  // 3. The specific credit (refund) row for this booking.
  const creditRows = await refundLedgerRows(bookingId)
  assert.equal(creditRows.length, 1)
  assert.equal(Number(creditRows[0].amount_kobo), expectedRefund)

  // 4. Booking row's own stamped fields agree with the ledger, independently.
  const row = await getBookingRow(bookingId)
  assert.equal(Number(row.total_price_kobo), basePriceKobo)
  assert.equal(Number(row.refund_amount_kobo), expectedRefund)
  assert.equal(Number(row.total_price_kobo) - Number(row.refund_amount_kobo), basePriceKobo - expectedRefund, 'payment - refund must reconcile to the retained amount exactly (integer kobo, no float)')

  // 5. Debit amount minus credit amount, computed purely from the two raw
  // ledger rows (never from application-computed totals), must equal the
  // policy-derived retained amount.
  assert.equal(Number(debitRow.amount_kobo) - Number(creditRows[0].amount_kobo), basePriceKobo - expectedRefund)
})

// ============================================================
// TEST 10 — Event history (immutable lifecycle audit trail)
// ============================================================
test('cancellation: produces a correct, non-duplicated, correctly-ordered lifecycle event with no fabricated actor', async () => {
  const { customerClient, customerUserId, bookingId } = await setupPaidBooking({ hoursFromNow: 24 * 9, labelSuffix: '_events' })

  const beforeEvents = await queryD1(`SELECT id, status, actor_user_id, actor_role, created_at FROM booking_status_events WHERE booking_id = ${bookingId} ORDER BY id ASC`)
  assert.ok(beforeEvents.length >= 2, 'expected at least a creation + confirmation event before cancellation')

  const cancelRes = await customerClient.post(`/api/bookings/${bookingId}/cancel`, { reason: 'event history test' })
  assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.body))

  const afterEvents = await queryD1(`SELECT id, booking_id, status, actor_user_id, actor_role, note, created_at FROM booking_status_events WHERE booking_id = ${bookingId} ORDER BY id ASC`)
  assert.equal(afterEvents.length, beforeEvents.length + 1, 'exactly one new event must be added by cancellation')

  const cancelEvents = afterEvents.filter((e) => e.status === 'cancelled')
  assert.equal(cancelEvents.length, 1, 'no duplicate financial/status event')
  const cancelEvent = cancelEvents[0]

  assert.equal(Number(cancelEvent.booking_id), bookingId, 'correct booking ID')
  assert.equal(Number(cancelEvent.actor_user_id), customerUserId, 'correct actor — no fabricated actor')
  assert.equal(cancelEvent.actor_role, 'customer', 'correct actor role')
  assert.equal(cancelEvent.note, 'event history test', 'reason correctly recorded as the note')

  // Ordering: ids strictly increasing, cancellation event is the LAST one.
  const ids = afterEvents.map((e) => Number(e.id))
  const sortedIds = [...ids].sort((a, b) => a - b)
  assert.deepEqual(ids, sortedIds, 'event ids/ordering must be monotonic (immutable append-only history)')
  assert.equal(ids[ids.length - 1], Number(cancelEvent.id), 'cancellation event must be the most recent event')
})
