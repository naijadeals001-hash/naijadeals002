import assert from 'node:assert/strict'
import test from 'node:test'
import { getTestDb, disposeTestDb, RUN_NONCE, createTestUser } from './payment-engine/helpers/db.mjs'
import {
  offerNextEatsCourier,
  getEatsCourierOffersForUser,
  respondToEatsCourierOffer,
  expireEatsCourierOffers,
  listEligibleEatsCouriers,
  requestEatsDeliveryOtp,
  completeEatsDelivery,
} from '../src/lib/eats-courier-dispatch.ts'

const CLEANUP_TIMEOUT_MS = 5_000

function withTimeout(label, promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`EATS courier fixture cleanup timed out during ${label} after ${CLEANUP_TIMEOUT_MS}ms`)), CLEANUP_TIMEOUT_MS)),
  ])
}

async function createFixture(scope) {
  const db = await getTestDb()
  const customer = await createTestUser(`eats_courier_customer_${RUN_NONCE}_${scope}`)
  const courierA = await createTestUser(`eats_courier_a_${RUN_NONCE}_${scope}`)
  const courierB = await createTestUser(`eats_courier_b_${RUN_NONCE}_${scope}`)
  const courierC = await createTestUser(`eats_courier_c_${RUN_NONCE}_${scope}`)
  const restaurant = await db.prepare('SELECT id FROM restaurants LIMIT 1').first()
  const zone = await db.prepare("SELECT country_iso,key FROM delivery_zones WHERE is_active=1 LIMIT 1").first()
  assert.ok(restaurant && zone, 'local fixture requires a restaurant and active delivery zone')
  const driverA = Number((await db.prepare("INSERT INTO driver_profiles(user_id,license_number,country_iso,status,is_online,operational_status) VALUES(?,?,?,'active',1,'available')").bind(courierA, `EATS-LIC-${RUN_NONCE}-${scope}-A`, zone.country_iso).run()).meta.last_row_id)
  const driverB = Number((await db.prepare("INSERT INTO driver_profiles(user_id,license_number,country_iso,status,is_online,operational_status) VALUES(?,?,?,'active',1,'available')").bind(courierB, `EATS-LIC-${RUN_NONCE}-${scope}-B`, zone.country_iso).run()).meta.last_row_id)
  const driverC = Number((await db.prepare("INSERT INTO driver_profiles(user_id,license_number,country_iso,status,is_online,operational_status) VALUES(?,?,?,'active',1,'available')").bind(courierC, `EATS-LIC-${RUN_NONCE}-${scope}-C`, zone.country_iso).run()).meta.last_row_id)
  await db.batch([
    db.prepare('INSERT INTO eats_courier_zone_permissions(driver_id,country_iso,zone_key) VALUES(?,?,?)').bind(driverA, zone.country_iso, zone.key),
    db.prepare('INSERT INTO eats_courier_zone_permissions(driver_id,country_iso,zone_key) VALUES(?,?,?)').bind(driverB, zone.country_iso, zone.key),
    db.prepare('INSERT INTO eats_courier_zone_permissions(driver_id,country_iso,zone_key) VALUES(?,?,?)').bind(driverC, zone.country_iso, zone.key),
  ])

  const created = { orderIds: [], shipmentIds: [], fulfillmentIds: [], jobIds: [] }
  async function makeFulfillment(suffix) {
    const orderId = Number((await db.prepare("INSERT INTO eats_orders(order_number,customer_user_id,restaurant_id,status,payment_status,subtotal_kobo,total_kobo,currency,shipping_name,shipping_phone,shipping_address,shipping_city,shipping_state) VALUES(?,?,?,'ready','escrow_held',1000,1000,'NGN','Recipient','0800','Address',?,?)").bind(`EATS-COURIER-${RUN_NONCE}-${scope}-${suffix}`, customer, restaurant.id, zone.key, zone.key).run()).meta.last_row_id)
    const shipmentId = Number((await db.prepare("INSERT INTO shipments(tracking_number,shipment_type,fulfillment_category,customer_user_id,vehicle_type_id,speed_tier,origin_country_iso,destination_country_iso,origin_zone_key,destination_zone_key,quoted_price_kobo) VALUES(?,?,?,?,1,'same_day',?,?,?,?,100)").bind(`TRK-EATS-${RUN_NONCE}-${scope}-${suffix}`, 'standalone', 'food', customer, zone.country_iso, zone.country_iso, zone.key, zone.key).run()).meta.last_row_id)
    const fulfillmentId = Number((await db.prepare("INSERT INTO eats_order_fulfillments(order_id,shipment_id,dispatch_status,dispatch_outcome) VALUES(?,?, 'dispatch_requested','pending')").bind(orderId, shipmentId).run()).meta.last_row_id)
    const jobId = Number((await db.prepare("INSERT INTO delivery_jobs(shipment_id,status) VALUES(?,'unassigned')").bind(shipmentId).run()).meta.last_row_id)
    created.orderIds.push(orderId); created.shipmentIds.push(shipmentId); created.fulfillmentIds.push(fulfillmentId); created.jobIds.push(jobId)
    return { orderId, shipmentId, fulfillmentId, jobId }
  }

  return { db, userIds: [customer, courierA, courierB, courierC], customer, courierA, courierB, courierC, driverA, driverB, driverC, zone, makeFulfillment, created }
}

async function cleanupFixture(fixture, scope) {
  const { db, userIds } = fixture
  const createdFulfillments = fixture.created.fulfillmentIds
  const createdJobs = fixture.created.jobIds
  const createdShipments = fixture.created.shipmentIds
  const createdOrders = fixture.created.orderIds
  const statements = [
    ['fulfillment events', 'DELETE FROM eats_fulfillment_events WHERE fulfillment_id IN (' + createdFulfillments.map(() => '?').join(',') + ')', createdFulfillments],
    ['offers', 'DELETE FROM eats_courier_offers WHERE fulfillment_id IN (' + createdFulfillments.map(() => '?').join(',') + ')', createdFulfillments],
    ['delivery attempts', 'DELETE FROM delivery_attempts WHERE job_id IN (' + createdJobs.map(() => '?').join(',') + ')', createdJobs],
    ['fulfillments', 'DELETE FROM eats_order_fulfillments WHERE id IN (' + createdFulfillments.map(() => '?').join(',') + ')', createdFulfillments],
    ['delivery jobs', 'DELETE FROM delivery_jobs WHERE id IN (' + createdJobs.map(() => '?').join(',') + ')', createdJobs],
    ['shipment events', 'DELETE FROM shipment_status_events WHERE shipment_id IN (' + createdShipments.map(() => '?').join(',') + ')', createdShipments],
    ['shipments', 'DELETE FROM shipments WHERE id IN (' + createdShipments.map(() => '?').join(',') + ')', createdShipments],
    ['orders', 'DELETE FROM eats_orders WHERE id IN (' + createdOrders.map(() => '?').join(',') + ')', createdOrders],
    ['zone permissions', 'DELETE FROM eats_courier_zone_permissions WHERE driver_id IN (?,?,?)', [fixture.driverA, fixture.driverB, fixture.driverC]],
    ['driver profiles', 'DELETE FROM driver_profiles WHERE id IN (?,?,?)', [fixture.driverA, fixture.driverB, fixture.driverC]],
    ['users', 'DELETE FROM users WHERE id IN (?,?,?,?)', userIds],
  ]
  for (const [phase, sql, values] of statements) {
    await withTimeout(phase, db.prepare(sql).bind(...values).run())
  }
}

async function withFixture(name, fn) {
  const scope = `${name}-${Math.random().toString(36).slice(2, 10)}`
  const fixture = await createFixture(scope)
  try {
    return await fn(fixture)
  } finally {
    await cleanupFixture(fixture, scope)
  }
}

test('eligibility requires active online courier with an explicit permitted delivery zone', { concurrency: false }, () => withFixture('eligibility', async (f) => {
  const order = await f.makeFulfillment('one')
  const eligible = await listEligibleEatsCouriers(f.db, order.fulfillmentId)
  assert.ok(eligible.some((row) => row.id === f.driverA))
  await f.db.prepare('UPDATE driver_profiles SET is_online=0 WHERE id=?').bind(f.driverA).run()
  assert.ok(!(await listEligibleEatsCouriers(f.db, order.fulfillmentId)).some((row) => row.id === f.driverA))
}))

test('offer inbox is courier-scoped and rejection excludes the courier before reassignment', { concurrency: false }, () => withFixture('offers', async (f) => {
  const order = await f.makeFulfillment('one')
  const first = await offerNextEatsCourier(f.db, order.fulfillmentId, f.customer, 'operator')
  assert.ok(first)
  const firstRow = await f.db.prepare('SELECT eco.courier_driver_id,dp.user_id FROM eats_courier_offers eco JOIN driver_profiles dp ON dp.id=eco.courier_driver_id WHERE eco.id=?').bind(first.offerId).first()
  assert.ok(firstRow)
  const firstInbox = await getEatsCourierOffersForUser(f.db, firstRow.user_id)
  const currentOrder = await f.db.prepare('SELECT order_number FROM eats_orders WHERE id=?').bind(order.orderId).first()
  assert.ok(firstInbox.some((item) => item.order_number === currentOrder.order_number))
  const response = await respondToEatsCourierOffer(f.db, first.offerId, firstRow.user_id, 'reject', 'Too far')
  assert.ok(response.next)
  const nextRow = await f.db.prepare('SELECT dp.user_id FROM eats_courier_offers eco JOIN driver_profiles dp ON dp.id=eco.courier_driver_id WHERE eco.id=?').bind(response.next.offerId).first()
  assert.ok(nextRow)
  const nextInbox = await getEatsCourierOffersForUser(f.db, nextRow.user_id)
  assert.ok(nextInbox.some((item) => item.order_number === currentOrder.order_number))
  assert.equal((await f.db.prepare('SELECT status FROM eats_courier_offers WHERE id=?').bind(first.offerId).first()).status, 'rejected')
}))

test('acceptance is conditional and expired offers reassign without stale acceptance', { concurrency: false }, () => withFixture('acceptance', async (f) => {
  const order = await f.makeFulfillment('accept')
  const offer = await offerNextEatsCourier(f.db, order.fulfillmentId, f.customer, 'operator')
  const courier = await f.db.prepare('SELECT eco.courier_driver_id,dp.user_id FROM eats_courier_offers eco JOIN driver_profiles dp ON dp.id=eco.courier_driver_id WHERE eco.id=?').bind(offer.offerId).first()
  const accepted = await respondToEatsCourierOffer(f.db, offer.offerId, courier.user_id, 'accept')
  assert.equal(accepted.accepted, true)
  assert.deepEqual(await f.db.prepare('SELECT driver_id,status FROM delivery_jobs WHERE id=?').bind(order.jobId).first(), { driver_id: courier.courier_driver_id, status: 'assigned' })
  await assert.rejects(() => respondToEatsCourierOffer(f.db, offer.offerId, courier.user_id, 'accept'), /stale|expired|available/i)

  const expiringOrder = await f.makeFulfillment('expiry')
  const expiring = await offerNextEatsCourier(f.db, expiringOrder.fulfillmentId, f.customer, 'operator')
  await f.db.prepare("UPDATE eats_courier_offers SET expires_at=datetime('now','-1 minute') WHERE id=?").bind(expiring.offerId).run()
  const next = await expireEatsCourierOffers(f.db, expiringOrder.fulfillmentId)
  assert.ok(next)
  assert.equal((await f.db.prepare('SELECT status FROM eats_courier_offers WHERE id=?').bind(expiring.offerId).first()).status, 'expired')
}))

test('OTP proof completes delivery exactly once and rejects repeat completion', { concurrency: false }, () => withFixture('proof', async (f) => {
  const order = await f.makeFulfillment('proof')
  const offer = await offerNextEatsCourier(f.db, order.fulfillmentId, f.customer, 'operator')
  const courier = await f.db.prepare('SELECT dp.user_id,eco.courier_driver_id FROM eats_courier_offers eco JOIN driver_profiles dp ON dp.id=eco.courier_driver_id WHERE eco.id=?').bind(offer.offerId).first()
  await respondToEatsCourierOffer(f.db, offer.offerId, courier.user_id, 'accept')
  await f.db.batch([
    f.db.prepare("UPDATE delivery_jobs SET status='arrived' WHERE id=?").bind(order.jobId),
    f.db.prepare("UPDATE shipments SET status='arrived_dropoff' WHERE id=?").bind(order.shipmentId),
  ])
  const otp = await requestEatsDeliveryOtp(f.db, order.jobId, courier.courier_driver_id)
  await completeEatsDelivery(f.db, order.jobId, courier.courier_driver_id, otp)
  assert.deepEqual(await f.db.prepare('SELECT dispatch_outcome,proof_type FROM eats_order_fulfillments WHERE id=?').bind(order.fulfillmentId).first(), { dispatch_outcome: 'delivered', proof_type: 'otp' })
  await assert.rejects(() => completeEatsDelivery(f.db, order.jobId, courier.courier_driver_id, otp), /already|Only/i)
}))

test.after(async () => { await disposeTestDb() })
