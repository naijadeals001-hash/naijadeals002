/**
 * Payment Engine — Unit 3 (Engine 7 Phase 2): Paystack webhook hardening
 * (G-2 concurrency CAS + F-1 amount/currency cross-check +
 * payment_transactions.provider_reference UNIQUE constraint).
 *
 * Drives the REAL running dev server's /api/webhooks/paystack route over
 * HTTP with genuine HMAC-SHA512 signatures (see helpers/paystack-sim.mjs) —
 * this is the correct layer for Unit 3 (unlike Unit 2's direct in-process
 * wallet.ts calls) because the webhook route itself — signature
 * verification, JSON parsing, the CAS claim, and the branch into
 * confirmOrderPayment()/creditWallet() — is exactly what's being hardened,
 * and it has no meaningful "internal" surface below the HTTP boundary.
 *
 * PRECONDITION: the dev server must be running with PAYSTACK_SECRET_KEY set
 * in .dev.vars (a throwaway local-only test value, gitignored) matching
 * helpers/paystack-sim.mjs's TEST_SECRET_KEY default.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser } from '../booking-engine/helpers/client.mjs'
import { execD1, queryOneD1, queryD1 } from './helpers/db.mjs'
import { sendPaystackWebhook } from './helpers/paystack-sim.mjs'

const NONCE = `${Date.now()}${Math.floor(Math.random() * 100000)}`

async function seedPaymentTransaction({ userId, orderId = null, amountKobo, reference, status = 'initiated' }) {
  await execD1(
    `INSERT INTO payment_transactions (order_id, user_id, provider, provider_reference, amount_kobo, status) VALUES (${orderId ?? 'NULL'}, ${userId}, 'paystack', '${reference}', ${amountKobo}, '${status}')`
  )
}

test('webhook: invalid signature is rejected with 401, no transaction row touched', async () => {
  const { userId } = await registerUser(`wh_badsig_${NONCE}`)
  const reference = `WH-BADSIG-${NONCE}`
  await seedPaymentTransaction({ userId, amountKobo: 5000, reference })

  const res = await sendPaystackWebhook({ reference, amountKobo: 5000, badSignature: true })
  assert.equal(res.status, 401)

  const tx = await queryOneD1(`SELECT status FROM payment_transactions WHERE provider_reference='${reference}'`)
  assert.equal(tx.status, 'initiated', 'a webhook with a bad signature must never mutate the transaction row')
})

test('webhook: valid delivery for a wallet top-up credits the wallet exactly once and marks the transaction success', async () => {
  const { userId } = await registerUser(`wh_topup_ok_${NONCE}`)
  const reference = `WH-TOPUP-OK-${NONCE}`
  await seedPaymentTransaction({ userId, amountKobo: 15000, reference })

  const res = await sendPaystackWebhook({ reference, amountKobo: 15000 })
  assert.equal(res.status, 200)

  const tx = await queryOneD1(`SELECT status FROM payment_transactions WHERE provider_reference='${reference}'`)
  assert.equal(tx.status, 'success')

  const ledgerRows = await queryD1(`SELECT amount_kobo FROM wallet_ledger WHERE user_id=${userId} AND reference_type='topup' AND reference_id='${reference}'`)
  assert.equal(ledgerRows.length, 1, 'exactly one ledger credit must exist for this reference')
  assert.equal(ledgerRows[0].amount_kobo, 15000)
})

test('webhook: duplicate SEQUENTIAL delivery for the same reference (Paystack retry after our own 200) does not double-credit', async () => {
  const { userId } = await registerUser(`wh_dup_seq_${NONCE}`)
  const reference = `WH-DUP-SEQ-${NONCE}`
  await seedPaymentTransaction({ userId, amountKobo: 8000, reference })

  const res1 = await sendPaystackWebhook({ reference, amountKobo: 8000 })
  assert.equal(res1.status, 200)
  const res2 = await sendPaystackWebhook({ reference, amountKobo: 8000 })
  assert.equal(res2.status, 200, 'a duplicate delivery must still get 200 (never make Paystack retry forever), just with no financial effect')

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND reference_type='topup' AND reference_id='${reference}'`)
  assert.equal(ledgerRows.length, 1, 'a sequential duplicate delivery must NEVER result in a second credit')
})

test('webhook: CONCURRENT duplicate delivery for the same reference (the real G-2 race — two deliveries in flight at once) credits exactly once', async () => {
  const { userId } = await registerUser(`wh_dup_conc_${NONCE}`)
  const reference = `WH-DUP-CONC-${NONCE}`
  await seedPaymentTransaction({ userId, amountKobo: 12000, reference })

  const N = 6
  const results = await Promise.all(Array.from({ length: N }, () => sendPaystackWebhook({ reference, amountKobo: 12000 })))
  for (const r of results) {
    assert.equal(r.status, 200, 'every concurrent delivery attempt must get 200, win or lose the CAS claim')
  }

  const ledgerRows = await queryD1(`SELECT amount_kobo FROM wallet_ledger WHERE user_id=${userId} AND reference_type='topup' AND reference_id='${reference}'`)
  assert.equal(ledgerRows.length, 1, `exactly ONE of the ${N} concurrent deliveries must have won the CAS claim and credited — this is the core G-2 fix under adversarial concurrency`)
  assert.equal(ledgerRows[0].amount_kobo, 12000)

  const balance = await queryOneD1(`SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id=${userId}`)
  assert.equal(balance.cached_balance_kobo, 12000, 'the cached balance must reflect exactly ONE credit, not N')

  const txRow = await queryOneD1(`SELECT status FROM payment_transactions WHERE provider_reference='${reference}'`)
  assert.equal(txRow.status, 'success')
})

test('webhook: amount mismatch (event payload amount != recorded amount_kobo) is rejected — no credit, transaction stays initiated (F-1 fix)', async () => {
  const { userId } = await registerUser(`wh_amount_mismatch_${NONCE}`)
  const reference = `WH-AMOUNT-MISMATCH-${NONCE}`
  await seedPaymentTransaction({ userId, amountKobo: 10000, reference })

  const res = await sendPaystackWebhook({ reference, amountKobo: 99999999 }) // wildly different from the recorded 10000
  assert.equal(res.status, 200, 'a mismatched payload still gets 200 (Paystack retrying will not fix a payload mismatch — never induce a retry storm)')

  const tx = await queryOneD1(`SELECT status FROM payment_transactions WHERE provider_reference='${reference}'`)
  assert.equal(tx.status, 'initiated', 'an amount-mismatched webhook must NEVER mark the transaction success')

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND reference_type='topup' AND reference_id='${reference}'`)
  assert.equal(ledgerRows.length, 0, 'an amount-mismatched webhook must NEVER credit the wallet')
})

test('webhook: currency mismatch (event payload currency != NGN) is rejected — no credit, transaction stays initiated (F-1 fix)', async () => {
  const { userId } = await registerUser(`wh_currency_mismatch_${NONCE}`)
  const reference = `WH-CURRENCY-MISMATCH-${NONCE}`
  await seedPaymentTransaction({ userId, amountKobo: 7000, reference })

  const res = await sendPaystackWebhook({ reference, amountKobo: 7000, currency: 'USD' })
  assert.equal(res.status, 200)

  const tx = await queryOneD1(`SELECT status FROM payment_transactions WHERE provider_reference='${reference}'`)
  assert.equal(tx.status, 'initiated', 'a currency-mismatched webhook must NEVER mark the transaction success')

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND reference_type='topup' AND reference_id='${reference}'`)
  assert.equal(ledgerRows.length, 0)
})

test('webhook: unknown reference (no matching payment_transactions row) is a safe no-op, 200 OK', async () => {
  const res = await sendPaystackWebhook({ reference: `WH-UNKNOWN-${NONCE}`, amountKobo: 1000 })
  assert.equal(res.status, 200)
})

test('webhook: already-success transaction receiving another delivery is a safe no-op (fast path before the CAS claim), no second credit', async () => {
  const { userId } = await registerUser(`wh_already_success_${NONCE}`)
  const reference = `WH-ALREADY-SUCCESS-${NONCE}`
  await seedPaymentTransaction({ userId, amountKobo: 4000, reference, status: 'success' })
  // Seed a matching ledger row directly, simulating this having already been credited by an earlier delivery.
  await execD1(
    `INSERT OR IGNORE INTO wallet_accounts (user_id, cached_balance_kobo) VALUES (${userId}, 0); ` +
    `UPDATE wallet_accounts SET cached_balance_kobo = cached_balance_kobo + 4000 WHERE user_id=${userId}; ` +
    `INSERT INTO wallet_ledger (user_id, entry_type, amount_kobo, balance_after_kobo, reference_type, reference_id, description) VALUES (${userId}, 'credit', 4000, 4000, 'topup', '${reference}', 'seeded as already-processed')`
  )

  const res = await sendPaystackWebhook({ reference, amountKobo: 4000 })
  assert.equal(res.status, 200)

  const ledgerRows = await queryD1(`SELECT * FROM wallet_ledger WHERE user_id=${userId} AND reference_type='topup' AND reference_id='${reference}'`)
  assert.equal(ledgerRows.length, 1, 'a delivery for an already-success transaction must never add a second ledger row')
})

test('payment_transactions.provider_reference UNIQUE constraint (migration 0044): a duplicate reference insert is rejected at the database level', async () => {
  const { userId } = await registerUser(`wh_unique_${NONCE}`)
  const reference = `WH-UNIQUE-${NONCE}`
  await seedPaymentTransaction({ userId, amountKobo: 1000, reference })

  let threw = false
  try {
    await seedPaymentTransaction({ userId, amountKobo: 2000, reference })
  } catch (err) {
    threw = true
    // execFileAsync (used by helpers/db.mjs's execD1) surfaces a non-zero-exit
    // child process failure as an error whose `stdout`/`stderr` carry
    // wrangler's own JSON error payload — NOT `message` (message is just
    // "Command failed: ..."). Check the actual wrangler output.
    const combined = `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`
    assert.match(combined, /UNIQUE constraint failed/i, 'the rejection must specifically be the UNIQUE constraint, not some other error')
  }
  assert.ok(threw, 'inserting a second payment_transactions row with an already-used provider_reference must be rejected by the database')

  const rows = await queryD1(`SELECT * FROM payment_transactions WHERE provider_reference='${reference}'`)
  assert.equal(rows.length, 1, 'only the first insert must exist — the duplicate must never have landed')
})
