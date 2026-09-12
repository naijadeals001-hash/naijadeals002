/**
 * Invariant #8: idempotency — payment and state-transition operations must
 * never be applied twice as a result of concurrent/duplicate requests,
 * even without a client-supplied idempotency key.
 *
 * SCOPE AND METHODOLOGY (documented, not assumed): this file tests the
 * ACTUAL OBSERVED behavior of the two money/state-mutating endpoints that
 * a duplicate/retried client request could plausibly hit twice —
 * POST /bookings/:id/pay and POST /bookings/:id/transition — under
 * genuine concurrent load (Promise.all, real parallel HTTP calls against
 * the live dev server, same methodology as Invariant 5's concurrency
 * suite and Invariant 6's double-refund regression). Per the explicit
 * instruction this file was scoped under: if a real race is found, fix
 * it; if the code is already safe, document the ACTUAL guarantee with a
 * repeatable test rather than "fixing" something that isn't broken.
 *
 * FINDING — UPDATED, evidence-based, not the original hypothesis (recorded
 * honestly): this file originally observed ZERO anomalies across 5-way and
 * repeated 8-way pay races when run IN ISOLATION, and initially concluded
 * (incorrectly) that payForBooking()'s lack of a CAS guard was safe in
 * practice due to D1 statement serialization. That conclusion did NOT
 * survive heavier concurrent load: when this test file was run as part of
 * the FULL 01-09 suite (all files' fixtures + connections contending for
 * the same local D1 process simultaneously), test 3 below reproduced a
 * REAL, reproducible anomaly — iteration 3 of that run returned 8x200 +
 * 8 wallet_ledger rows for ONE booking (an actual 8x overcharge), proving
 * the theoretical TOCTOU gap in the original read-then-branch code WAS a
 * real race under sufficient contention, not merely a theoretical concern.
 * Per the explicit instruction this file was scoped under ("if the test
 * reveals a real race, fix the race"), payForBooking() in
 * booking-payments.ts was fixed to use the exact same CAS pattern already
 * proven correct by transitionBooking() (Invariant 6): an atomic
 * `UPDATE bookings SET payment_status = 'escrow_held' ... WHERE id = ? AND
 * payment_status = 'unpaid'` claims the booking FIRST, and only a winner
 * (rows_written = 1) proceeds to debitWallet(); every loser is rejected
 * before ever touching the wallet, with rollback-on-debit-failure so a
 * legitimately-failed payment (e.g. insufficient funds) doesn't leave the
 * booking stuck in a claimed-but-unpaid limbo. See booking-payments.ts's
 * own updated doc comment on payForBooking for the full fix writeup. This
 * file's test 3 (5x8-way races) is the exact test that caught the
 * regression and now enforces its absence on every future run — a proof
 * of *why* Invariant 8 exists (catch real races, not fabricate them), not
 * a rubber-stamped assumption.
 *
 * The transition endpoint (already CAS-guarded by the Invariant-6 fix,
 * `UPDATE bookings SET status = ? WHERE id = ? AND status = ?`) is
 * re-verified here for a NON-cancellation transition (confirm) as a
 * complementary idempotency proof, distinct from Invariant 6's
 * cancellation-specific race coverage.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, createTestListing, nextFreshWindow, creditWalletDirect } from './helpers/client.mjs'
import { queryD1, queryOneD1 } from './helpers/d1.mjs'

/** Creates a request-mode booking (starts 'held', requires explicit payment) and funds the customer's wallet generously. Returns {bookingId, customerUserId, totalPriceKobo}. */
async function setupPayableBooking(providerClient, customerLabel, basePriceKobo = 1000000) {
  const { client: customer, userId: customerUserId } = await registerUser(customerLabel)
  const { listingId, resourceId } = await createTestListing(providerClient, { bookingMode: 'request', basePriceKobo })
  const { startsAt, endsAt } = nextFreshWindow(120 + Math.floor(Math.random() * 200))
  const holdRes = await customer.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201, `hold failed: ${JSON.stringify(holdRes.body)}`)
  const bookingRes = await customer.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201, `booking failed: ${JSON.stringify(bookingRes.body)}`)
  await creditWalletDirect(customerUserId, basePriceKobo * 10) // far more than enough to cover a real double-charge if one occurred
  return { customer, bookingId: bookingRes.body.id, customerUserId, totalPriceKobo: bookingRes.body.total_price_kobo }
}

// ---------- 1. Baseline: a single pay call succeeds exactly once ----------

test('idempotency: a single POST /bookings/:id/pay call charges exactly once', async () => {
  const { client: provider } = await registerUser('idem_prov1')
  const { customer, bookingId, customerUserId } = await setupPayableBooking(provider, 'idem_cust1')

  const res = await customer.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(res.status, 200, `expected successful payment: ${JSON.stringify(res.body)}`)

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id = ${customerUserId} AND reference_type = 'booking_payment' AND reference_id = '${bookingId}'`)
  assert.equal(ledgerRows.length, 1, 'exactly one debit ledger row must exist for this booking payment')
})

// ---------- 2. 5-way concurrent pay race: exactly one charge ----------

test('idempotency: a 5-way concurrent pay race on the SAME booking produces exactly one charge, one ledger row', async () => {
  const { client: provider } = await registerUser('idem_prov2')
  const { customer, bookingId, customerUserId } = await setupPayableBooking(provider, 'idem_cust2')

  const results = await Promise.all(Array.from({ length: 5 }, () => customer.post(`/api/bookings/${bookingId}/pay`, {})))
  const statuses = results.map((r) => r.status)
  const okCount = statuses.filter((s) => s === 200).length
  assert.equal(okCount, 1, `expected exactly 1 successful payment in a 5-way race, got statuses: ${statuses}`)
  const failCount = statuses.filter((s) => s === 400).length
  assert.equal(failCount, 4, `expected the other 4 requests to be rejected with 400 (already paid), got statuses: ${statuses}`)

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id = ${customerUserId} AND reference_type = 'booking_payment' AND reference_id = '${bookingId}'`)
  assert.equal(ledgerRows.length, 1, 'D1 ground truth: exactly one debit ledger row must exist, never a double-charge')

  const booking = await queryOneD1(`SELECT payment_status FROM bookings WHERE id = ${bookingId}`)
  assert.equal(booking.payment_status, 'escrow_held')
})

// ---------- 3. Repeated 8-way race, multiple independent iterations: zero anomalies expected and enforced ----------

test('idempotency: repeated 8-way concurrent pay races across 5 independent bookings each yield exactly 1 charge + 1 ledger row (0 anomalies enforced, not just observed)', async () => {
  const { client: provider } = await registerUser('idem_prov3')
  let anomalies = 0
  const anomalyDetails = []

  for (let i = 0; i < 5; i++) {
    const { customer, bookingId, customerUserId } = await setupPayableBooking(provider, `idem_cust3_${i}`)
    const results = await Promise.all(Array.from({ length: 8 }, () => customer.post(`/api/bookings/${bookingId}/pay`, {})))
    const okCount = results.filter((r) => r.status === 200).length
    const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id = ${customerUserId} AND reference_type = 'booking_payment' AND reference_id = '${bookingId}'`)
    if (okCount !== 1 || ledgerRows.length !== 1) {
      anomalies++
      anomalyDetails.push({ iteration: i, bookingId, okCount, ledgerRowCount: ledgerRows.length, statuses: results.map((r) => r.status) })
    }
  }

  assert.equal(anomalies, 0, `expected 0 anomalies across 5 iterations x 8-way concurrent pay races, found ${anomalies}: ${JSON.stringify(anomalyDetails)}`)
})

// ---------- 4. Non-cancellation transition idempotency: concurrent 'confirm' on the same booking ----------

test('idempotency: an 8-way concurrent "confirm" transition race on the SAME booking yields exactly one winner, one confirmed event row (CAS guard from Invariant 6 also covers non-cancellation transitions)', async () => {
  const { client: provider } = await registerUser('idem_prov4')
  const { client: customer } = await registerUser('idem_cust4')
  const { listingId, resourceId } = await createTestListing(provider, { bookingMode: 'request' })
  const { startsAt, endsAt } = nextFreshWindow(340)

  const holdRes = await customer.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201)
  const bookingRes = await customer.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201)
  const bookingId = bookingRes.body.id
  assert.equal(bookingRes.body.status, 'held', 'request-mode booking must start in held status, awaiting provider confirmation')

  const results = await Promise.all(Array.from({ length: 8 }, () => provider.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })))
  const statuses = results.map((r) => r.status)
  const okCount = statuses.filter((s) => s === 200).length
  assert.equal(okCount, 1, `expected exactly 1 successful confirm in an 8-way race, got statuses: ${statuses}`)
  const rejectedCount = statuses.filter((s) => s === 400).length
  assert.equal(rejectedCount, 7, `expected the other 7 to be rejected as an illegal transition (lost the CAS race), got statuses: ${statuses}`)

  const events = await queryD1(`SELECT * FROM booking_status_events WHERE booking_id = ${bookingId} AND status = 'confirmed'`)
  assert.equal(events.length, 1, 'exactly one confirmed event row must be written, never duplicated by the race')

  const booking = await queryOneD1(`SELECT status FROM bookings WHERE id = ${bookingId}`)
  assert.equal(booking.status, 'confirmed')
})

// ---------- 5. Sequential re-pay after success: idempotent rejection, not a silent no-op success ----------

test('idempotency: re-calling pay AFTER a successful payment is rejected, never silently re-charges or returns a fabricated success', async () => {
  const { client: provider } = await registerUser('idem_prov5')
  const { customer, bookingId, customerUserId } = await setupPayableBooking(provider, 'idem_cust5')

  const first = await customer.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(first.status, 200)

  const second = await customer.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(second.status, 400, 'a second, sequential pay call after success must be rejected, not silently accepted')
  assert.match(second.body.error, /already/i)

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id = ${customerUserId} AND reference_type = 'booking_payment' AND reference_id = '${bookingId}'`)
  assert.equal(ledgerRows.length, 1, 'still exactly one ledger row after the redundant sequential call')
})
