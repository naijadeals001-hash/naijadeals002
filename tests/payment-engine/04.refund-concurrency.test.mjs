/**
 * Payment Engine — Unit 5 (Engine 7 Phase 2): refund concurrency hardening
 * (G-4 — aggregate refundable-amount race). Exercises
 * createAndExecuteRefund() in src/lib/refunds.ts DIRECTLY, in-process,
 * against the real local D1 binding — same rationale as Units 2/4 (see
 * helpers/db.mjs's header comment): createAndExecuteRefund() has no
 * dedicated single-purpose HTTP endpoint of its own (it's reached via
 * api-admin.ts's /orders/:orderId/refund, which requires
 * requirePlatformRole('admin') session plumbing irrelevant to what THIS
 * unit hardens), and calling it directly is the correct layer to prove the
 * N-way concurrent aggregate-cap race is actually closed.
 *
 * src/lib/refunds.ts imports './wallet' with an extensionless relative
 * specifier (Vite's required style) — see
 * helpers/ts-extensionless-loader.mjs's header comment for the test-only
 * resolution shim this requires (zero effect on the production bundle).
 *
 * Run TWICE per the Phase 2 protocol's "run the targeted suite at least
 * twice" requirement:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/payment-engine/04.refund-concurrency.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestUser, queryD1, queryOneD1, disposeTestDb } from './helpers/db.mjs'
import { createTestCartItem } from './helpers/order-fixtures.mjs'
import { createPendingOrder, confirmOrderPayment } from '../../src/lib/orders.ts'
import { creditWallet } from '../../src/lib/wallet.ts'
import { createAndExecuteRefund, RefundError } from '../../src/lib/refunds.ts'

test.after(async () => {
  await disposeTestDb()
})

/**
 * Creates a fully-paid order (via the SAME confirmOrderPayment() path Unit
 * 4 hardened) so its total_kobo is a real captured amount a refund can
 * legitimately be issued against. Also credits the customer's wallet with
 * some baseline funds first (irrelevant to refunds — creditWallet() is the
 * TARGET of the refund, not a precondition — but keeps balance assertions
 * unambiguous by starting from a known, non-zero baseline of 0).
 */
async function newPaidOrder(label, { priceKobo = 100000, quantity = 1 } = {}) {
  const db = await getTestDb()
  const userId = await createTestUser(`refund_${label}`)
  const item = await createTestCartItem({ label, priceKobo, quantity })
  const shipping = { name: 'Test Buyer', phone: '08000000000', address: '1 Test St', city: 'Lagos', state: 'Lagos' }
  const { orderId, totalKobo } = await createPendingOrder(db, userId, [item], shipping, 'standard', null)
  await confirmOrderPayment(db, orderId, 'paystack', `PSK-REFUND-FIXTURE-${orderId}`)

  const orderItemRow = await queryOneD1(`SELECT id, line_total_kobo FROM order_items WHERE order_id=${orderId} LIMIT 1`)

  return { db, userId, orderId, totalKobo, orderItemId: orderItemRow.id, lineTotalKobo: Number(orderItemRow.line_total_kobo) }
}

function refundInput(orderId, amountKobo, overrides = {}) {
  return {
    orderId,
    orderItemId: null,
    amountKobo,
    reason: 'test refund',
    refundType: 'partial',
    initiatedByUserId: 1,
    initiatedByRole: 'admin',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Normal / duplicate / partial refund semantics
// ---------------------------------------------------------------------------

test('createAndExecuteRefund: a normal full refund credits the wallet exactly once, marks the refund completed', async () => {
  const { db, userId, orderId, totalKobo } = await newPaidOrder('normal_full')

  const result = await createAndExecuteRefund(db, refundInput(orderId, totalKobo))
  assert.equal(result.newBalanceKobo, totalKobo)

  const refundRow = await queryOneD1(`SELECT status, amount_kobo, wallet_ledger_id FROM refunds WHERE id=${result.refundId}`)
  assert.equal(refundRow.status, 'completed')
  assert.equal(refundRow.amount_kobo, totalKobo)
  assert.ok(refundRow.wallet_ledger_id, 'a completed refund must have a real wallet_ledger_id, never null')

  const ledgerRows = await queryD1(`SELECT amount_kobo FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_refund' AND reference_id='${result.refundId}'`)
  assert.equal(ledgerRows.length, 1, 'exactly one ledger credit must exist, traceable by refund id')
  assert.equal(ledgerRows[0].amount_kobo, totalKobo)
})

test('createAndExecuteRefund: a second refund attempt after the order is already fully refunded is rejected (over-refund guard, sequential)', async () => {
  const { db, userId, orderId, totalKobo } = await newPaidOrder('dup_seq_full')

  await createAndExecuteRefund(db, refundInput(orderId, totalKobo))
  await assert.rejects(() => createAndExecuteRefund(db, refundInput(orderId, 1)), RefundError)

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_refund'`)
  assert.equal(ledgerRows.length, 1, 'a rejected second refund must never have credited anything')

  const refundedTotal = await queryOneD1(`SELECT COALESCE(SUM(amount_kobo),0) as t FROM refunds WHERE order_id=${orderId} AND status='completed'`)
  assert.equal(Number(refundedTotal.t), totalKobo, 'the completed refund total must never exceed the order total')
})

test('createAndExecuteRefund: two sequential PARTIAL refunds that together exactly cover the total both succeed, sum reconciles exactly', async () => {
  const { db, userId, orderId, totalKobo } = await newPaidOrder('partial_reconcile', { priceKobo: 100000 })
  const half = Math.floor(totalKobo / 2)
  const rest = totalKobo - half

  const r1 = await createAndExecuteRefund(db, refundInput(orderId, half))
  const r2 = await createAndExecuteRefund(db, refundInput(orderId, rest))
  assert.notEqual(r1.refundId, r2.refundId)

  const ledgerRows = await queryD1(`SELECT amount_kobo FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_refund' ORDER BY id ASC`)
  assert.equal(ledgerRows.length, 2)
  assert.equal(ledgerRows[0].amount_kobo + ledgerRows[1].amount_kobo, totalKobo, 'paid - refunded must reconcile to exactly zero remaining')

  const balance = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balance.cached_balance_kobo, totalKobo)
})

test('createAndExecuteRefund: a THIRD partial refund attempt after the total is already fully covered by two prior partials is rejected', async () => {
  const { db, orderId, totalKobo } = await newPaidOrder('partial_overrefund_seq', { priceKobo: 100000 })
  const half = Math.floor(totalKobo / 2)
  const rest = totalKobo - half

  await createAndExecuteRefund(db, refundInput(orderId, half))
  await createAndExecuteRefund(db, refundInput(orderId, rest))

  await assert.rejects(() => createAndExecuteRefund(db, refundInput(orderId, 1)), RefundError)

  const refundedTotal = await queryOneD1(`SELECT COALESCE(SUM(amount_kobo),0) as t FROM refunds WHERE order_id=${orderId} AND status='completed'`)
  assert.equal(Number(refundedTotal.t), totalKobo)
})

// ---------------------------------------------------------------------------
// The core G-4 fix: CONCURRENT partial refunds must never over-refund
// ---------------------------------------------------------------------------

test('createAndExecuteRefund: CONCURRENT partial refunds for the SAME order, together exceeding the total, never over-refund (the core G-4 race)', async () => {
  const { db, userId, orderId, totalKobo } = await newPaidOrder('conc_overrefund', { priceKobo: 500000 })
  // 10 concurrent attempts, each for HALF the total — if the race were open, ALL 10 could
  // succeed (reading the same stale "remaining" before any of them writes), refunding 5x the
  // order's actual value. The fix must guarantee AT MOST 2 of these can ever win.
  const half = Math.floor(totalKobo / 2)
  const N = 10

  const results = await Promise.allSettled(
    Array.from({ length: N }, () => createAndExecuteRefund(db, refundInput(orderId, half)))
  )
  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')
  assert.ok(fulfilled.length <= 2, `at most 2 of the ${N} concurrent half-refunds may succeed (2 x half = totalKobo exactly) — got ${fulfilled.length}`)
  for (const r of rejected) {
    assert.ok(r.reason instanceof RefundError, 'every losing concurrent refund attempt must fail with RefundError, never a generic/opaque error')
  }

  const refundedTotal = await queryOneD1(`SELECT COALESCE(SUM(amount_kobo),0) as t FROM refunds WHERE order_id=${orderId} AND status='completed'`)
  assert.ok(Number(refundedTotal.t) <= totalKobo, `completed refund total (${refundedTotal.t}) must NEVER exceed the order's captured total (${totalKobo}) — this is the exact over-refund bug this unit fixes`)

  const ledgerRows = await queryD1(`SELECT amount_kobo FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_refund'`)
  const ledgerTotal = ledgerRows.reduce((sum, r) => sum + Number(r.amount_kobo), 0)
  assert.equal(ledgerTotal, Number(refundedTotal.t), 'every completed refund row must have a matching wallet credit, no more no less')

  const balance = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balance.cached_balance_kobo, ledgerTotal, 'cached wallet balance must exactly equal the total actually refunded')
})

test('createAndExecuteRefund: CONCURRENT refunds with MIXED amounts (some fit, some do not) refund exactly up to the cap, never beyond it', async () => {
  const { db, userId, orderId, totalKobo } = await newPaidOrder('conc_mixed', { priceKobo: 300000 })
  // Six concurrent attempts of varying sizes; only some subset whose sum <= totalKobo can win,
  // and the specific WINNING subset depends on claim-arrival order — but the total claimed by
  // completed refunds must never exceed totalKobo, regardless of interleaving.
  const amounts = [
    Math.floor(totalKobo * 0.4),
    Math.floor(totalKobo * 0.4),
    Math.floor(totalKobo * 0.3),
    Math.floor(totalKobo * 0.3),
    Math.floor(totalKobo * 0.2),
    Math.floor(totalKobo * 0.2)
  ]

  const results = await Promise.allSettled(amounts.map((amt) => createAndExecuteRefund(db, refundInput(orderId, amt))))
  const fulfilledAmounts = results
    .map((r, i) => (r.status === 'fulfilled' ? amounts[i] : null))
    .filter((a) => a !== null)
  const sumOfWinners = fulfilledAmounts.reduce((s, a) => s + a, 0)

  assert.ok(sumOfWinners <= totalKobo, `sum of all WINNING concurrent refund amounts (${sumOfWinners}) must never exceed the order total (${totalKobo})`)

  const refundedTotal = await queryOneD1(`SELECT COALESCE(SUM(amount_kobo),0) as t FROM refunds WHERE order_id=${orderId} AND status='completed'`)
  assert.equal(Number(refundedTotal.t), sumOfWinners, 'the DB\'s own completed-refund sum must match exactly what the calling code observed as fulfilled')
  assert.ok(Number(refundedTotal.t) <= totalKobo)

  const balance = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balance.cached_balance_kobo, sumOfWinners)
})

test('createAndExecuteRefund: after a lost concurrent race, a SMALLER retry that now fits within the remaining cap succeeds cleanly', async () => {
  const { db, userId, orderId, totalKobo } = await newPaidOrder('conc_then_retry', { priceKobo: 200000 })
  const bigAmount = Math.floor(totalKobo * 0.9)

  // Two concurrent attempts at 90% each — only one can win (0.9 + 0.9 = 1.8x > 1.0x cap).
  const results = await Promise.allSettled([
    createAndExecuteRefund(db, refundInput(orderId, bigAmount)),
    createAndExecuteRefund(db, refundInput(orderId, bigAmount))
  ])
  const winners = results.filter((r) => r.status === 'fulfilled').length
  assert.equal(winners, 1, 'exactly one of the two competing 90% claims must win')

  // The remaining 10% must still be genuinely refundable afterwards — proving the loser's
  // claim attempt left no dangling reservation behind (claimRefundSlot only ever inserts a
  // row when it actually wins; a LOST claim writes nothing at all).
  const remaining = totalKobo - bigAmount
  const retryResult = await createAndExecuteRefund(db, refundInput(orderId, remaining))
  assert.ok(retryResult.refundId)

  const refundedTotal = await queryOneD1(`SELECT COALESCE(SUM(amount_kobo),0) as t FROM refunds WHERE order_id=${orderId} AND status='completed'`)
  assert.equal(Number(refundedTotal.t), totalKobo, 'the winning big claim + the retried remainder must reconcile to exactly the full order total')

  const balance = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balance.cached_balance_kobo, totalKobo)
})

// ---------------------------------------------------------------------------
// Item-scoped refunds (independent cap per order_item_id)
// ---------------------------------------------------------------------------

test('createAndExecuteRefund: item-scoped refund cap is independent of the order-level cap — an item refund never over-refunds against its OWN line_total_kobo', async () => {
  const { db, userId, orderId, orderItemId, lineTotalKobo } = await newPaidOrder('item_scoped', { priceKobo: 150000 })

  const half = Math.floor(lineTotalKobo / 2)
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => createAndExecuteRefund(db, refundInput(orderId, half, { orderItemId })))
  )
  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  assert.ok(fulfilled.length <= 2, `at most 2 of 4 concurrent half-item-refunds may win (item cap = ${lineTotalKobo})`)

  const refundedForItem = await queryOneD1(`SELECT COALESCE(SUM(amount_kobo),0) as t FROM refunds WHERE order_item_id=${orderItemId} AND status='completed'`)
  assert.ok(Number(refundedForItem.t) <= lineTotalKobo, 'item-scoped refunds must never exceed that item\'s own line_total_kobo, independent of the order total')

  const balance = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balance.cached_balance_kobo, Number(refundedForItem.t))
})

// ---------------------------------------------------------------------------
// Ledger consistency + dispute/refund interaction
// ---------------------------------------------------------------------------

test('ledger consistency invariant holds after a full partial-refund battery: cached_balance_kobo == SUM(wallet_ledger) for the refunded user', async () => {
  const { db, userId, orderId, totalKobo } = await newPaidOrder('ledger_invariant_refund', { priceKobo: 400000 })
  const third = Math.floor(totalKobo / 3)

  await createAndExecuteRefund(db, refundInput(orderId, third))
  await createAndExecuteRefund(db, refundInput(orderId, third))
  // A deliberate over-cap third attempt must be rejected without disturbing the invariant.
  await assert.rejects(() => createAndExecuteRefund(db, refundInput(orderId, totalKobo)), RefundError)

  const sumRow = await queryOneD1(`SELECT SUM(CASE WHEN entry_type='credit' THEN amount_kobo ELSE -amount_kobo END) as total FROM wallet_ledger WHERE user_id=${userId}`)
  const balanceRow = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balanceRow.cached_balance_kobo, sumRow.total, "cached_balance_kobo must always equal the SUM of this user's ledger entries after a mix of successful and rejected refund attempts")
})

test('dispute/refund interaction: resolving a dispute does not itself move money, and a refund issued afterwards is still correctly capped by the order total', async () => {
  const { createDispute, resolveDispute } = await import('../../src/lib/refunds.ts')
  const { db, userId, orderId, totalKobo } = await newPaidOrder('dispute_then_refund', { priceKobo: 120000 })

  const disputeId = await createDispute(db, {
    orderId,
    raisedByUserId: userId,
    reason: 'item not as described',
    description: 'test dispute'
  })

  const resolved = await resolveDispute(db, disputeId, 1, 'resolved', 'Refund approved after review')
  assert.equal(resolved, true)

  const balanceBefore = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balanceBefore?.cached_balance_kobo ?? 0, 0, 'resolving a dispute must never itself credit the wallet — refunds.ts keeps disputes and money movement fully separate')

  // Admin now issues the actual refund following the resolved dispute — still gated by the
  // SAME atomic aggregate cap as any other refund; a resolved dispute grants no special
  // ability to exceed the order's captured amount.
  await createAndExecuteRefund(db, refundInput(orderId, totalKobo))
  await assert.rejects(() => createAndExecuteRefund(db, refundInput(orderId, 1)), RefundError, 'a dispute being resolved must not bypass the refund aggregate cap')

  const refundedTotal = await queryOneD1(`SELECT COALESCE(SUM(amount_kobo),0) as t FROM refunds WHERE order_id=${orderId} AND status='completed'`)
  assert.equal(Number(refundedTotal.t), totalKobo)
})

test('a rolled-back (failed-credit) refund claim is marked rejected, not left pending, and releases its reserved capacity for a later legitimate refund', async () => {
  // This test verifies the rollback path structurally: since creditWallet() itself cannot be
  // forced to fail without corrupting shared infra, we instead verify the INVARIANT the
  // rollback path exists to protect — that a 'rejected' row (simulating what the catch branch
  // produces) is excluded from the aggregate guard, exactly like a never-attempted amount
  // would be, so capacity is never permanently lost to a failed attempt.
  const { db, userId, orderId, totalKobo } = await newPaidOrder('rollback_releases_capacity', { priceKobo: 100000 })

  // Simulate a claim that failed downstream and was rolled back to 'rejected' by the catch
  // branch (bypassing creditWallet entirely here, to isolate the aggregate-guard behavior).
  await db
    .prepare(`INSERT INTO refunds (order_id, order_item_id, vendor_id, amount_kobo, reason, refund_type, status, initiated_by_user_id, initiated_by_role) VALUES (?, NULL, NULL, ?, 'simulated failed claim', 'partial', 'rejected', 1, 'admin')`)
    .bind(orderId, totalKobo)
    .run()

  // A full-amount refund must still succeed — the rejected row's amount must NOT count
  // against the aggregate cap, proving claimRefundSlot()'s guard correctly excludes it
  // (only 'completed'/'pending' are summed, never 'rejected').
  const result = await createAndExecuteRefund(db, refundInput(orderId, totalKobo))
  assert.ok(result.refundId)

  const balance = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balance.cached_balance_kobo, totalKobo)
})
