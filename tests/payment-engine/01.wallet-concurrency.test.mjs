/**
 * Payment Engine — Unit 2 (Engine 7 Phase 2): wallet balance mutation
 * concurrency hardening. Exercises creditWallet()/debitWallet() in
 * src/lib/wallet.ts DIRECTLY, in-process, against the real local D1
 * binding (see helpers/db.mjs's header comment for why this harness talks
 * to the DB one layer below HTTP rather than driving the running dev
 * server — this unit's scope is tightly wallet.ts-only, and wallet.ts has
 * no dedicated public endpoint).
 *
 * Genuine concurrency is exercised via Promise.all — real parallel async
 * calls into the SAME D1 binding a live Worker request would use, not
 * sequential simulation — matching booking-engine's own 05.concurrency
 * methodology (Booking Invariant 9 precedent).
 *
 * Run TWICE per the Phase 2 protocol's "run the targeted suite at least
 * twice" requirement:
 *   node --experimental-strip-types --test tests/payment-engine/01.wallet-concurrency.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestUser, queryOneD1, queryD1, disposeTestDb } from './helpers/db.mjs'
import { creditWallet, debitWallet, getWalletBalance, InsufficientFundsError } from '../../src/lib/wallet.ts'

test.after(async () => {
  await disposeTestDb()
})

test('single credit: balance increases by exactly the credited amount, one ledger row written', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('single_credit')

  const newBalance = await creditWallet(db, userId, 50000, 'test_topup', 'ref-a', 'single credit test')
  assert.equal(newBalance, 50000, 'creditWallet return value must equal the new balance')

  const cached = await getWalletBalance(db, userId)
  assert.equal(cached, 50000, 'cached_balance_kobo must match the returned balance')

  const ledgerRows = await queryD1(`SELECT entry_type, amount_kobo, balance_after_kobo FROM wallet_ledger WHERE user_id=${userId}`)
  assert.equal(ledgerRows.length, 1, 'exactly one ledger row must exist after one credit')
  assert.equal(ledgerRows[0].entry_type, 'credit')
  assert.equal(ledgerRows[0].amount_kobo, 50000)
  assert.equal(ledgerRows[0].balance_after_kobo, 50000, 'ledger snapshot must equal the post-credit balance')
})

test('single debit: balance decreases by exactly the debited amount, one ledger row written', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('single_debit')
  await creditWallet(db, userId, 100000, 'test_topup', 'seed', 'seed funding')

  const newBalance = await debitWallet(db, userId, 30000, 'test_charge', 'ref-b', 'single debit test')
  assert.equal(newBalance, 70000)

  const cached = await getWalletBalance(db, userId)
  assert.equal(cached, 70000)

  const debitRows = await queryD1(`SELECT entry_type, amount_kobo, balance_after_kobo FROM wallet_ledger WHERE user_id=${userId} AND entry_type='debit'`)
  assert.equal(debitRows.length, 1)
  assert.equal(debitRows[0].amount_kobo, 30000)
  assert.equal(debitRows[0].balance_after_kobo, 70000)
})

test('insufficient balance: debit exceeding balance throws InsufficientFundsError, no ledger row, balance unchanged', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('insufficient')
  await creditWallet(db, userId, 10000, 'test_topup', 'seed', 'seed funding')

  await assert.rejects(
    () => debitWallet(db, userId, 10001, 'test_charge', 'ref-c', 'should fail by 1 kobo'),
    InsufficientFundsError
  )

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, 10000, 'balance must be completely unchanged after a rejected debit')

  const debitRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND entry_type='debit'`)
  assert.equal(debitRows.length, 0, 'a rejected debit must never produce a ledger row')
})

test('failed debit followed by a valid debit: the valid one still succeeds correctly (no corrupted state left behind)', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('failed_then_ok')
  await creditWallet(db, userId, 5000, 'test_topup', 'seed', 'seed funding')

  await assert.rejects(() => debitWallet(db, userId, 999999, 'test_charge', 'fail-1', 'too much'), InsufficientFundsError)
  const afterFail = await getWalletBalance(db, userId)
  assert.equal(afterFail, 5000)

  const afterGood = await debitWallet(db, userId, 2000, 'test_charge', 'ok-1', 'valid debit after a failed one')
  assert.equal(afterGood, 3000)

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId}`)
  assert.equal(ledgerRows.length, 2, 'only the credit + the ONE successful debit should exist; the failed attempt left no row')
})

test('concurrent credits: N parallel credits of the same amount all land, final balance = N * amount, N ledger rows', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('conc_credit')
  const N = 10
  const AMOUNT = 1000

  await Promise.all(
    Array.from({ length: N }, (_, i) => creditWallet(db, userId, AMOUNT, 'test_topup', `conc-credit-${i}`, `concurrent credit ${i}`))
  )

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, N * AMOUNT, `all ${N} concurrent credits of ${AMOUNT} must land — no lost updates`)

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId}`)
  assert.equal(ledgerRows.length, N, `exactly ${N} ledger rows must exist, one per credit`)

  const distinctBalancesAfter = new Set(ledgerRows.map((r) => r.balance_after_kobo))
  assert.equal(distinctBalancesAfter.size, N, 'every ledger row must record a DISTINCT balance_after_kobo (no two concurrent writers stamped the same snapshot)')
})

test('concurrent debits: N parallel debits of the same amount from a sufficiently large balance all land, final balance is exact', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('conc_debit')
  const N = 10
  const AMOUNT = 1000
  const SEED = 50000
  await creditWallet(db, userId, SEED, 'test_topup', 'seed', 'seed funding')

  await Promise.all(
    Array.from({ length: N }, (_, i) => debitWallet(db, userId, AMOUNT, 'test_charge', `conc-debit-${i}`, `concurrent debit ${i}`))
  )

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, SEED - N * AMOUNT, `all ${N} concurrent debits of ${AMOUNT} must land exactly — no lost updates, no double-counting`)

  const debitRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND entry_type='debit'`)
  assert.equal(debitRows.length, N)
})

test('no negative balance under concurrent debits: exactly floor(balance/amount) debits win, the rest are rejected, balance never goes negative', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('conc_no_negative')
  const AMOUNT = 1000
  const SEED = 5000 // exactly 5 debits worth
  const RACERS = 12 // far more racers than the balance can satisfy
  await creditWallet(db, userId, SEED, 'test_topup', 'seed', 'seed funding')

  const results = await Promise.allSettled(
    Array.from({ length: RACERS }, (_, i) => debitWallet(db, userId, AMOUNT, 'test_charge', `race-${i}`, `race debit ${i}`))
  )

  const wins = results.filter((r) => r.status === 'fulfilled').length
  const losses = results.filter((r) => r.status === 'rejected').length
  assert.equal(wins, 5, `exactly 5 of ${RACERS} racers should win (balance ${SEED} / amount ${AMOUNT})`)
  assert.equal(losses, RACERS - 5, 'every non-winning racer must be rejected, never silently succeed')
  for (const r of results) {
    if (r.status === 'rejected') {
      assert.ok(r.reason instanceof InsufficientFundsError, 'every rejection must be InsufficientFundsError, never a generic/unexpected error')
    }
  }

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, 0, 'balance must land at exactly 0, never negative, never leftover from a lost update')
  assert.ok(balance >= 0, 'balance must never be negative under any circumstance')

  const debitRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND entry_type='debit'`)
  assert.equal(debitRows.length, 5, 'exactly 5 debit ledger rows must exist — the 7 rejected racers must never have written a row')
})

test('mixed concurrent credits and debits: interleaved operations settle to the exact arithmetic sum, no lost updates in either direction', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('conc_mixed')
  const SEED = 20000
  await creditWallet(db, userId, SEED, 'test_topup', 'seed', 'seed funding')

  // 8 credits of 500 (+4000) interleaved with 8 debits of 300 (-2400), all in parallel.
  const credits = Array.from({ length: 8 }, (_, i) => creditWallet(db, userId, 500, 'test_topup', `mix-credit-${i}`, `mixed credit ${i}`))
  const debits = Array.from({ length: 8 }, (_, i) => debitWallet(db, userId, 300, 'test_charge', `mix-debit-${i}`, `mixed debit ${i}`))
  await Promise.all([...credits, ...debits])

  const expected = SEED + 8 * 500 - 8 * 300
  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, expected, 'interleaved concurrent credits+debits must settle to the exact arithmetic result')

  const allRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId}`)
  assert.equal(allRows.length, 1 + 8 + 8, 'seed credit + 8 credits + 8 debits = 17 ledger rows total')

  // Ledger consistency: replaying entries in id order must reproduce the final balance exactly.
  const ordered = await queryD1(`SELECT entry_type, amount_kobo, balance_after_kobo FROM wallet_ledger WHERE user_id=${userId} ORDER BY id ASC`)
  let running = 0
  for (const row of ordered) {
    running += row.entry_type === 'credit' ? row.amount_kobo : -row.amount_kobo
    assert.equal(row.balance_after_kobo, running, `ledger row's stamped balance_after_kobo must match the running SUM computed by replaying entries in id order (entry_type=${row.entry_type}, amount=${row.amount_kobo})`)
  }
  assert.equal(running, expected, 'replaying the full ledger in id order must reproduce the exact final balance')
})

test('duplicate idempotency key (same reference_type + reference_id) called twice: both calls succeed independently — dedup is the CALLER\'s job, not wallet.ts\'s (documented design decision)', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('dup_ref')

  const b1 = await creditWallet(db, userId, 1000, 'order_refund', 'order-77', 'first refund attempt')
  const b2 = await creditWallet(db, userId, 1000, 'order_refund', 'order-77', 'second refund attempt, same reference_id')
  assert.equal(b1, 1000)
  assert.equal(b2, 2000, 'wallet.ts does not deduplicate by reference_id — both credits apply; callers (e.g. refunds.ts) own idempotency via their own CAS')

  const rows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND reference_type='order_refund' AND reference_id='order-77'`)
  assert.equal(rows.length, 2, 'two distinct ledger rows must exist for the two calls sharing the same reference_id')
})

test('distinct idempotency keys: two separate credits with different reference_ids both land independently', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('distinct_ref')

  const b1 = await creditWallet(db, userId, 1500, 'topup', 'paystack-ref-AAA', 'topup A')
  const b2 = await creditWallet(db, userId, 2500, 'topup', 'paystack-ref-BBB', 'topup B')
  assert.equal(b1, 1500)
  assert.equal(b2, 4000)

  const rows = await queryD1(`SELECT reference_id, amount_kobo FROM wallet_ledger WHERE user_id=${userId} ORDER BY id ASC`)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].reference_id, 'paystack-ref-AAA')
  assert.equal(rows[1].reference_id, 'paystack-ref-BBB')
})

test('ledger consistency invariant: SUM(credits) - SUM(debits) always equals cached_balance_kobo after any sequence of operations', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('ledger_invariant')

  await creditWallet(db, userId, 10000, 'test', 'r1', 'op1')
  await debitWallet(db, userId, 2000, 'test', 'r2', 'op2')
  await creditWallet(db, userId, 5000, 'test', 'r3', 'op3')
  await debitWallet(db, userId, 1000, 'test', 'r4', 'op4')
  await creditWallet(db, userId, 500, 'test', 'r5', 'op5')

  const sumRow = await queryOneD1(
    `SELECT SUM(CASE WHEN entry_type='credit' THEN amount_kobo ELSE -amount_kobo END) as net FROM wallet_ledger WHERE user_id=${userId}`
  )
  const cached = await getWalletBalance(db, userId)
  assert.equal(cached, sumRow.net, 'cached_balance_kobo must always equal the ledger-derived net sum — the cache must never drift from its source of truth')
  assert.equal(cached, 10000 - 2000 + 5000 - 1000 + 500)
})

test('exact final balance under a larger 20-way concurrent fan-out of mixed credits/debits matches the precise arithmetic expectation', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('conc_large')
  const SEED = 100000
  await creditWallet(db, userId, SEED, 'test_topup', 'seed', 'seed funding')

  const ops = []
  let expectedDelta = 0
  for (let i = 0; i < 20; i++) {
    if (i % 2 === 0) {
      ops.push(creditWallet(db, userId, 777, 'test', `large-c-${i}`, `large credit ${i}`))
      expectedDelta += 777
    } else {
      ops.push(debitWallet(db, userId, 333, 'test', `large-d-${i}`, `large debit ${i}`))
      expectedDelta -= 333
    }
  }
  await Promise.all(ops)

  const balance = await getWalletBalance(db, userId)
  assert.equal(balance, SEED + expectedDelta, 'a 20-way concurrent fan-out of mixed operations must settle to the exact expected arithmetic result')

  const rowCount = await queryOneD1(`SELECT COUNT(*) as n FROM wallet_ledger WHERE user_id=${userId}`)
  assert.equal(rowCount.n, 21, 'seed credit + 20 concurrent ops = 21 ledger rows, none lost, none duplicated')
})
