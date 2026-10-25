import { acceptJob, assignDriverToJob, getJobForDriver, type JobType } from './logistics-dispatch'
import { completeJob, generateDeliveryOtp, markJobArrived, markJobEnRoute } from './logistics-delivery'

export const EATS_OFFER_TTL_MINUTES = 10
export const EATS_MAX_REASSIGNMENTS = 5

export class EatsCourierDispatchError extends Error {}

async function event(db: D1Database, fulfillmentId: number, eventType: string, actorUserId: number | null, actorRole: string, metadata: Record<string, unknown> = {}) {
  await db.prepare(`INSERT INTO eats_fulfillment_events (fulfillment_id,event_type,actor_user_id,actor_role,metadata_json) VALUES (?,?,?,?,?)`)
    .bind(fulfillmentId, eventType, actorUserId, actorRole, JSON.stringify(metadata)).run()
}

async function fulfillmentForJob(db: D1Database, deliveryJobId: number) {
  return db.prepare(`SELECT eof.*, dj.status AS delivery_job_status, s.destination_zone_key, s.origin_zone_key, s.origin_country_iso
    FROM eats_order_fulfillments eof JOIN delivery_jobs dj ON dj.shipment_id = eof.shipment_id
    JOIN shipments s ON s.id = eof.shipment_id WHERE dj.id = ?`).bind(deliveryJobId).first<any>()
}

export async function listEligibleEatsCouriers(db: D1Database, fulfillmentId: number, limit = 20) {
  const fulfillment = await db.prepare(`SELECT eof.id, s.origin_country_iso, s.destination_zone_key, s.vehicle_type_id
    FROM eats_order_fulfillments eof JOIN shipments s ON s.id = eof.shipment_id WHERE eof.id = ?`).bind(fulfillmentId).first<any>()
  if (!fulfillment) throw new EatsCourierDispatchError('Fulfillment not found')
  const { results } = await db.prepare(`SELECT dp.id, dp.user_id, dp.country_iso, dp.rating_avg
    FROM driver_profiles dp
    JOIN eats_courier_zone_permissions ez ON ez.driver_id = dp.id AND ez.country_iso = dp.country_iso AND ez.zone_key = ? AND ez.is_active = 1
    WHERE dp.country_iso = ? AND dp.status = 'active' AND dp.is_online = 1 AND dp.operational_status = 'available'
      AND NOT EXISTS (SELECT 1 FROM eats_courier_offers old WHERE old.fulfillment_id = ? AND old.courier_driver_id = dp.id AND old.status IN ('rejected','expired','superseded'))
    ORDER BY dp.rating_avg DESC, dp.id ASC LIMIT ?`).bind(fulfillment.destination_zone_key, fulfillment.origin_country_iso, fulfillmentId, limit).all<any>()
  return results
}

export async function offerNextEatsCourier(db: D1Database, fulfillmentId: number, actorUserId: number | null, actorRole: string) {
  const fulfillment = await db.prepare(`SELECT eof.*, dj.id AS delivery_job_id, s.destination_zone_key
    FROM eats_order_fulfillments eof JOIN delivery_jobs dj ON dj.shipment_id = eof.shipment_id
    JOIN shipments s ON s.id = eof.shipment_id WHERE eof.id = ?`).bind(fulfillmentId).first<any>()
  if (!fulfillment) throw new EatsCourierDispatchError('Fulfillment not found')
  if (fulfillment.dispatch_outcome === 'delivered' || fulfillment.courier_driver_id) throw new EatsCourierDispatchError('Fulfillment already has a courier or is delivered')
  const reassignmentCount = Number(fulfillment.reassignment_count ?? 0)
  if (reassignmentCount >= EATS_MAX_REASSIGNMENTS) {
    await db.prepare(`UPDATE eats_order_fulfillments SET dispatch_outcome='no_courier_available', updated_at=datetime('now') WHERE id=? AND courier_driver_id IS NULL`).bind(fulfillmentId).run()
    await event(db, fulfillmentId, 'no_courier_available', actorUserId, actorRole, { reason: 'retry_limit_exhausted' })
    return null
  }
  const [candidate] = await listEligibleEatsCouriers(db, fulfillmentId, 1)
  if (!candidate) {
    // A temporarily empty eligible pool is retryable. Persist the terminal
    // no_courier_available state only after EATS_MAX_REASSIGNMENTS is exhausted
    // above; operators can then retry without falsely claiming a terminal miss.
    await db.prepare(`UPDATE eats_order_fulfillments SET dispatch_outcome='offers_open', updated_at=datetime('now') WHERE id=? AND courier_driver_id IS NULL AND dispatch_outcome <> 'delivered'`).bind(fulfillmentId).run()
    await event(db, fulfillmentId, 'courier_matching_retryable', actorUserId, actorRole, { reason: 'eligible_pool_empty', reassignment_count: reassignmentCount })
    return null
  }
  const expiresAt = new Date(Date.now() + EATS_OFFER_TTL_MINUTES * 60_000).toISOString()
  const offer = await db.prepare(`INSERT INTO eats_courier_offers (fulfillment_id,delivery_job_id,courier_driver_id,expires_at) VALUES (?,?,?,?)`)
    .bind(fulfillmentId, fulfillment.delivery_job_id, candidate.id, expiresAt).run()
  await db.prepare(`UPDATE eats_order_fulfillments SET dispatch_outcome='offers_open', reassignment_count=COALESCE(reassignment_count,0)+1, updated_at=datetime('now') WHERE id=? AND courier_driver_id IS NULL`).bind(fulfillmentId).run()
  await event(db, fulfillmentId, 'courier_offer_created', actorUserId, actorRole, { offer_id: offer.meta.last_row_id, courier_driver_id: candidate.id, expires_at: expiresAt, destination_zone: fulfillment.destination_zone_key })
  return { offerId: Number(offer.meta.last_row_id), courierDriverId: candidate.id, expiresAt }
}

export async function expireEatsCourierOffers(db: D1Database, fulfillmentId: number, actorUserId: number | null = null) {
  const { results } = await db.prepare(`SELECT id FROM eats_courier_offers WHERE fulfillment_id=? AND status='offered' AND expires_at <= datetime('now')`).bind(fulfillmentId).all<{ id: number }>()
  for (const row of results) {
    const changed = await db.prepare(`UPDATE eats_courier_offers SET status='expired', responded_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='offered'`).bind(row.id).run()
    if (changed.meta.rows_written) await event(db, fulfillmentId, 'courier_offer_expired', actorUserId, 'system', { offer_id: row.id })
  }
  if (results.length) return offerNextEatsCourier(db, fulfillmentId, actorUserId, 'system')
  return null
}

export async function getEatsCourierOffersForUser(db: D1Database, userId: number) {
  await db.prepare(`UPDATE eats_courier_offers SET status='expired', responded_at=datetime('now'), updated_at=datetime('now') WHERE status='offered' AND expires_at <= datetime('now') AND courier_driver_id IN (SELECT id FROM driver_profiles WHERE user_id=?)`).bind(userId).run()
  const { results } = await db.prepare(`SELECT eco.id, eco.status, eco.expires_at, eco.created_at, eco.rejection_reason,
    eof.dispatch_outcome, eo.order_number, s.origin_zone_key, s.destination_zone_key, s.origin_country_iso
    FROM eats_courier_offers eco JOIN driver_profiles dp ON dp.id=eco.courier_driver_id AND dp.user_id=?
    JOIN eats_order_fulfillments eof ON eof.id=eco.fulfillment_id JOIN eats_orders eo ON eo.id=eof.order_id
    JOIN shipments s ON s.id=eof.shipment_id ORDER BY eco.id DESC LIMIT 50`).bind(userId).all<any>()
  return results
}

export async function respondToEatsCourierOffer(db: D1Database, offerId: number, userId: number, decision: 'accept' | 'reject', reason?: string) {
  const offer = await db.prepare(`SELECT eco.*, dp.user_id, eof.dispatch_outcome FROM eats_courier_offers eco JOIN driver_profiles dp ON dp.id=eco.courier_driver_id JOIN eats_order_fulfillments eof ON eof.id=eco.fulfillment_id WHERE eco.id=? AND dp.user_id=?`).bind(offerId, userId).first<any>()
  if (!offer) throw new EatsCourierDispatchError('Offer not found or not accessible')
  if (offer.status !== 'offered' || new Date(offer.expires_at).getTime() <= Date.now()) throw new EatsCourierDispatchError('Offer is stale or expired')
  if (decision === 'reject') {
    const changed = await db.prepare(`UPDATE eats_courier_offers SET status='rejected', rejection_reason=?, responded_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='offered'`).bind(reason?.slice(0, 200) ?? 'Courier declined', offerId).run()
    if (!changed.meta.rows_written) throw new EatsCourierDispatchError('Offer is no longer available')
    await event(db, offer.fulfillment_id, 'courier_offer_rejected', userId, 'courier', { offer_id: offerId, reason: reason ?? null })
    return { accepted: false, next: await offerNextEatsCourier(db, offer.fulfillment_id, userId, 'courier') }
  }
  const claimed = await db.prepare(`UPDATE eats_courier_offers SET status='accepted', responded_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='offered' AND expires_at > datetime('now')`).bind(offerId).run()
  if (!claimed.meta.rows_written) throw new EatsCourierDispatchError('Offer was claimed by another action or expired')
  const assigned = await db.prepare(`UPDATE delivery_jobs SET driver_id=?, status='assigned', assigned_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='unassigned' AND driver_id IS NULL`).bind(offer.courier_driver_id, offer.delivery_job_id).run()
  if (!assigned.meta.rows_written) {
    await db.prepare(`UPDATE eats_courier_offers SET status='superseded', updated_at=datetime('now') WHERE id=? AND status='accepted'`).bind(offerId).run()
    throw new EatsCourierDispatchError('Delivery job is already assigned')
  }
  await db.prepare(`UPDATE eats_order_fulfillments SET courier_driver_id=?, dispatch_outcome='courier_assigned', updated_at=datetime('now') WHERE id=? AND courier_driver_id IS NULL`).bind(offer.courier_driver_id, offer.fulfillment_id).run()
  await db.prepare(`UPDATE driver_profiles SET operational_status='assigned', updated_at=datetime('now') WHERE id=?`).bind(offer.courier_driver_id).run()
  await event(db, offer.fulfillment_id, 'courier_offer_accepted', userId, 'courier', { offer_id: offerId, courier_driver_id: offer.courier_driver_id })
  return { accepted: true, deliveryJobId: offer.delivery_job_id }
}

export async function markEatsCourierJob(db: D1Database, deliveryJobId: number, driverId: number, action: 'accept' | 'en_route' | 'arrived' | 'pickup_complete') {
  const fulfillment = await fulfillmentForJob(db, deliveryJobId)
  if (!fulfillment || fulfillment.courier_driver_id !== driverId) throw new EatsCourierDispatchError('Courier is not authorized for this delivery')
  if (action === 'accept') await acceptJob(db, 'delivery', deliveryJobId, driverId)
  else if (action === 'en_route') await markJobEnRoute(db, 'delivery', deliveryJobId, driverId)
  else if (action === 'arrived') await markJobArrived(db, 'delivery', deliveryJobId, driverId)
  else {
    const job = await getJobForDriver(db, 'delivery', deliveryJobId, driverId)
    if (!job || !['arrived','en_route','accepted'].includes(job.status)) throw new EatsCourierDispatchError('Courier must be at the dropoff before pickup/delivery completion')
    await db.prepare(`UPDATE eats_order_fulfillments SET dispatch_outcome='out_for_delivery', updated_at=datetime('now') WHERE id=?`).bind(fulfillment.id).run()
  }
  const outcome = action === 'en_route' ? 'out_for_delivery' : action === 'arrived' ? 'out_for_delivery' : action === 'pickup_complete' ? 'picked_up' : 'courier_assigned'
  await db.prepare(`UPDATE eats_order_fulfillments SET dispatch_outcome=?, updated_at=datetime('now') WHERE id=?`).bind(outcome, fulfillment.id).run()
  await event(db, fulfillment.id, `courier_${action}`, null, 'courier', { delivery_job_id: deliveryJobId })
}

export async function requestEatsDeliveryOtp(db: D1Database, deliveryJobId: number, driverId: number) {
  const job = await getJobForDriver(db, 'delivery', deliveryJobId, driverId)
  if (!job || !['arrived','en_route'].includes(job.status)) throw new EatsCourierDispatchError('Courier must be en route or arrived before requesting proof')
  return generateDeliveryOtp(db, 'delivery', deliveryJobId)
}

export async function completeEatsDelivery(db: D1Database, deliveryJobId: number, driverId: number, otpCode: string) {
  const fulfillment = await fulfillmentForJob(db, deliveryJobId)
  const job = await getJobForDriver(db, 'delivery', deliveryJobId, driverId)
  if (!fulfillment || !job || fulfillment.courier_driver_id !== driverId || job.status !== 'arrived') throw new EatsCourierDispatchError('Only the assigned courier at the dropoff can complete delivery')
  if (fulfillment.dispatch_outcome === 'delivered') throw new EatsCourierDispatchError('Delivery proof was already recorded')
  await completeJob(db, 'delivery', deliveryJobId, driverId, { type: 'otp', otpCode })
  const changed = await db.prepare(`UPDATE eats_order_fulfillments SET dispatch_outcome='delivered', proof_type='otp', proof_recorded_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND dispatch_outcome <> 'delivered'`).bind(fulfillment.id).run()
  if (!changed.meta.rows_written) throw new EatsCourierDispatchError('Delivery proof was already recorded')
  await event(db, fulfillment.id, 'delivery_proof_recorded', null, 'courier', { delivery_job_id: deliveryJobId, proof_type: 'otp' })
}
