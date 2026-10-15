import assert from 'node:assert/strict'
import test from 'node:test'
import {
  disposeTestDb,
  getTestDb,
  RUN_NONCE,
  createTestUser,
} from './payment-engine/helpers/db.mjs'
import {
  getEatsOrderItemsForOperator,
  getEatsOrdersForOperator,
  getOwnedEatsOrderForOperator,
  resolveEatsOperatorProfile,
  transitionEatsOrderForOperator,
  EatsOperatorFilterError,
  EatsOperatorNotFoundError,
  EatsOperatorStateError,
} from '../src/lib/eats-operator.ts'

test.after(async () => {
  const db = await getTestDb()
  await db.batch([
    db.prepare('DELETE FROM eats_order_status_events WHERE order_id IN (SELECT id FROM eats_orders WHERE order_number LIKE ?)').bind(`EO-TEST-${RUN_NONCE}%`),
    db.prepare('DELETE FROM eats_order_item_options WHERE order_item_id IN (SELECT id FROM eats_order_items WHERE order_id IN (SELECT id FROM eats_orders WHERE order_number LIKE ?))').bind(`EO-TEST-${RUN_NONCE}%`),
    db.prepare('DELETE FROM eats_order_items WHERE order_id IN (SELECT id FROM eats_orders WHERE order_number LIKE ?)').bind(`EO-TEST-${RUN_NONCE}%`),
    db.prepare('DELETE FROM eats_orders WHERE order_number LIKE ?').bind(`EO-TEST-${RUN_NONCE}%`),
    db.prepare('DELETE FROM menu_items WHERE name LIKE ?').bind(`Operator Test Item ${RUN_NONCE}%`),
    db.prepare('DELETE FROM menu_sections WHERE name LIKE ?').bind(`Operator Test Section ${RUN_NONCE}%`),
    db.prepare('DELETE FROM menus WHERE name LIKE ?').bind(`Operator Test Menu ${RUN_NONCE}%`),
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
    const populatedOrder = await createOrder('POPULATED', restaurantA)
    const invalidOrder = await createOrder('INVALID', restaurantA)
    const duplicateOrder = await createOrder('DUPLICATE', restaurantA)
    const auditFailureOrder = await createOrder('AUDITFAIL', restaurantA)
    const raceOrder = await createOrder('RACE', restaurantA)
    const menuId = Number((await db.prepare('INSERT INTO menus (restaurant_id, name, is_active) VALUES (?, ?, 1)').bind(restaurantA, `Operator Test Menu ${RUN_NONCE}`).run()).meta.last_row_id)
    const sectionId = Number((await db.prepare('INSERT INTO menu_sections (menu_id, name, sort_order) VALUES (?, ?, 1)').bind(menuId, `Operator Test Section ${RUN_NONCE}`).run()).meta.last_row_id)
    const menuItemId = Number((await db.prepare('INSERT INTO menu_items (menu_section_id, restaurant_id, name, base_price_kobo, is_available) VALUES (?, ?, ?, ?, 1)').bind(sectionId, restaurantA, `Operator Test Item ${RUN_NONCE}`, 500).run()).meta.last_row_id)
    const firstOrderItem = Number((await db.prepare('INSERT INTO eats_order_items (order_id, menu_item_id, name_snapshot, unit_price_kobo, quantity, line_total_kobo) VALUES (?, ?, ?, ?, ?, ?)').bind(populatedOrder, menuItemId, 'Jollof Rice', 600, 2, 1200).run()).meta.last_row_id)
    const secondOrderItem = Number((await db.prepare('INSERT INTO eats_order_items (order_id, menu_item_id, name_snapshot, unit_price_kobo, quantity, line_total_kobo) VALUES (?, ?, ?, ?, ?, ?)').bind(populatedOrder, menuItemId, 'Jollof Rice — second line', 500, 1, 500).run()).meta.last_row_id)
    await db.prepare('INSERT INTO eats_order_item_options (order_item_id, option_name_snapshot, price_delta_kobo_snapshot) VALUES (?, ?, ?)').bind(firstOrderItem, 'Extra plantain', 100).run()
    await db.prepare('UPDATE eats_orders SET subtotal_kobo = 1700, delivery_fee_kobo = 200, total_kobo = 1900 WHERE id = ?').bind(populatedOrder).run()
    return { db, operatorA, operatorB, pending, profileA, profileB, restaurantA, restaurantB, orderA, orderB, validOrder, populatedOrder, invalidOrder, duplicateOrder, auditFailureOrder, raceOrder, menuItemId, secondOrderItem }
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

test('populated operator details return item snapshots, options, totals, payment, and history data', { concurrency: false }, async () => {
  const { db, profileA, populatedOrder, operatorA, secondOrderItem } = await fixture()
  await transitionEatsOrderForOperator(db, profileA, populatedOrder, 'accepted', operatorA, 'Accepted for kitchen review')
  const order = await getOwnedEatsOrderForOperator(db, profileA, populatedOrder)
  const items = await getEatsOrderItemsForOperator(db, profileA, populatedOrder)
  assert.equal(order.total_kobo, 1900)
  assert.equal(order.delivery_fee_kobo, 200)
  assert.equal(order.payment_status, 'unpaid')
  assert.equal(items.length, 2)
  assert.deepEqual(items[0].options.map((option) => option.option_name_snapshot), ['Extra plantain'])
  assert.equal(items[0].line_total_kobo, 1200)
  assert.equal(items[1].id, secondOrderItem)
})

test('invalid status filters are rejected while valid filters remain supported', { concurrency: false }, async () => {
  const { db, profileA } = await fixture()
  assert.ok((await getEatsOrdersForOperator(db, profileA, { status: 'new' })).length >= 1)
  await assert.rejects(() => getEatsOrdersForOperator(db, profileA, { status: 'bogus' }), EatsOperatorFilterError)
  await assert.rejects(() => getEatsOrdersForOperator(db, profileA, { status: ' ' }), EatsOperatorFilterError)
})

test('audit insert failure rolls back the status update and creates no event', { concurrency: false }, async () => {
  const { db, profileA, auditFailureOrder } = await fixture()
  await assert.rejects(() => transitionEatsOrderForOperator(db, profileA, auditFailureOrder, 'accepted', 999999999, 'invalid actor'), /FOREIGN KEY|constraint/i)
  const order = await db.prepare('SELECT status FROM eats_orders WHERE id = ?').bind(auditFailureOrder).first()
  const events = await db.prepare('SELECT COUNT(*) AS count FROM eats_order_status_events WHERE order_id = ?').bind(auditFailureOrder).first()
  assert.equal(order.status, 'new')
  assert.equal(events.count, 0)
})

test('status-update race failure creates no audit event', { concurrency: false }, async () => {
  const { db, profileA, raceOrder, operatorA } = await fixture()
  let injected = false
  const racingDb = {
    prepare(sql) {
      const statement = db.prepare(sql)
      if (!sql.includes('FROM eats_orders eo')) return statement
      return {
        bind(...values) {
          const bound = statement.bind(...values)
          return {
            async first(...args) {
              const row = await bound.first(...args)
              if (!injected && row?.id === raceOrder) {
                injected = true
                await db.prepare("UPDATE eats_orders SET status = 'accepted' WHERE id = ?").bind(raceOrder).run()
              }
              return row
            },
          }
        },
      }
    },
    batch: db.batch.bind(db),
  }
  await assert.rejects(() => transitionEatsOrderForOperator(racingDb, profileA, raceOrder, 'accepted', operatorA), EatsOperatorStateError)
  const events = await db.prepare('SELECT COUNT(*) AS count FROM eats_order_status_events WHERE order_id = ?').bind(raceOrder).first()
  assert.equal(events.count, 0)
})
