import assert from 'node:assert/strict'
import test from 'node:test'
import { getTestDb, disposeTestDb, RUN_NONCE, createTestUser } from './payment-engine/helpers/db.mjs'
import { offerNextEatsCourier, getEatsCourierOffersForUser, respondToEatsCourierOffer, expireEatsCourierOffers, listEligibleEatsCouriers, requestEatsDeliveryOtp, completeEatsDelivery } from '../src/lib/eats-courier-dispatch.ts'

let fixturePromise
async function fixture() {
  if (fixturePromise) return fixturePromise
  fixturePromise = (async () => {
    const db = await getTestDb()
    const customer = await createTestUser(`eats_courier_customer_${RUN_NONCE}`)
    const courierA = await createTestUser(`eats_courier_a_${RUN_NONCE}`)
    const courierB = await createTestUser(`eats_courier_b_${RUN_NONCE}`)
    const restaurant = await db.prepare('SELECT id FROM restaurants LIMIT 1').first()
    const zone = await db.prepare("SELECT country_iso,key FROM delivery_zones WHERE is_active=1 LIMIT 1").first()
    assert.ok(restaurant && zone)
    const driverA = Number((await db.prepare("INSERT INTO driver_profiles(user_id,license_number,country_iso,status,is_online,operational_status) VALUES(?,?,'NG','active',1,'available')").bind(courierA, `EATS-LIC-${RUN_NONCE}-A`).run()).meta.last_row_id)
    const driverB = Number((await db.prepare("INSERT INTO driver_profiles(user_id,license_number,country_iso,status,is_online,operational_status) VALUES(?,?,'NG','active',1,'available')").bind(courierB, `EATS-LIC-${RUN_NONCE}-B`).run()).meta.last_row_id)
    await db.batch([
      db.prepare('INSERT INTO eats_courier_zone_permissions(driver_id,country_iso,zone_key) VALUES(?,?,?)').bind(driverA, zone.country_iso, zone.key),
      db.prepare('INSERT INTO eats_courier_zone_permissions(driver_id,country_iso,zone_key) VALUES(?,?,?)').bind(driverB, zone.country_iso, zone.key),
    ])
    async function makeFulfillment(suffix) {
      const orderId = Number((await db.prepare("INSERT INTO eats_orders(order_number,customer_user_id,restaurant_id,status,payment_status,subtotal_kobo,total_kobo,currency,shipping_name,shipping_phone,shipping_address,shipping_city,shipping_state) VALUES(?,?,?,'ready','escrow_held',1000,1000,'NGN','Recipient','0800','Address',?,?)").bind(`EATS-COURIER-${RUN_NONCE}-${suffix}`, customer, restaurant.id, zone.key, zone.key).run()).meta.last_row_id)
      const shipmentId = Number((await db.prepare("INSERT INTO shipments(tracking_number,shipment_type,fulfillment_category,customer_user_id,vehicle_type_id,speed_tier,origin_country_iso,destination_country_iso,origin_zone_key,destination_zone_key,quoted_price_kobo) VALUES(?,?,?,?,1,'same_day','NG','NG',?,?,100)").bind(`TRK-EATS-${RUN_NONCE}-${suffix}`, 'standalone', 'food', customer, zone.key, zone.key).run()).meta.last_row_id)
      const fulfillmentId = Number((await db.prepare("INSERT INTO eats_order_fulfillments(order_id,shipment_id,dispatch_status,dispatch_outcome) VALUES(?,?, 'dispatch_requested','pending')").bind(orderId, shipmentId).run()).meta.last_row_id)
      const jobId = Number((await db.prepare("INSERT INTO delivery_jobs(shipment_id,status) VALUES(?,'unassigned')").bind(shipmentId).run()).meta.last_row_id)
      return { orderId, shipmentId, fulfillmentId, jobId }
    }
    async function resetDrivers() {
      await db.prepare("UPDATE driver_profiles SET is_online=1, operational_status='available' WHERE id IN (?,?)").bind(driverA, driverB).run()
    }
    return { db, customer, courierA, courierB, driverA, driverB, zone, makeFulfillment, resetDrivers }
  })()
  return fixturePromise
}

test.after(async () => {
  const db = await getTestDb()
  await db.batch([
    db.prepare('DELETE FROM eats_fulfillment_events WHERE fulfillment_id IN (SELECT id FROM eats_order_fulfillments WHERE order_id IN (SELECT id FROM eats_orders WHERE order_number LIKE ?))').bind(`EATS-COURIER-${RUN_NONCE}%`),
    db.prepare('DELETE FROM eats_courier_offers WHERE fulfillment_id IN (SELECT id FROM eats_order_fulfillments WHERE order_id IN (SELECT id FROM eats_orders WHERE order_number LIKE ?))').bind(`EATS-COURIER-${RUN_NONCE}%`),
    db.prepare('DELETE FROM eats_order_fulfillments WHERE order_id IN (SELECT id FROM eats_orders WHERE order_number LIKE ?)').bind(`EATS-COURIER-${RUN_NONCE}%`),
    db.prepare('DELETE FROM delivery_attempts WHERE job_id IN (SELECT id FROM delivery_jobs WHERE shipment_id IN (SELECT id FROM shipments WHERE tracking_number LIKE ?))').bind(`TRK-EATS-${RUN_NONCE}%`),
    db.prepare('DELETE FROM delivery_jobs WHERE shipment_id IN (SELECT id FROM shipments WHERE tracking_number LIKE ?)').bind(`TRK-EATS-${RUN_NONCE}%`),
    db.prepare('DELETE FROM shipment_status_events WHERE shipment_id IN (SELECT id FROM shipments WHERE tracking_number LIKE ?)').bind(`TRK-EATS-${RUN_NONCE}%`),
    db.prepare('DELETE FROM shipments WHERE tracking_number LIKE ?').bind(`TRK-EATS-${RUN_NONCE}%`),
    db.prepare('DELETE FROM eats_orders WHERE order_number LIKE ?').bind(`EATS-COURIER-${RUN_NONCE}%`),
    db.prepare('DELETE FROM eats_courier_zone_permissions WHERE driver_id IN (SELECT id FROM driver_profiles WHERE license_number LIKE ?)').bind(`EATS-LIC-${RUN_NONCE}%`),
    db.prepare('DELETE FROM driver_profiles WHERE license_number LIKE ?').bind(`EATS-LIC-${RUN_NONCE}%`),
    db.prepare('DELETE FROM users WHERE email LIKE ?').bind(`eats_courier_%_${RUN_NONCE}%`),
  ])
  await disposeTestDb()
})

test('eligibility requires active online courier with an explicit permitted delivery zone', { concurrency: false }, async () => {
  const { db, driverA, fulfillmentId } = await (async () => { const f = await fixture(); await f.resetDrivers(); const x = await f.makeFulfillment('ELIG'); return { ...f, ...x } })()
  const eligible = await listEligibleEatsCouriers(db, fulfillmentId)
  assert.ok(eligible.some((row) => row.id === driverA))
  await db.prepare("UPDATE driver_profiles SET is_online=0 WHERE id=?").bind(driverA).run()
  assert.ok(!(await listEligibleEatsCouriers(db, fulfillmentId)).some((row) => row.id === driverA))
})

test('offer inbox is courier-scoped and rejection excludes the courier before reassignment', { concurrency: false }, async () => {
  const f = await fixture(); await f.resetDrivers(); const x = await f.makeFulfillment('REJECT')
  const first = await offerNextEatsCourier(f.db, x.fulfillmentId, f.customer, 'operator')
  assert.ok(first)
  const offerRow = await f.db.prepare('SELECT eco.courier_driver_id,dp.user_id FROM eats_courier_offers eco JOIN driver_profiles dp ON dp.id=eco.courier_driver_id WHERE eco.id=?').bind(first.offerId).first()
  const firstCourierUser = offerRow.user_id
  const inbox = await getEatsCourierOffersForUser(f.db, firstCourierUser)
  assert.equal(inbox.length, 1)
  const response = await respondToEatsCourierOffer(f.db, first.offerId, firstCourierUser, 'reject', 'Too far')
  assert.ok(response.next)
  const nextRow = await f.db.prepare('SELECT dp.user_id FROM eats_courier_offers eco JOIN driver_profiles dp ON dp.id=eco.courier_driver_id WHERE eco.id=?').bind(response.next.offerId).first()
  const secondInbox = await getEatsCourierOffersForUser(f.db, nextRow.user_id)
  assert.equal(secondInbox.length, 1)
  const old = await f.db.prepare('SELECT status FROM eats_courier_offers WHERE id=?').bind(first.offerId).first()
  assert.equal(old.status, 'rejected')
})

test('acceptance is conditional, assigns the delivery job, and expired offers cannot be accepted', { concurrency: false }, async () => {
  const f = await fixture(); await f.resetDrivers(); const x = await f.makeFulfillment('ACCEPT')
  const offer = await offerNextEatsCourier(f.db, x.fulfillmentId, f.customer, 'operator')
  const acceptedCourier = await f.db.prepare('SELECT eco.courier_driver_id,dp.user_id FROM eats_courier_offers eco JOIN driver_profiles dp ON dp.id=eco.courier_driver_id WHERE eco.id=?').bind(offer.offerId).first()
  const accepted = await respondToEatsCourierOffer(f.db, offer.offerId, acceptedCourier.user_id, 'accept')
  assert.equal(accepted.accepted, true)
  const job = await f.db.prepare('SELECT driver_id,status FROM delivery_jobs WHERE id=?').bind(x.jobId).first()
  assert.deepEqual(job, { driver_id: acceptedCourier.courier_driver_id, status: 'assigned' })
  await assert.rejects(() => respondToEatsCourierOffer(f.db, offer.offerId, acceptedCourier.user_id, 'accept'), /stale|expired|available/i)
  await f.db.batch([
    f.db.prepare("UPDATE delivery_jobs SET status='arrived' WHERE id=?").bind(x.jobId),
    f.db.prepare("UPDATE shipments SET status='arrived_dropoff' WHERE id=?").bind(x.shipmentId),
  ])
  const otp = await requestEatsDeliveryOtp(f.db, x.jobId, acceptedCourier.courier_driver_id)
  await completeEatsDelivery(f.db, x.jobId, acceptedCourier.courier_driver_id, otp)
  const delivered = await f.db.prepare('SELECT dispatch_outcome,proof_type FROM eats_order_fulfillments WHERE id=?').bind(x.fulfillmentId).first()
  assert.deepEqual(delivered, { dispatch_outcome: 'delivered', proof_type: 'otp' })
  await assert.rejects(() => completeEatsDelivery(f.db, x.jobId, acceptedCourier.courier_driver_id, otp), /already|Only/i)

  const y = await f.makeFulfillment('EXPIRE')
  const expiring = await offerNextEatsCourier(f.db, y.fulfillmentId, f.customer, 'operator')
  await f.db.prepare("UPDATE eats_courier_offers SET expires_at=datetime('now','-1 minute') WHERE id=?").bind(expiring.offerId).run()
  const next = await expireEatsCourierOffers(f.db, y.fulfillmentId)
  assert.ok(next)
  const recoveredOpen = await f.db.prepare('SELECT dispatch_outcome FROM eats_order_fulfillments WHERE id=?').bind(y.fulfillmentId).first()
  assert.equal(recoveredOpen.dispatch_outcome, 'offers_open')
  const old = await f.db.prepare('SELECT status FROM eats_courier_offers WHERE id=?').bind(expiring.offerId).first()
  assert.equal(old.status, 'expired')
})
