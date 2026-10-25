import test from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, cleanupRunNonce, execD1, queryOneD1, RUN_NONCE } from './marketplace-engine/helpers/client.mjs'

let superAdmin, countryAdmin

test.before(async () => {
  superAdmin = await registerUser(`cc004-super-${RUN_NONCE}`)
  countryAdmin = await registerUser(`cc004-country-${RUN_NONCE}`)
  await execD1(`INSERT OR IGNORE INTO cc_user_roles(user_id,role_id,assigned_by_user_id) SELECT ${superAdmin.userId},id,${superAdmin.userId} FROM cc_roles WHERE key='super_admin'; INSERT OR IGNORE INTO cc_user_roles(user_id,role_id,assigned_by_user_id) SELECT ${countryAdmin.userId},id,${superAdmin.userId} FROM cc_roles WHERE key='country_admin';`)
})

test.after(async () => {
  await execD1(`DELETE FROM cc_user_country_scopes WHERE user_id IN (${superAdmin.userId},${countryAdmin.userId}); DELETE FROM cc_user_roles WHERE user_id IN (${superAdmin.userId},${countryAdmin.userId}); DELETE FROM cc_audit_logs WHERE actor_user_id IN (${superAdmin.userId},${countryAdmin.userId}); DELETE FROM cc_domain_events WHERE actor_user_id IN (${superAdmin.userId},${countryAdmin.userId});`)
  await cleanupRunNonce(RUN_NONCE)
})

test('authenticated Super Admin can assign and revoke country scope; Country Admin cannot', async () => {
  const initial = await superAdmin.client.get('/api/control-center/country-scopes')
  assert.equal(initial.status, 200, JSON.stringify(initial.body))
  const denied = await countryAdmin.client.get('/api/control-center/country-scopes')
  assert.equal(denied.status, 403, JSON.stringify(denied.body))

  const assigned = await superAdmin.client.post('/api/control-center/country-scopes', { user_id: countryAdmin.userId, country_iso: 'NG' })
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body))
  assert.equal(assigned.body.scope.country_iso, 'NG')
  assert.equal((await queryOneD1(`SELECT country_iso FROM cc_user_country_scopes WHERE user_id=${countryAdmin.userId}`)).country_iso, 'NG')

  const replay = await superAdmin.client.post('/api/control-center/country-scopes', { user_id: countryAdmin.userId, country_iso: 'NG' })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.replayed, true)

  const revoked = await superAdmin.client.delete(`/api/control-center/country-scopes/${countryAdmin.userId}/NG`)
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body))
  assert.equal(await queryOneD1(`SELECT country_iso FROM cc_user_country_scopes WHERE user_id=${countryAdmin.userId}`), null)
})

test('authenticated Control Center can read persisted EATS operations while guests are denied', async () => {
  const guest = await fetch('http://localhost:3000/api/control-center/eats/operations/summary')
  assert.equal(guest.status, 401)
  const eatsPage = await superAdmin.client.get('/control-center/eats')
  assert.equal(eatsPage.status, 200)
  assert.match(eatsPage.raw, /NaijaEats Operations/)
  const scopePage = await superAdmin.client.get('/control-center/country-scopes')
  assert.equal(scopePage.status, 200)
  assert.match(scopePage.raw, /Country Admin Scopes/)
  const summary = await superAdmin.client.get('/api/control-center/eats/operations/summary')
  assert.equal(summary.status, 200, JSON.stringify(summary.body))
  assert.ok(summary.body.metrics)
  const orders = await superAdmin.client.get('/api/control-center/eats/operations/orders?limit=5&offset=0')
  assert.equal(orders.status, 200, JSON.stringify(orders.body))
  assert.equal(orders.body.limit, 5)
})
