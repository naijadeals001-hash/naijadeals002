import assert from 'node:assert/strict'
import test from 'node:test'
import {
  disposeTestDb,
  getTestDb,
  RUN_NONCE,
  createTestUser,
} from './payment-engine/helpers/db.mjs'
import {
  getEatsOrdersForOperator,
  getOwnedEatsOrderForOperator,
  resolveEatsOperatorProfile,
  transitionEatsOrderForOperator,
  EatsOperatorNotFoundError,
  EatsOperatorStateError,
} from '../src/lib/eats-operator.ts'

test.after(async () => {
  const db = await getTestDb()
  await db.batch([
    db.prepare('DELETE FROM eats_order_status_events WHERE order_id IN (SELECT id FROM eats_orders WHERE order_number LIKE ?)').bind(`EO-TEST-${RUN_NONCE}%`),
    db.prepare('DELETE FROM eats_order_items WHERE order_id IN (SELECT id FROM eats_orders WHERE order_number LIKE ?)').bind(`EO-TEST-${RUN_NONCE}%`),
    db.prepare('DELETE FROM eats_orders WHERE order_number LIKE ?').bind(`EO-TEST-${RUN_NONCE}%`),
    db.prepare('DELETE FROM restaurants WHERE slug LIKE ?').bind(`operator-test-${RUN_NONCE}%`),
    db.prepare('DELETE FROM provider_profiles WHERE display_name LIKE ?').bind(`Operator Test ${RUN_NONCE}%`),
    db.prepare('DELETE FROM users WHERE email LIKE ?').bind(`paytest_operator_${RUN_NONCE}%`),
  ])
  await disposeTestDb()
})

let fixturePromise
async function fixture() {
  if (fixturePromise) return fixturePromise
  fixturePromise = (async () => {
    const db = await getTestDb()
    const operatorA = await createTestUser(`operator_${RUN_NONCE}_a`)
    const operatorB = await createTestUser(`operator_${RUN_NONCE}_b`)
    const customer = await createTestUser(`operator_${RUN_NONCE}_customer`)
    const pending = await createTestUser(`operator_${RUN_NONCE}_pending`)

    const profileA = Number((await db.prepare(`INSERT INTO provider_profiles (user_id, provider_type, display_name, country_iso, verification_status, operational_status, onboarding_completed_at) VALUES (?, 'restaurant_operator', ?, 'NG', 'verified', 'active', datetime('now'))`).bind(operatorA, `Operator Test ${RUN_NONCE} A`).run()).meta.last_row_id)
    const profileB = Number((await db.prepare(`INSERT INTO provider_profiles (user_id, provider_type, display_name, country_iso, verification_status, operational_status, onboarding_completed_at) VALUES (?, 'restaurant_operator', ?, 'NG', 'verified', 'active', datetime('now'))`).bind(operatorB, `Operator Test ${RUN_NONCE} B`).run()).meta.last_row_id)
    await db.prepare(`INSERT INTO provider_profiles (user_id, provider_type, display_name, country_iso, verification_status, operational_status) VALUES (?, 'restaurant_operator', ?, 'NG', 'pending', 'active')`).bind(pending, `Operator Test ${RUN_NONCE} pending`).run()
    const cuisine = await db.prepare('SELECT id FROM cuisines LIMIT 1').first()
    assert.ok(cuisine, 'local NaijaEats seed must provide a cuisine')
    const restaurantA = Number((await db.prepare(`INSERT INTO restaurants (slug, owner_provider_profile_id, name, description, cuisine_id, country_iso, city) VALUES (?, ?, ?, '', ?, 'NG', 'Lagos')`).bind(`operator-test-${RUN_NONCE}-a`, profileA, 'Operator Test Restaurant A', cuisine.id).run()).meta.last_row_id)
    const restaurantB = Number((await db.prepare(`INSERT INTO restaurants (slug, owner_provider_profile_id, name, description, cuisine_id, country_iso, city) VALUES (?, ?, ?, '', ?, 'NG', 'Lagos')`).bind(`operator-test-${RUN_NONCE}-b`, profileB, 'Operator Test Restaurant B', cuisine.id).run()).meta.last_row_id)
    async function createOrder(suffix, restaurantId) {
      return Number((await db.prepare(`INSERT INTO eats_orders (order_number, customer_user_id, restaurant_id, status, payment_status, subtotal_kobo, total_kobo, currency, shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state) VALUES (?, ?, ?, 'new', 'unpaid', 1000, 1000, 'NGN', 'Customer', '0800', 'Address', 'Lagos', 'Lagos')`).bind(`EO-TEST-${RUN_NONCE}-${suffix}`, customer, restaurantId).run()).meta.last_row_id)
    }
    const orderA = await createOrder('A', restaurantA)
    const orderB = await createOrder('B', restaurantB)
    const validOrder = await createOrder('VALID', restaurantA)
    const invalidOrder = await createOrder('INVALID', restaurantA)
    const duplicateOrder = await createOrder('DUPLICATE', restaurantA)
    return { db, operatorA, operatorB, pending, profileA, profileB, restaurantA, restaurantB, orderA, orderB, validOrder, invalidOrder, duplicateOrder }
  })()
  return fixturePromise
}

test('unauthenticated/unresolved users cannot resolve a restaurant operator profile', { concurrency: false }, async () => {
  const { db, pending } = await fixture()
  assert.equal(await resolveEatsOperatorProfile(db, -999999), null)
  assert.equal(await resolveEatsOperatorProfile(db, pending), null)
})

test('operator order list is ownership-scoped and excludes another restaurant', { concurrency: false }, async () => {
  const { db, profileA, orderA, orderB } = await fixture()
  const orders = await getEatsOrdersForOperator(db, profileA)
  assert.ok(orders.some((o) => o.id === orderA))
  assert.ok(!orders.some((o) => o.id === orderB))
  assert.equal(await getOwnedEatsOrderForOperator(db, profileA, orderB), null)
})

test('cross-restaurant transition is rejected before mutation', { concurrency: false }, async () => {
  const { db, profileA, orderB } = await fixture()
  await assert.rejects(() => transitionEatsOrderForOperator(db, profileA, orderB, 'accepted', 1), EatsOperatorNotFoundError)
  const row = await db.prepare('SELECT status FROM eats_orders WHERE id = ?').bind(orderB).first()
  assert.equal(row.status, 'new')
})

test('valid lifecycle transitions record the authenticated actor in the audit events', { concurrency: false }, async () => {
  const { db, profileA, validOrder, operatorA } = await fixture()
  await transitionEatsOrderForOperator(db, profileA, validOrder, 'accepted', operatorA, 'Kitchen accepted')
  const row = await db.prepare('SELECT status, actor_user_id, note FROM eats_order_status_events WHERE order_id = ? ORDER BY id DESC LIMIT 1').bind(validOrder).first()
  assert.deepEqual(row, { status: 'accepted', actor_user_id: operatorA, note: 'Kitchen accepted' })
})

test('invalid lifecycle transition is rejected and does not create an event', { concurrency: false }, async () => {
  const { db, profileA, invalidOrder } = await fixture()
  const before = await db.prepare('SELECT COUNT(*) AS count FROM eats_order_status_events WHERE order_id = ?').bind(invalidOrder).first()
  await assert.rejects(() => transitionEatsOrderForOperator(db, profileA, invalidOrder, 'completed', 1), EatsOperatorStateError)
  const after = await db.prepare('SELECT COUNT(*) AS count FROM eats_order_status_events WHERE order_id = ?').bind(invalidOrder).first()
  assert.equal(after.count, before.count)
})

test('duplicate transition request is rejected by the current-status guard', { concurrency: false }, async () => {
  const { db, profileA, duplicateOrder, operatorA } = await fixture()
  await transitionEatsOrderForOperator(db, profileA, duplicateOrder, 'accepted', operatorA)
  const before = await db.prepare('SELECT COUNT(*) AS count FROM eats_order_status_events WHERE order_id = ?').bind(duplicateOrder).first()
  await assert.rejects(() => transitionEatsOrderForOperator(db, profileA, duplicateOrder, 'accepted', operatorA), EatsOperatorStateError)
  const after = await db.prepare('SELECT COUNT(*) AS count FROM eats_order_status_events WHERE order_id = ?').bind(duplicateOrder).first()
  assert.equal(after.count, before.count)
})
