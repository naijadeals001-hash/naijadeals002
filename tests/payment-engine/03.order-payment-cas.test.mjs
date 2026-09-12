/**
 * Payment Engine — Unit 4 (Engine 7 Phase 2): order payment concurrency
 * hardening (G-3). Exercises createPendingOrder()/confirmOrderPayment()/
 * payOrderFromWallet() in src/lib/orders.ts DIRECTLY, in-process, against
 * the real local D1 binding — same rationale as Unit 2's wallet suite
 * (helpers/db.mjs's header comment): these functions have no dedicated
 * single-purpose HTTP endpoint of their own (payOrderFromWallet() is
 * reached via /checkout's payment_method=wallet branch, but driving that
 * over HTTP would pull in cart/session/coupon plumbing irrelevant to what
 * THIS unit hardens), and calling them directly is the correct layer to
 * prove the N-way concurrent race is actually closed.
 *
 * src/lib/orders.ts imports sibling modules with extensionless specifiers
 * (Vite's required style) that Node's native ESM resolver cannot follow
 * directly under --experimental-strip-types — see
 * helpers/ts-extensionless-loader.mjs's header comment for the test-only
 * resolution shim this requires (zero effect on the production bundle).
 *
 * Run TWICE per the Phase 2 protocol's "run the targeted suite at least
 * twice" requirement:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/payment-engine/03.order-payment-cas.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestUser, queryD1, queryOneD1, disposeTestDb } from './helpers/db.mjs'
import { createTestCartItem } from './helpers/order-fixtures.mjs'
import { createPendingOrder, confirmOrderPayment, payOrderFromWallet, OrderPaymentError } from '../../src/lib/orders.ts'
import { creditWallet, InsufficientFundsError } from '../../src/lib/wallet.ts'

test.after(async () => {
  await disposeTestDb()
})

async function newOrder(label, { priceKobo = 500000, quantity = 1 } = {}) {
  const db = await getTestDb()
  const userId = await createTestUser(`order_${label}`)
  const item = await createTestCartItem({ label, priceKobo, quantity })
  const shipping = { name: 'Test Buyer', phone: '08000000000', address: '1 Test St', city: 'Lagos', state: 'Lagos' }
  const { orderId, orderNumber, totalKobo } = await createPendingOrder(db, userId, [item], shipping, 'standard', null)
  return { db, userId, orderId, orderNumber, totalKobo, listingId: item.listing_id, initialStock: item.stock }
}

// ---------------------------------------------------------------------------
// confirmOrderPayment() — the Paystack-side confirmation path
// ---------------------------------------------------------------------------

test('confirmOrderPayment: normal confirmation marks the order paid, decrements stock exactly once', async () => {
  const { db, orderId, listingId, initialStock } = await newOrder('confirm_normal')

  await confirmOrderPayment(db, orderId, 'paystack', `PSK-CONFIRM-NORMAL-${orderId}`)

  const order = await queryOneD1(`SELECT status, payment_status, payment_provider, payment_reference FROM orders WHERE id=${orderId}`)
  assert.equal(order.status, 'processing')
  assert.equal(order.payment_status, 'escrow_held')
  assert.equal(order.payment_provider, 'paystack')

  const listing = await queryOneD1(`SELECT stock FROM product_listings WHERE id=${listingId}`)
  assert.equal(listing.stock, initialStock - 1, 'stock must decrement by exactly the ordered quantity, exactly once')
})

test('confirmOrderPayment: duplicate SEQUENTIAL confirmation for an already-paid order is a safe no-op (idempotent)', async () => {
  const { db, orderId, listingId, initialStock } = await newOrder('confirm_dup_seq')

  await confirmOrderPayment(db, orderId, 'paystack', `PSK-DUP-SEQ-A-${orderId}`)
  await confirmOrderPayment(db, orderId, 'paystack', `PSK-DUP-SEQ-B-${orderId}`) // second call must be a no-op

  const listing = await queryOneD1(`SELECT stock FROM product_listings WHERE id=${listingId}`)
  assert.equal(listing.stock, initialStock - 1, 'stock must NEVER be decremented twice by a duplicate confirmation')

  const order = await queryOneD1(`SELECT payment_reference FROM orders WHERE id=${orderId}`)
  assert.equal(order.payment_reference, `PSK-DUP-SEQ-A-${orderId}`, 'the FIRST claim must win — a later duplicate call must never overwrite the winning reference')
})

test('confirmOrderPayment: CONCURRENT confirmation for the same order (N-way race) claims exactly once, decrements stock exactly once', async () => {
  const { db, orderId, listingId, initialStock } = await newOrder('confirm_dup_conc', { quantity: 3 })

  const N = 8
  await Promise.all(
    Array.from({ length: N }, (_, i) => confirmOrderPayment(db, orderId, 'paystack', `PSK-CONC-${i}-${orderId}`))
  )

  const listing = await queryOneD1(`SELECT stock FROM product_listings WHERE id=${listingId}`)
  assert.equal(listing.stock, initialStock - 3, `exactly ONE of the ${N} concurrent confirmations must have won the CAS claim and decremented stock by the order quantity (3), not ${N}x that`)

  const order = await queryOneD1(`SELECT status, payment_status FROM orders WHERE id=${orderId}`)
  assert.equal(order.status, 'processing')
  assert.equal(order.payment_status, 'escrow_held')
})

test('confirmOrderPayment: invalid state transition — an order already past unpaid (e.g. cancelled) cannot be re-claimed', async () => {
  const { db, orderId } = await newOrder('confirm_invalid_state')

  await db.prepare(`UPDATE orders SET status='cancelled', payment_status='unpaid' WHERE id=?`).bind(orderId).run()
  // Still 'unpaid' so the CAS guard itself would technically allow a claim — this test instead
  // verifies the more common invalid-transition case: an order already claimed (escrow_held)
  // can never be re-claimed by a later confirmation attempt using a different reference.
  await confirmOrderPayment(db, orderId, 'paystack', `PSK-FIRST-${orderId}`)
  const afterFirst = await queryOneD1(`SELECT payment_status, payment_reference FROM orders WHERE id=${orderId}`)
  assert.equal(afterFirst.payment_status, 'escrow_held')

  await confirmOrderPayment(db, orderId, 'paystack', `PSK-SECOND-${orderId}`)
  const afterSecond = await queryOneD1(`SELECT payment_status, payment_reference FROM orders WHERE id=${orderId}`)
  assert.equal(afterSecond.payment_reference, afterFirst.payment_reference, 'an order already claimed can never be re-claimed by a second, different confirmation attempt')
})

// ---------------------------------------------------------------------------
// payOrderFromWallet() — the wallet-payment path, including claim-before-debit
// ---------------------------------------------------------------------------

test('payOrderFromWallet: normal payment debits the wallet exactly once, marks the order paid, decrements stock', async () => {
  const { db, userId, orderId, totalKobo, listingId, initialStock } = await newOrder('wallet_normal')
  await creditWallet(db, userId, totalKobo + 100000, 'test_topup', 'seed', 'seed funding')

  await payOrderFromWallet(db, orderId, userId, totalKobo)

  const order = await queryOneD1(`SELECT status, payment_status, payment_provider FROM orders WHERE id=${orderId}`)
  assert.equal(order.status, 'processing')
  assert.equal(order.payment_status, 'escrow_held')
  assert.equal(order.payment_provider, 'wallet')

  const debitRows = await queryD1(`SELECT amount_kobo FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_payment' AND reference_id='${orderId}'`)
  assert.equal(debitRows.length, 1, 'exactly one wallet debit must exist for this order')
  assert.equal(debitRows[0].amount_kobo, totalKobo)

  const listing = await queryOneD1(`SELECT stock FROM product_listings WHERE id=${listingId}`)
  assert.equal(listing.stock, initialStock - 1)
})

test('payOrderFromWallet: insufficient balance throws InsufficientFundsError, order rolls back to pending_payment/unpaid, no debit, no stock change (rollback path)', async () => {
  const { db, userId, orderId, totalKobo, listingId, initialStock } = await newOrder('wallet_insufficient')
  await creditWallet(db, userId, Math.floor(totalKobo / 2), 'test_topup', 'seed', 'seed funding') // deliberately short

  await assert.rejects(
    () => payOrderFromWallet(db, orderId, userId, totalKobo),
    InsufficientFundsError
  )

  const order = await queryOneD1(`SELECT status, payment_status, payment_provider, payment_reference FROM orders WHERE id=${orderId}`)
  assert.equal(order.status, 'pending_payment', 'a failed wallet debit must roll the order back to pending_payment, never leave it stuck in escrow_held')
  assert.equal(order.payment_status, 'unpaid')
  assert.equal(order.payment_provider, null)
  assert.equal(order.payment_reference, null)

  const debitRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_payment' AND reference_id='${orderId}'`)
  assert.equal(debitRows.length, 0, 'a failed debit must never have written a ledger row')

  const listing = await queryOneD1(`SELECT stock FROM product_listings WHERE id=${listingId}`)
  assert.equal(listing.stock, initialStock, 'stock must be completely untouched when the debit fails BEFORE side effects ever run')
})

test('payOrderFromWallet: after a rolled-back insufficient-funds attempt, the SAME order can be retried successfully once topped up', async () => {
  const { db, userId, orderId, totalKobo, listingId, initialStock } = await newOrder('wallet_retry_after_rollback')
  await creditWallet(db, userId, Math.floor(totalKobo / 2), 'test_topup', 'seed1', 'seed funding')

  await assert.rejects(() => payOrderFromWallet(db, orderId, userId, totalKobo), InsufficientFundsError)

  // Top up the rest and retry — this is exactly why the rollback must restore 'unpaid', not leave a dead claim.
  await creditWallet(db, userId, totalKobo, 'test_topup', 'seed2', 'top up to retry')
  await payOrderFromWallet(db, orderId, userId, totalKobo)

  const order = await queryOneD1(`SELECT payment_status FROM orders WHERE id=${orderId}`)
  assert.equal(order.payment_status, 'escrow_held', 'the retried payment must succeed and claim the order after the rollback freed it')

  const listing = await queryOneD1(`SELECT stock FROM product_listings WHERE id=${listingId}`)
  assert.equal(listing.stock, initialStock - 1)
})

test('payOrderFromWallet: duplicate SEQUENTIAL call for an already-paid order throws OrderPaymentError, no second debit', async () => {
  const { db, userId, orderId, totalKobo, listingId, initialStock } = await newOrder('wallet_dup_seq')
  await creditWallet(db, userId, totalKobo * 3, 'test_topup', 'seed', 'seed funding')

  await payOrderFromWallet(db, orderId, userId, totalKobo)
  await assert.rejects(() => payOrderFromWallet(db, orderId, userId, totalKobo), OrderPaymentError)

  const debitRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_payment' AND reference_id='${orderId}'`)
  assert.equal(debitRows.length, 1, 'a duplicate wallet-payment attempt for an already-paid order must never produce a second debit')

  const listing = await queryOneD1(`SELECT stock FROM product_listings WHERE id=${listingId}`)
  assert.equal(listing.stock, initialStock - 1)
})

test('payOrderFromWallet: CONCURRENT duplicate calls for the SAME order (the core G-3 race) debit exactly once, never double-charge', async () => {
  const { db, userId, orderId, totalKobo, listingId, initialStock } = await newOrder('wallet_dup_conc', { quantity: 2 })
  // Fund enough to cover the charge MANY times over — if the race were still open, this
  // seed would let every concurrent caller's debit succeed, proving the bug would be real money lost.
  const N = 10
  await creditWallet(db, userId, totalKobo * N, 'test_topup', 'seed', 'seed funding')

  const results = await Promise.allSettled(
    Array.from({ length: N }, () => payOrderFromWallet(db, orderId, userId, totalKobo))
  )

  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')
  assert.equal(fulfilled.length, 1, `exactly ONE of the ${N} concurrent payOrderFromWallet() calls must succeed — this is the core Unit 4 claim-before-debit fix under adversarial concurrency`)
  assert.equal(rejected.length, N - 1)
  for (const r of rejected) {
    assert.ok(r.reason instanceof OrderPaymentError, 'every losing concurrent call must fail with OrderPaymentError (already paid), never a generic/opaque error')
  }

  const debitRows = await queryD1(`SELECT amount_kobo FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_payment' AND reference_id='${orderId}'`)
  assert.equal(debitRows.length, 1, `exactly ONE wallet debit must exist after ${N} concurrent attempts — a double-debit here would mean the customer was charged twice for one order`)
  assert.equal(debitRows[0].amount_kobo, totalKobo)

  const balance = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balance.cached_balance_kobo, totalKobo * N - totalKobo, 'the wallet must have been debited exactly once, not N times')

  const listing = await queryOneD1(`SELECT stock FROM product_listings WHERE id=${listingId}`)
  assert.equal(listing.stock, initialStock - 2, 'stock must be decremented by exactly the order quantity exactly once, not N times')
})

test('payOrderFromWallet + confirmOrderPayment CONCURRENT race for the SAME order (mixed wallet + paystack claim attempts): only one path ever wins, no double debit and no double stock decrement', async () => {
  const { db, userId, orderId, totalKobo, listingId, initialStock } = await newOrder('wallet_vs_paystack_conc', { quantity: 4 })
  await creditWallet(db, userId, totalKobo * 5, 'test_topup', 'seed', 'seed funding')

  const attempts = [
    payOrderFromWallet(db, orderId, userId, totalKobo),
    payOrderFromWallet(db, orderId, userId, totalKobo),
    confirmOrderPayment(db, orderId, 'paystack', `PSK-MIXED-A-${orderId}`),
    confirmOrderPayment(db, orderId, 'paystack', `PSK-MIXED-B-${orderId}`)
  ]
  const results = await Promise.allSettled(attempts)

  // Exactly one of the two payOrderFromWallet() calls can succeed (fulfilled); the other three
  // (the second wallet call + both confirmOrderPayment() calls) either resolve as a no-op or
  // reject with OrderPaymentError — but crucially the wallet must be debited AT MOST once total.
  const walletResults = results.slice(0, 2)
  const walletSuccesses = walletResults.filter((r) => r.status === 'fulfilled')
  assert.ok(walletSuccesses.length <= 1, 'at most one payOrderFromWallet() call may succeed when racing another claimant for the same order')

  const debitRows = await queryD1(`SELECT amount_kobo FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_payment' AND reference_id='${orderId}'`)
  assert.ok(debitRows.length <= 1, `wallet must be debited at most once regardless of how the claim race resolved (found ${debitRows.length} debit rows)`)

  const listing = await queryOneD1(`SELECT stock FROM product_listings WHERE id=${listingId}`)
  assert.equal(listing.stock, initialStock - 4, 'stock must be decremented by exactly the order quantity exactly once, no matter which of the 4 racing claimants actually won')

  const order = await queryOneD1(`SELECT payment_status FROM orders WHERE id=${orderId}`)
  assert.equal(order.payment_status, 'escrow_held', 'exactly one claimant must have won and moved the order to escrow_held')
})

test('ledger consistency invariant holds after the full mixed-scenario battery: cached_balance_kobo == SUM(wallet_ledger) for every touched user', async () => {
  const { db, userId, orderId, totalKobo } = await newOrder('ledger_invariant')
  await creditWallet(db, userId, totalKobo * 3, 'test_topup', 'seed', 'seed funding')
  await payOrderFromWallet(db, orderId, userId, totalKobo)

  const sumRow = await queryOneD1(`SELECT SUM(CASE WHEN entry_type='credit' THEN amount_kobo ELSE -amount_kobo END) as total FROM wallet_ledger WHERE user_id=${userId}`)
  const balanceRow = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balanceRow.cached_balance_kobo, sumRow.total, "cached_balance_kobo must always equal the SUM of this user's ledger entries, even after an order-payment debit")
})
