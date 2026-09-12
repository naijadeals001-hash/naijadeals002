/**
 * Engine 9 — Category C (notification preferences API), HTTP mode.
 * Drives the real running dev server via the notifications API's
 * /api/notifications/preferences routes (src/routes/api-notifications.ts).
 *
 * PRECONDITION: PM2 dev server RUNNING (HTTP mode — see helpers/client.mjs).
 * Run command:
 *   node --experimental-strip-types --test tests/notification-engine/03.preferences-api.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser } from './helpers/client.mjs'

test('preferences: unauthenticated GET /preferences is rejected 401', async () => {
  const { client } = await registerUser('pref_auth_a')
  // Fresh client with no session cookie at all.
  const bare = new (Object.getPrototypeOf(client).constructor)()
  const res = await bare.get('/api/notifications/preferences')
  assert.equal(res.status, 401)
})

test('preferences: authenticated GET /preferences returns the full category x channel matrix with mandatory categories flagged', async () => {
  const { client } = await registerUser('pref_matrix')
  const res = await client.get('/api/notifications/preferences')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.preferences))
  const transactional = res.body.preferences.filter((p) => p.category === 'transactional')
  assert.ok(transactional.length > 0, 'expected transactional rows in the matrix')
  for (const row of transactional) {
    assert.equal(row.mandatory, true, 'transactional must always be flagged mandatory')
    assert.equal(row.enabled, true, 'transactional must always be effectively enabled')
  }
  const security = res.body.preferences.filter((p) => p.category === 'security')
  for (const row of security) {
    assert.equal(row.mandatory, true)
    assert.equal(row.enabled, true)
  }
  const order = res.body.preferences.filter((p) => p.category === 'order')
  assert.ok(order.length > 0)
  assert.equal(order[0].mandatory, false, 'order category must NOT be flagged mandatory')
})

test('preferences: PUT to disable a NON-mandatory category+channel succeeds and is reflected on next GET', async () => {
  const { client } = await registerUser('pref_disable_ok')
  const put = await client.put('/api/notifications/preferences', { category: 'marketing', channel: 'in_app', enabled: false })
  assert.equal(put.status, 200, `expected success disabling marketing: ${JSON.stringify(put.body)}`)

  const after = await client.get('/api/notifications/preferences')
  const row = after.body.preferences.find((p) => p.category === 'marketing' && p.channel === 'in_app')
  assert.ok(row, 'expected a marketing/in_app row in the matrix')
  assert.equal(row.enabled, false, 'marketing/in_app must now read as disabled')
})

test('preferences: PUT attempting to disable the MANDATORY "transactional" category is rejected 400, never silently accepted', async () => {
  const { client } = await registerUser('pref_disable_transactional')
  const put = await client.put('/api/notifications/preferences', { category: 'transactional', channel: 'email', enabled: false })
  assert.equal(put.status, 400, `expected a 400 rejection: ${JSON.stringify(put.body)}`)
  assert.match(put.body.error, /cannot be disabled/i)

  // Confirm the matrix still reports it enabled — the rejected write must
  // not have silently persisted anyway.
  const after = await client.get('/api/notifications/preferences')
  const row = after.body.preferences.find((p) => p.category === 'transactional' && p.channel === 'email')
  assert.equal(row.enabled, true)
})

test('preferences: PUT attempting to disable the MANDATORY "security" category is rejected 400', async () => {
  const { client } = await registerUser('pref_disable_security')
  const put = await client.put('/api/notifications/preferences', { category: 'security', channel: 'in_app', enabled: false })
  assert.equal(put.status, 400)
})

test('preferences: PUT rejects an invalid category or channel value with 400 (never a 500, never silently coerced)', async () => {
  const { client } = await registerUser('pref_invalid')
  const badCategory = await client.put('/api/notifications/preferences', { category: 'not_a_real_category', channel: 'in_app', enabled: true })
  assert.equal(badCategory.status, 400)
  const badChannel = await client.put('/api/notifications/preferences', { category: 'order', channel: 'carrier_pigeon', enabled: true })
  assert.equal(badChannel.status, 400)
})

test('preferences: cross-user isolation — user B setting a preference never affects user A\'s matrix', async () => {
  const { client: clientA } = await registerUser('pref_isolation_a')
  const { client: clientB } = await registerUser('pref_isolation_b')

  await clientB.put('/api/notifications/preferences', { category: 'promotional', channel: 'in_app', enabled: false })

  const matrixA = await clientA.get('/api/notifications/preferences')
  const rowA = matrixA.body.preferences.find((p) => p.category === 'promotional' && p.channel === 'in_app')
  // 'promotional' defaults to in_app enabled — user A never touched it, so
  // it must still read as the untouched default (true), proving B's write
  // did not leak across users.
  assert.equal(rowA.enabled, true, "user B's preference write must not affect user A's matrix")
})

test('preferences: re-enabling a previously-disabled non-mandatory category+channel round-trips correctly', async () => {
  const { client } = await registerUser('pref_roundtrip')
  await client.put('/api/notifications/preferences', { category: 'delivery', channel: 'in_app', enabled: false })
  let matrix = await client.get('/api/notifications/preferences')
  let row = matrix.body.preferences.find((p) => p.category === 'delivery' && p.channel === 'in_app')
  assert.equal(row.enabled, false)

  await client.put('/api/notifications/preferences', { category: 'delivery', channel: 'in_app', enabled: true })
  matrix = await client.get('/api/notifications/preferences')
  row = matrix.body.preferences.find((p) => p.category === 'delivery' && p.channel === 'in_app')
  assert.equal(row.enabled, true)
})
