import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPaymentIntent, IdempotencyConflictError, recordPaymentEvent, transitionPaymentIntent, postJournalEntry, PaymentContractError } from '../../src/lib/payment-engine.ts'
import { getTestDb, createTestUser, queryD1, disposeTestDb } from './helpers/db.mjs'

test.after(async () => { await disposeTestDb() })

test('shared payment intent is idempotent and returns the original transaction reference', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('contract-idempotent')
  const input = { idempotencyKey: `intent-${Date.now()}-a`, userId, verticalKey: 'ecosystem.naijashop', countryIso: 'NG', currency: 'NGN', amountMinor: 125000, fundingMethod: 'wallet', lineItems: [{ code: 'item', description: 'Test item', amountMinor: 125000 }] }
  const first = await createPaymentIntent(db, input)
  const retry = await createPaymentIntent(db, input)
  assert.equal(first.created, true)
  assert.equal(retry.created, false)
  assert.equal(retry.intent.transactionReference, first.intent.transactionReference)
  assert.equal((await queryD1(`SELECT COUNT(*) AS n FROM payment_intents WHERE id=${first.intent.id}`))[0].n, 1)
})

test('reusing an idempotency key for a different amount is rejected', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('contract-conflict')
  const key = `intent-${Date.now()}-b`
  await createPaymentIntent(db, { idempotencyKey: key, userId, verticalKey: 'ecosystem.naijapay', countryIso: 'NG', currency: 'NGN', amountMinor: 10000, fundingMethod: 'wallet' })
  await assert.rejects(() => createPaymentIntent(db, { idempotencyKey: key, userId, verticalKey: 'ecosystem.naijapay', countryIso: 'NG', currency: 'NGN', amountMinor: 10001, fundingMethod: 'wallet' }), IdempotencyConflictError)
})

test('journal posting requires balanced lines and history cannot be edited', async () => {
  const db = await getTestDb()
  await assert.rejects(() => postJournalEntry(db, { entryReference: `journal-${Date.now()}-bad`, currency: 'NGN', sourceType: 'test', sourceReference: 'bad', lines: [{ accountCode: 'asset', direction: 'debit', amountMinor: 100 }] }), PaymentContractError)
  const entryId = await postJournalEntry(db, { entryReference: `journal-${Date.now()}-good`, currency: 'NGN', sourceType: 'test', sourceReference: 'good', lines: [{ accountCode: 'customer_wallet', direction: 'debit', amountMinor: 1000 }, { accountCode: 'platform_cash', direction: 'credit', amountMinor: 1000 }] })
  assert.equal((await queryD1(`SELECT COUNT(*) AS n FROM journal_lines WHERE journal_entry_id=${entryId}`))[0].n, 2)
  await assert.rejects(() => db.prepare("UPDATE journal_entries SET description='tampered' WHERE id=?").bind(entryId).run())
})

test('provider event replay is ignored and lifecycle transition is compare-and-swap', async () => {
  const db = await getTestDb()
  const userId = await createTestUser('contract-events')
  const { intent } = await createPaymentIntent(db, { idempotencyKey: `intent-${Date.now()}-c`, userId, verticalKey: 'ecosystem.naijapay', countryIso: 'NG', currency: 'NGN', amountMinor: 20000, fundingMethod: 'paystack' })
  assert.equal(await recordPaymentEvent(db, intent.id, 'charge.success', { amount: 20000 }, 'paystack', 'provider-1'), true)
  assert.equal(await recordPaymentEvent(db, intent.id, 'charge.success', { amount: 20000 }, 'paystack', 'provider-1'), false)
  assert.equal(await transitionPaymentIntent(db, intent.id, 'created', 'pending'), true)
  assert.equal(await transitionPaymentIntent(db, intent.id, 'created', 'succeeded'), false)
})
