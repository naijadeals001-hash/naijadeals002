import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPaymentIntent } from '../../src/lib/payment-engine.ts'
import { getNaijaPayProvider, getNaijaPayTransaction, listNaijaPayProviders, listNaijaPayTransactions } from '../../src/lib/naijapay-data.ts'
import { getTestDb, createTestUser, disposeTestDb } from './helpers/db.mjs'

test.after(async () => { await disposeTestDb() })

test('provider registry exposes honest configuration, authorization, environment and health states', async () => {
  const db = await getTestDb()
  const providers = await listNaijaPayProviders(db)
  assert.ok(providers.length >= 6)
  const sandbox = providers.find((provider) => provider.provider_key === 'airtime-sandbox')
  assert.equal(sandbox.operational_status, 'sandbox')
  assert.equal(sandbox.configuration_status, 'verified')
  assert.equal(sandbox.authorization_status, 'authorized')
  assert.equal(sandbox.health_status, 'healthy')
  const detail = await getNaijaPayProvider(db, 'airtime-sandbox')
  assert.equal(detail.provider_key, 'airtime-sandbox')
  assert.ok(Array.isArray(detail.countries))
})

test('shared transaction list is owner scoped and paginated without duplicate legacy rows', async () => {
  const db = await getTestDb()
  const owner = await createTestUser('batch2-owner')
  const other = await createTestUser('batch2-other')
  const { intent } = await createPaymentIntent(db, { idempotencyKey: `batch2-${Date.now()}-owner`, userId: owner, verticalKey: 'ecosystem.naijashop', countryIso: 'NG', currency: 'NGN', amountMinor: 45000, fundingMethod: 'wallet' })
  await createPaymentIntent(db, { idempotencyKey: `batch2-${Date.now()}-other`, userId: other, verticalKey: 'ecosystem.naijapay', countryIso: 'NG', currency: 'NGN', amountMinor: 90000, fundingMethod: 'paystack' })
  const ownerRows = await listNaijaPayTransactions(db, { userId: owner, page: 1, pageSize: 1 })
  assert.equal(ownerRows.total, 1)
  assert.equal(ownerRows.rows[0].id, intent.id)
  assert.equal((await getNaijaPayTransaction(db, intent.id, other)), null)
  assert.equal((await getNaijaPayTransaction(db, intent.id, owner)).user_id, owner)
})
