import assert from 'node:assert/strict'
import test from 'node:test'
import { execD1, queryOneD1, registerUser, cleanupRunNonce, RUN_NONCE } from './marketplace-engine/helpers/client.mjs'

let previousEnabled, previousStatus, previousNgStatus
let user
let product

test.before(async () => {
  previousEnabled = await queryOneD1("SELECT enabled FROM cc_capabilities WHERE key='ecosystem.naijapay'")
  previousStatus = await queryOneD1("SELECT status FROM cc_capabilities WHERE key='ecosystem.naijapay'")
  previousNgStatus = await queryOneD1("SELECT status FROM cc_countries WHERE iso_code='NG'")
  product = await queryOneD1("SELECT id,country_iso,category FROM naijapay_products WHERE country_iso='NG' AND operational_status='sandbox' ORDER BY id LIMIT 1")
  assert.ok(product, 'sandbox NaijaPay product fixture is required')
  await execD1("UPDATE cc_capabilities SET enabled=1, status='ACTIVE' WHERE key='ecosystem.naijapay'; UPDATE cc_countries SET status='LIVE' WHERE iso_code='NG';")
  user = await registerUser('naijapay-rollout')
})

test.after(async () => {
  await execD1(`UPDATE cc_capabilities SET enabled=${previousEnabled?.enabled ?? 1}, status='${previousStatus?.status ?? 'CONFIGURATION_REQUIRED'}' WHERE key='ecosystem.naijapay'; UPDATE cc_countries SET status='${previousNgStatus?.status ?? 'LIVE'}' WHERE iso_code='NG';`)
  await cleanupRunNonce(RUN_NONCE)
})

test('NaijaPay purchase boundary blocks disabled verticals before payment intent creation', async () => {
  await execD1("UPDATE cc_capabilities SET enabled=0 WHERE key='ecosystem.naijapay'")
  const before = await queryOneD1(`SELECT COUNT(*) AS count FROM payment_intents WHERE user_id=${user.userId}`)
  const response = await user.client.post('/api/naijapay/utilities/purchase', {
    product_id: product.id,
    identifier: '08012345678',
    amount_minor: 50000,
  }, { headers: { 'Idempotency-Key': `naijapay-${RUN_NONCE}` } })
  assert.equal(response.status, 409, JSON.stringify(response.body))
  assert.equal(response.body.code, 'VERTICAL_DISABLED')
  const after = await queryOneD1(`SELECT COUNT(*) AS count FROM payment_intents WHERE user_id=${user.userId}`)
  assert.equal(Number(after.count), Number(before.count))
  await execD1("UPDATE cc_capabilities SET enabled=1, status='ACTIVE' WHERE key='ecosystem.naijapay'")
})
