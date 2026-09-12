/**
 * Payment Engine — Engine 7 Phase 3: variable-weight settlement concurrency
 * hardening (G-5). Exercises settleVariableWeightItem()/
 * confirmAdditionalChargePayment() in src/lib/order-settlement.ts DIRECTLY,
 * in-process, against the real local D1 binding — same rationale as Units
 * 2/4/5's suites (helpers/db.mjs's header comment): these functions have
 * only ONE thin HTTP wrapper (POST /api/seller/orders/items/:id/settle for
 * the former; ZERO route for the latter), and calling the library function
 * directly with genuine Promise.all/allSettled concurrency is the correct
 * layer to prove the N-way race is actually closed at the database
 * boundary, not just "usually doesn't happen because of request timing".
 *
 * src/lib/order-settlement.ts imports sibling modules with extensionless
 * specifiers (Vite's required style) that Node's native ESM resolver
 * cannot follow directly under --experimental-strip-types — see
 * helpers/ts-extensionless-loader.mjs's header comment for the test-only
 * resolution shim this requires (zero effect on the production bundle).
 *
 * Run TWICE per the established Phase 2/3 protocol's "run the targeted
 * suite at least twice" requirement:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs tests/payment-engine/05.variable-weight-settlement-cas.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestUser, queryD1, queryOneD1, disposeTestDb } from './helpers/db.mjs'
import { createTestCartItem } from './helpers/order-fixtures.mjs'
import { createPendingOrder, confirmOrderPayment } from '../../src/lib/orders.ts'
import { settleVariableWeightItem, confirmAdditionalChargePayment, SettlementError } from '../../src/lib/order-settlement.ts'
import { creditWallet, getWalletBalance } from '../../src/lib/wallet.ts'

test.after(async () => {
  await disposeTestDb()
})

/**
 * Creates a fully-paid order with a SINGLE order_item, then manually marks
 * that item as fulfilled with a given fulfilledQuantity (bypassing
 * transitionOrderItemStatus's full state-machine plumbing, which is out of
 * this unit's scope — settleVariableWeightItem() only cares about
 * final_price_kobo/fulfilled_quantity/settlement_status, all of which are
 * set directly here exactly as transitionOrderItemStatus would have left
 * them). unitPriceKobo * quantity IS line_total_kobo (the captured amount);
 * finalPriceKobo is set independently so tests can freely choose
 * lower/higher/equal scenarios.
 */
async function newFulfilledItem(label, { unitPriceKobo = 100000, quantity = 1, fulfilledQuantity, finalPriceKobo, walletTopupKobo = 0 } = {}) {
  const db = await getTestDb()
  const userId = await createTestUser(`settle_${label}`)
  const item = await createTestCartItem({ label, priceKobo: unitPriceKobo, quantity })
  const shipping = { name: 'Test Buyer', phone: '08000000000', address: '1 Test St', city: 'Lagos', state: 'Lagos' }
  const { orderId } = await createPendingOrder(db, userId, [item], shipping, 'standard', null)
  await confirmOrderPayment(db, orderId, 'paystack', `PSK-SETTLE-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)

  const orderItemRow = await db.prepare('SELECT id, line_total_kobo FROM order_items WHERE order_id = ?').bind(orderId).first()
  const orderItemId = orderItemRow.id
  const lineTotalKobo = Number(orderItemRow.line_total_kobo)

  await db
    .prepare(`UPDATE order_items SET fulfilled_quantity = ?, final_price_kobo = ?, fulfilled_by_user_id = ?, fulfilled_at = datetime('now') WHERE id = ?`)
    .bind(fulfilledQuantity, finalPriceKobo, userId, orderItemId)
    .run()

  if (walletTopupKobo > 0) {
    await creditWallet(db, userId, walletTopupKobo, 'topup', `settle-fixture-${label}`, 'Test wallet top-up for additional-charge scenarios')
  }

  return { db, userId, orderId, orderItemId, lineTotalKobo }
}

// ---------------------------------------------------------------------------
// 1-7: Sequential correctness (baseline behavior, no concurrency yet)
// ---------------------------------------------------------------------------

test('settleVariableWeightItem: normal settlement — final LOWER than captured issues a refund of exactly the difference', async () => {
  const { db, userId, orderItemId, lineTotalKobo } = await newFulfilledItem('normal_refund', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 0.8, finalPriceKobo: 80000,
  })

  const result = await settleVariableWeightItem(db, orderItemId, userId)
  assert.equal(result.outcome, 'refund_issued')
  assert.equal(result.differenceKobo, 80000 - lineTotalKobo)

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, lineTotalKobo - 80000, 'wallet must be credited exactly the shortfall amount')

  const item = await queryOneD1(`SELECT settlement_status FROM order_items WHERE id=${orderItemId}`)
  assert.equal(item.settlement_status, 'refund_issued')
})

test('settleVariableWeightItem: correct calculated settlement — final EQUAL to captured is a no_adjustment no-op with no financial side effect', async () => {
  // quantity=1, so lineTotalKobo === unitPriceKobo — finalPriceKobo is set
  // to that same literal value to exercise the exact-match (differenceKobo
  // === 0) branch.
  const { db, userId, orderItemId, lineTotalKobo } = await newFulfilledItem('exact_match', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 1, finalPriceKobo: 100000,
  })

  const result = await settleVariableWeightItem(db, orderItemId, userId)
  assert.equal(result.outcome, 'no_adjustment')
  assert.equal(result.differenceKobo, 0)

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, 0, 'no wallet credit should occur when final equals captured')

  const item = await queryOneD1(`SELECT settlement_status FROM order_items WHERE id=${orderItemId}`)
  assert.equal(item.settlement_status, 'settled')
})

test('settleVariableWeightItem: final HIGHER than captured creates exactly one pending additional charge, never auto-debits', async () => {
  const { db, userId, orderId, orderItemId, lineTotalKobo } = await newFulfilledItem('additional_charge', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 1.2, finalPriceKobo: 120000,
  })

  const result = await settleVariableWeightItem(db, orderItemId, userId)
  assert.equal(result.outcome, 'additional_charge_created')
  assert.equal(result.differenceKobo, 120000 - lineTotalKobo)

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, 0, 'higher-than-captured settlement must NEVER auto-debit the customer')

  const charges = await queryD1(`SELECT * FROM order_additional_charges WHERE order_item_id=${orderItemId}`)
  assert.equal(charges.length, 1, 'exactly one additional-charge row must be created')
  assert.equal(Number(charges[0].amount_kobo), 120000 - lineTotalKobo)
  assert.equal(charges[0].status, 'pending_payment')

  const item = await queryOneD1(`SELECT settlement_status FROM order_items WHERE id=${orderItemId}`)
  assert.equal(item.settlement_status, 'additional_payment_pending')
})

test('settleVariableWeightItem: sequential duplicate settlement on an already-settled item is a safe already_settled no-op, no double refund', async () => {
  const { db, userId, orderItemId } = await newFulfilledItem('dup_seq', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 0.8, finalPriceKobo: 80000,
  })

  const first = await settleVariableWeightItem(db, orderItemId, userId)
  assert.equal(first.outcome, 'refund_issued')
  const balanceAfterFirst = await getWalletBalance(db, userId)

  const second = await settleVariableWeightItem(db, orderItemId, userId)
  assert.equal(second.outcome, 'already_settled')
  assert.equal(second.differenceKobo, 0)

  const balanceAfterSecond = await getWalletBalance(db, userId)
  assert.equal(balanceAfterSecond, balanceAfterFirst, 'a duplicate sequential settlement call must NEVER issue a second refund')

  const refunds = await queryD1(`SELECT * FROM refunds WHERE order_item_id=${orderItemId}`)
  assert.equal(refunds.length, 1, 'exactly one refund row must exist after two sequential calls')
})

test('settleVariableWeightItem: already-settled item (settlement_status pre-set) is rejected as already_settled without recomputing anything', async () => {
  const { db, userId, orderItemId } = await newFulfilledItem('pre_settled', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 0.8, finalPriceKobo: 80000,
  })
  await db.prepare(`UPDATE order_items SET settlement_status = 'settled' WHERE id = ?`).bind(orderItemId).run()

  const result = await settleVariableWeightItem(db, orderItemId, userId)
  assert.equal(result.outcome, 'already_settled')

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, 0, 'no refund should be issued for an item settlement_status already marks as settled')
})

test('settleVariableWeightItem: invalid settlement attempt — item not yet fulfilled (fulfilled_quantity/final_price_kobo NULL) throws SettlementError', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('settle_not_fulfilled')
  const item = await createTestCartItem({ label: 'not_fulfilled', priceKobo: 100000, quantity: 1 })
  const shipping = { name: 'Test Buyer', phone: '08000000000', address: '1 Test St', city: 'Lagos', state: 'Lagos' }
  const { orderId } = await createPendingOrder(db, userId, [item], shipping, 'standard', null)
  await confirmOrderPayment(db, orderId, 'paystack', `PSK-NOTFUL-${Date.now()}`)
  const orderItemRow = await db.prepare('SELECT id FROM order_items WHERE order_id = ?').bind(orderId).first()

  await assert.rejects(
    () => settleVariableWeightItem(db, orderItemRow.id, userId),
    SettlementError,
    'settling an item with no fulfilled_quantity/final_price_kobo must throw, never silently proceed'
  )
})

test('settleVariableWeightItem: a legitimately-failed refund attempt (over-cap RefundError) rolls the claim back to \'none\', not stuck \'settling\', and a subsequent legitimate call can still be evaluated', async () => {
  // Force a RefundError by pre-claiming the ENTIRE captured amount via a
  // manual refund row BEFORE settlement runs, so createAndExecuteRefund's
  // own G-4 aggregate guard rejects settleVariableWeightItem's attempt —
  // this exercises the rollback-on-failure path for a REAL failure mode,
  // not a synthetic one.
  const { db, userId, orderId, orderItemId, lineTotalKobo } = await newFulfilledItem('rollback_on_fail', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 0.8, finalPriceKobo: 80000,
  })
  await db
    .prepare(
      `INSERT INTO refunds (order_id, order_item_id, vendor_id, amount_kobo, reason, refund_type, status, initiated_by_user_id, initiated_by_role)
       SELECT id, ?, vendor_id, ?, 'pre-claim to force over-cap', 'quantity', 'completed', ?, 'admin' FROM order_items WHERE id = ?`
    )
    .bind(orderItemId, lineTotalKobo, userId, orderItemId)
    .run()

  await assert.rejects(() => settleVariableWeightItem(db, orderItemId, userId), SettlementError)

  const item = await queryOneD1(`SELECT settlement_status FROM order_items WHERE id=${orderItemId}`)
  assert.equal(item.settlement_status, 'none', 'a failed settlement attempt must roll back to \'none\', never left stuck \'settling\'')

  // Retry after the legitimate failure: still fails (the pre-claimed refund
  // still occupies the entire cap), but critically it is evaluated fresh —
  // proving the item was NOT left permanently stuck.
  await assert.rejects(() => settleVariableWeightItem(db, orderItemId, userId), SettlementError)
  const itemAfterRetry = await queryOneD1(`SELECT settlement_status FROM order_items WHERE id=${orderItemId}`)
  assert.equal(itemAfterRetry.settlement_status, 'none', 'a retried-and-still-failing attempt must also roll back cleanly, not corrupt state')
})

// ---------------------------------------------------------------------------
// 8-13: CONCURRENCY — the core G-5 proof
// ---------------------------------------------------------------------------

test('settleVariableWeightItem: CONCURRENT duplicate settlement for the SAME item (2-way race) — exactly ONE call wins, the other is already_settled, exactly one refund/credit ever happens', async () => {
  const { db, userId, orderItemId, lineTotalKobo } = await newFulfilledItem('concurrent_2way', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 0.8, finalPriceKobo: 80000,
  })

  const results = await Promise.allSettled([
    settleVariableWeightItem(db, orderItemId, userId),
    settleVariableWeightItem(db, orderItemId, userId),
  ])

  const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  const winners = fulfilled.filter((r) => r.outcome === 'refund_issued')
  const losers = fulfilled.filter((r) => r.outcome === 'already_settled')
  assert.equal(winners.length, 1, 'exactly one concurrent call must win and issue the refund')
  assert.equal(losers.length, 1, 'exactly one concurrent call must lose and see already_settled')

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, lineTotalKobo - 80000, 'wallet must be credited EXACTLY ONCE despite two concurrent settlement attempts')

  const refunds = await queryD1(`SELECT * FROM refunds WHERE order_item_id=${orderItemId}`)
  assert.equal(refunds.length, 1, 'exactly one refund row must exist — the database-level claim, not timing, must be what prevented the second')
})

test('settleVariableWeightItem: CONCURRENT 4-way duplicate settlement race — exactly one winner, three already_settled, no over-refund', async () => {
  const { db, userId, orderItemId, lineTotalKobo } = await newFulfilledItem('concurrent_4way', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 0.8, finalPriceKobo: 80000,
  })

  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => settleVariableWeightItem(db, orderItemId, userId))
  )
  const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  assert.equal(fulfilled.length, 4, 'every concurrent call must resolve cleanly (no unhandled crashes) even under a 4-way race')
  const winners = fulfilled.filter((r) => r.outcome === 'refund_issued')
  const losers = fulfilled.filter((r) => r.outcome === 'already_settled')
  assert.equal(winners.length, 1, '4-way race: exactly one winner')
  assert.equal(losers.length, 3, '4-way race: exactly three losers')

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, lineTotalKobo - 80000, 'wallet credited exactly once under a 4-way concurrent race')
})

test('settleVariableWeightItem: CONCURRENT 8-way duplicate settlement race — exactly one winner, no over-refund, ledger stays consistent', async () => {
  const { db, userId, orderItemId, lineTotalKobo } = await newFulfilledItem('concurrent_8way', {
    unitPriceKobo: 200000, quantity: 1, fulfilledQuantity: 1.5, finalPriceKobo: 150000,
  })

  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => settleVariableWeightItem(db, orderItemId, userId))
  )
  const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  assert.equal(fulfilled.length, 8, 'all 8 concurrent calls must resolve without throwing an unhandled error')
  const winners = fulfilled.filter((r) => r.outcome === 'refund_issued')
  assert.equal(winners.length, 1, '8-way race: exactly one winner, no matter how many concurrent callers race for the same item')

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, lineTotalKobo - 150000, 'wallet credited exactly once under an 8-way concurrent race')

  const ledgerSum = await queryOneD1(
    `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_kobo ELSE -amount_kobo END),0) as net FROM wallet_ledger WHERE user_id=${userId}`
  )
  assert.equal(Number(ledgerSum.net), balance, 'ledger consistency invariant: SUM(wallet_ledger) must equal cached_balance_kobo after the 8-way race')
})

test('settleVariableWeightItem: CONCURRENT race on the additional-charge (higher-than-captured) branch creates exactly ONE charge row, never a duplicate customer-owed charge', async () => {
  const { db, userId, orderItemId, lineTotalKobo } = await newFulfilledItem('concurrent_charge_race', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 1.3, finalPriceKobo: 130000,
  })

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => settleVariableWeightItem(db, orderItemId, userId))
  )
  const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  const winners = fulfilled.filter((r) => r.outcome === 'additional_charge_created')
  const losers = fulfilled.filter((r) => r.outcome === 'already_settled')
  assert.equal(winners.length, 1, '5-way race on the additional-charge branch: exactly one winner must create the charge')
  assert.equal(losers.length, 4, '5-way race: the other four must see already_settled')

  const charges = await queryD1(`SELECT * FROM order_additional_charges WHERE order_item_id=${orderItemId}`)
  assert.equal(charges.length, 1, 'CRITICAL: exactly one additional-charge row must exist — this is the double-charge risk G-5 exists to close')
  assert.equal(Number(charges[0].amount_kobo), 130000 - lineTotalKobo)
})

test('settleVariableWeightItem: CONCURRENT no-adjustment (exact match) race never double-transitions settlement_status past \'settled\'', async () => {
  // quantity=1, so lineTotalKobo === unitPriceKobo (100000) — set directly.
  const { db, userId, orderItemId } = await newFulfilledItem('concurrent_no_adjust', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 1, finalPriceKobo: 100000,
  })

  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => settleVariableWeightItem(db, orderItemId, userId))
  )
  const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  const winners = fulfilled.filter((r) => r.outcome === 'no_adjustment')
  const losers = fulfilled.filter((r) => r.outcome === 'already_settled')
  assert.equal(winners.length, 1)
  assert.equal(losers.length, 3)

  const item = await queryOneD1(`SELECT settlement_status FROM order_items WHERE id=${orderItemId}`)
  assert.equal(item.settlement_status, 'settled')
  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, 0, 'no financial side effect should ever occur for a no-adjustment settlement, even under a race')
})

// ---------------------------------------------------------------------------
// 14-20: confirmAdditionalChargePayment() concurrency + final-state / ledger checks
// ---------------------------------------------------------------------------

test('confirmAdditionalChargePayment: normal payment debits exactly the charge amount and marks the item additional_payment_paid', async () => {
  const { db, userId, orderId, orderItemId } = await newFulfilledItem('charge_pay_normal', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 1.2, finalPriceKobo: 120000, walletTopupKobo: 200000,
  })
  await settleVariableWeightItem(db, orderItemId, userId)
  const charge = await queryOneD1(`SELECT id, amount_kobo FROM order_additional_charges WHERE order_item_id=${orderItemId}`)

  const balanceBefore = await getWalletBalance(db, userId)
  const result = await confirmAdditionalChargePayment(db, userId, charge.id)
  assert.equal(result.newBalanceKobo, balanceBefore - Number(charge.amount_kobo))

  const chargeRow = await queryOneD1(`SELECT status FROM order_additional_charges WHERE id=${charge.id}`)
  assert.equal(chargeRow.status, 'paid')
  const item = await queryOneD1(`SELECT settlement_status FROM order_items WHERE id=${orderItemId}`)
  assert.equal(item.settlement_status, 'additional_payment_paid')
})

test('confirmAdditionalChargePayment: CONCURRENT duplicate payment attempts for the SAME charge — exactly ONE debit ever happens', async () => {
  const { db, userId, orderId, orderItemId } = await newFulfilledItem('charge_pay_concurrent', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 1.4, finalPriceKobo: 140000, walletTopupKobo: 500000,
  })
  await settleVariableWeightItem(db, orderItemId, userId)
  const charge = await queryOneD1(`SELECT id, amount_kobo FROM order_additional_charges WHERE order_item_id=${orderItemId}`)
  const balanceBefore = await getWalletBalance(db, userId)

  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => confirmAdditionalChargePayment(db, userId, charge.id))
  )
  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')
  assert.equal(fulfilled.length, 1, '6-way concurrent payment race for the same charge: exactly one debit must succeed')
  assert.equal(rejected.length, 5, 'the other five must be rejected as already-paid, never silently double-debit')

  const balanceAfter = await getWalletBalance(db, userId)
  assert.equal(balanceAfter, balanceBefore - Number(charge.amount_kobo), 'wallet debited EXACTLY ONCE despite a 6-way concurrent payment race')

  const debitLedgerRows = await queryD1(
    `SELECT * FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_additional_charge' AND reference_id='${charge.id}'`
  )
  assert.equal(debitLedgerRows.length, 1, 'exactly one ledger debit row must exist for this charge')
})

test('confirmAdditionalChargePayment: insufficient funds fails safely, rolls the claim back to pending_payment, and a later legitimate retry (after top-up) succeeds', async () => {
  const { db, userId, orderId, orderItemId } = await newFulfilledItem('charge_pay_insufficient', {
    unitPriceKobo: 100000, quantity: 1, fulfilledQuantity: 1.5, finalPriceKobo: 150000, walletTopupKobo: 0,
  })
  await settleVariableWeightItem(db, orderItemId, userId)
  const charge = await queryOneD1(`SELECT id, amount_kobo FROM order_additional_charges WHERE order_item_id=${orderItemId}`)

  await assert.rejects(() => confirmAdditionalChargePayment(db, userId, charge.id), SettlementError)

  const chargeAfterFail = await queryOneD1(`SELECT status FROM order_additional_charges WHERE id=${charge.id}`)
  assert.equal(chargeAfterFail.status, 'pending_payment', 'a failed (insufficient-funds) payment attempt must roll back to pending_payment, never left stuck \'paid\' with no money moved')

  // Legitimate retry after topping up must now succeed.
  await creditWallet(db, userId, Number(charge.amount_kobo), 'topup', 'retry-topup', 'Top-up to retry the additional charge payment')
  const result = await confirmAdditionalChargePayment(db, userId, charge.id)
  assert.equal(result.newBalanceKobo, 0)
  const chargeAfterRetry = await queryOneD1(`SELECT status FROM order_additional_charges WHERE id=${charge.id}`)
  assert.equal(chargeAfterRetry.status, 'paid')
})

test('ledger consistency invariant holds after a full mixed settlement battery (refund + additional-charge + no-adjustment items, sequential and concurrent) for one user', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('settle_ledger_battery')

  async function makeItem(label, { unitPriceKobo, fulfilledQuantity, finalPriceKobo }) {
    const item = await createTestCartItem({ label, priceKobo: unitPriceKobo, quantity: 1 })
    const shipping = { name: 'Test Buyer', phone: '08000000000', address: '1 Test St', city: 'Lagos', state: 'Lagos' }
    const { orderId } = await createPendingOrder(db, userId, [item], shipping, 'standard', null)
    await confirmOrderPayment(db, orderId, 'paystack', `PSK-BATTERY-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
    const row = await db.prepare('SELECT id FROM order_items WHERE order_id = ?').bind(orderId).first()
    await db
      .prepare(`UPDATE order_items SET fulfilled_quantity = ?, final_price_kobo = ?, fulfilled_by_user_id = ?, fulfilled_at = datetime('now') WHERE id = ?`)
      .bind(fulfilledQuantity, finalPriceKobo, userId, row.id)
      .run()
    return row.id
  }

  const refundItemId = await makeItem('battery_refund', { unitPriceKobo: 100000, fulfilledQuantity: 0.7, finalPriceKobo: 70000 })
  const chargeItemId = await makeItem('battery_charge', { unitPriceKobo: 100000, fulfilledQuantity: 1.1, finalPriceKobo: 110000 })
  const exactItemId = await makeItem('battery_exact', { unitPriceKobo: 100000, fulfilledQuantity: 1, finalPriceKobo: 100000 })

  // Settle all three, each racing against itself concurrently (3-way each),
  // to prove the invariant holds even when every branch is raced
  // simultaneously in the same battery.
  await Promise.allSettled([
    settleVariableWeightItem(db, refundItemId, userId),
    settleVariableWeightItem(db, refundItemId, userId),
    settleVariableWeightItem(db, refundItemId, userId),
    settleVariableWeightItem(db, chargeItemId, userId),
    settleVariableWeightItem(db, chargeItemId, userId),
    settleVariableWeightItem(db, exactItemId, userId),
    settleVariableWeightItem(db, exactItemId, userId),
  ])

  const balance = await getWalletBalance(db, userId)
  const ledgerSum = await queryOneD1(
    `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_kobo ELSE -amount_kobo END),0) as net FROM wallet_ledger WHERE user_id=${userId}`
  )
  assert.equal(Number(ledgerSum.net), balance, 'ledger consistency invariant: SUM(wallet_ledger) must equal cached_balance_kobo after the full mixed battery')
  assert.equal(balance, 30000, 'only the refund item\'s 30000 kobo shortfall should ever have been credited; the additional-charge item must NOT auto-debit')

  const refunds = await queryD1(`SELECT * FROM refunds WHERE order_item_id=${refundItemId}`)
  assert.equal(refunds.length, 1, 'exactly one refund row despite a 3-way concurrent race on the refund item')
  const charges = await queryD1(`SELECT * FROM order_additional_charges WHERE order_item_id=${chargeItemId}`)
  assert.equal(charges.length, 1, 'exactly one additional-charge row despite a 2-way concurrent race on the charge item')

  const items = await queryD1(`SELECT id, settlement_status FROM order_items WHERE id IN (${refundItemId},${chargeItemId},${exactItemId})`)
  const byId = Object.fromEntries(items.map((i) => [Number(i.id), i.settlement_status]))
  assert.equal(byId[refundItemId], 'refund_issued')
  assert.equal(byId[chargeItemId], 'additional_payment_pending')
  assert.equal(byId[exactItemId], 'settled')
})
