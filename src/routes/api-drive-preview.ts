import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { estimateDrivePreviewFare, type FareEstimateMode } from '../lib/drive-preview-fare'
import { validateDrivePreviewBooking } from '../lib/drive-preview'
import { requireAuth } from '../lib/auth'
import { getRideForCustomer, transitionRide, recoverExpiredRideOffers, reassignRideAfterOffer, DRIVER_OFFER_EXPIRY_MINUTES } from '../lib/drive-rides'
import { assertVerticalTransactionAllowed, RolloutGuardError } from '../lib/control-center-rollout'

export const drivePreviewApi = new Hono<AppEnv>()

/**
 * Fare estimate endpoint. Routed mode is strict: it never falls back to the
 * development fixture when a provider is unavailable.
 */
drivePreviewApi.post('/fare-estimate', async (c) => {
  const body = await c.req.json<{ pickupZone?: string; dropoffZone?: string; vehicleCategory?: string; mode?: FareEstimateMode }>().catch(() => null)
  if (body?.mode !== 'routed' && body?.mode !== 'simulated') {
    return c.json({ error: 'Choose an explicit routed or simulated estimate mode.', code: 'INVALID_ESTIMATE_MODE' }, 400)
  }
  const result = await estimateDrivePreviewFare(body, body.mode, c.env)
  if (!result.ok) return c.json({ error: result.error, code: result.code }, result.status)
  return c.json(result)
})

/**
 * This endpoint remains intentionally honest: it validates the preview form but
 * refuses to create a ride because the Cloudflare Worker does not own the
 * PostgreSQL/PostGIS/Redis NaijaDrive runtime.
 */
drivePreviewApi.post('/preview-booking', async (c) => {
  const body = await c.req.json<{ pickupZone?: string; dropoffZone?: string; vehicleCategory?: string }>().catch(() => null)
  const validation = validateDrivePreviewBooking(body)
  if (!validation.ok) return c.json({ error: validation.error, code: validation.code }, validation.status)
  return c.json({
    error: 'No booking was created. NaijaDrive dispatch is not connected to this Worker preview yet; the NestJS runtime still requires a persistent authorized host.',
    code: 'NAIJADRIVE_RUNTIME_UNAVAILABLE',
  }, 503)
})

// Persistent private-ride lifecycle. This D1-backed path is intentionally refresh/poll based;
// it never fabricates GPS, driver supply or provider payment success.
drivePreviewApi.post('/rides', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ pickupZone?: string; dropoffZone?: string; vehicleCategory?: string; idempotencyKey?: string }>().catch(() => null)
  const validation = validateDrivePreviewBooking(body)
  if (!validation.ok) return c.json({ error: validation.error, code: validation.code }, validation.status)
  try {
    await assertVerticalTransactionAllowed(c.env.DB, 'ecosystem.naijadrive', 'NG', body?.pickupZone)
  } catch (err) {
    if (err instanceof RolloutGuardError) return c.json({ error: err.message, code: err.code }, err.status as any)
    throw err
  }
  const idem = body?.idempotencyKey?.trim() || null
  if (idem && (idem.length < 8 || idem.length > 128)) return c.json({ error: 'idempotencyKey must be between 8 and 128 characters' }, 400)
  if (idem) {
    const existing = await c.env.DB.prepare('SELECT id,status,fare_kobo,currency,fare_mode FROM drive_ride_requests WHERE customer_user_id = ? AND idempotency_key = ?').bind(user.id, idem).first<any>()
    if (existing) return c.json({ ride: existing, replayed: true })
  }
  const fare = await estimateDrivePreviewFare(body, 'simulated', c.env)
  if (!fare.ok) return c.json({ error: fare.error, code: fare.code }, fare.status)
  const inserted = await c.env.DB.prepare(`INSERT INTO drive_ride_requests (customer_user_id,pickup_zone,dropoff_zone,vehicle_category,status,fare_kobo,currency,fare_mode,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?)`).bind(user.id, body!.pickupZone, body!.dropoffZone, body!.vehicleCategory || 'car', 'searching', fare.fareKobo, 'NGN', 'simulated', idem).run()
  const id = Number(inserted.meta.last_row_id)
  await c.env.DB.prepare('INSERT INTO drive_ride_events (ride_request_id,from_status,to_status,actor_user_id,actor_role,note) VALUES (?,?,?,?,?,?)').bind(id, null, 'searching', user.id, 'customer', 'Ride requested with simulated quote').run()
  return c.json({ ride: await getRideForCustomer(c.env.DB, id, user.id), quote: fare }, 201)
})

drivePreviewApi.get('/rides/:id', requireAuth, async (c) => {
  const ride = await getRideForCustomer(c.env.DB, Number(c.req.param('id')), c.get('user')!.id)
  if (!ride) return c.json({ error: 'Ride not found' }, 404)
  const events = await c.env.DB.prepare('SELECT * FROM drive_ride_events WHERE ride_request_id = ? ORDER BY id').bind(ride.id).all()
  return c.json({ ride, events: events.results })
})

drivePreviewApi.post('/rides/:id/cancel', requireAuth, async (c) => {
  const user = c.get('user')!
  const rideId = Number(c.req.param('id'))
  const ride = await getRideForCustomer(c.env.DB, rideId, user.id)
  if (!ride) return c.json({ error: 'Ride not found' }, 404)
  try { await transitionRide(c.env.DB, rideId, ['requested','searching','offered','accepted','driver_arriving','driver_arrived'], 'cancelled', user.id, 'customer', 'Cancelled by customer'); return c.json({ success: true, status: 'cancelled' }) } catch (err) { return c.json({ error: err instanceof Error ? err.message : 'Unable to cancel ride' }, 409) }
})

drivePreviewApi.get('/driver/availability', requireAuth, async (c) => {
  const user = c.get('user')!
  const driver = await c.env.DB.prepare("SELECT status,is_online,operational_status FROM driver_profiles WHERE user_id = ?").bind(user.id).first<any>()
  if (!driver || driver.status !== 'active') return c.json({ error: 'Active driver profile required' }, 403)
  return c.json({ online: driver.is_online === 1, operational_status: driver.operational_status })
})

drivePreviewApi.post('/driver/availability', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ online?: boolean }>().catch(() => null)
  if (typeof body?.online !== 'boolean') return c.json({ error: 'online must be boolean' }, 400)
  const driver = await c.env.DB.prepare("SELECT id,status,is_online FROM driver_profiles WHERE user_id = ?").bind(user.id).first<any>()
  if (!driver || driver.status !== 'active') return c.json({ error: 'Active driver profile required' }, 403)
  await c.env.DB.prepare("UPDATE driver_profiles SET is_online = ?, operational_status = ?, last_online_at = CASE WHEN ? = 1 THEN datetime('now') ELSE last_online_at END, updated_at = datetime('now') WHERE id = ?").bind(body.online ? 1 : 0, body.online ? 'available' : 'offline', body.online ? 1 : 0, driver.id).run()
  return c.json({ success: true, online: body.online })
})

drivePreviewApi.post('/rides/:id/offers', requireAuth, async (c) => {
  const user = c.get('user')!
  const driver = await c.env.DB.prepare("SELECT id,status,is_online FROM driver_profiles WHERE user_id = ?").bind(user.id).first<any>()
  if (!driver || driver.status !== 'active' || !driver.is_online) return c.json({ error: 'Active online driver profile required' }, 403)
  const ride = await c.env.DB.prepare("SELECT id,status,vehicle_category FROM drive_ride_requests WHERE id = ?").bind(Number(c.req.param('id'))).first<any>()
  if (!ride || !['searching','offered'].includes(ride.status)) return c.json({ error: 'Ride is not accepting driver offers' }, 409)
  try { const offer = await c.env.DB.prepare("INSERT INTO drive_ride_offers (ride_request_id,driver_profile_id,expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))").bind(ride.id, driver.id).run(); await c.env.DB.prepare("UPDATE drive_ride_requests SET status='offered',updated_at=datetime('now') WHERE id=? AND status='searching'").bind(ride.id).run(); return c.json({ id: Number(offer.meta.last_row_id), status: 'offered', expires_in_minutes: DRIVER_OFFER_EXPIRY_MINUTES }, 201) } catch { return c.json({ error: 'Driver already offered on this ride' }, 409) }
})

drivePreviewApi.get('/driver/offers', requireAuth, async (c) => {
  const user = c.get('user')!
  const driver = await c.env.DB.prepare("SELECT id,status FROM driver_profiles WHERE user_id=?").bind(user.id).first<any>()
  if (!driver || driver.status !== 'active') return c.json({ error: 'Active driver profile required' }, 403)
  await recoverExpiredRideOffers(c.env.DB)
  const rows = await c.env.DB.prepare(`SELECT o.id,o.status,o.offered_at,o.expires_at,o.responded_at,r.id AS ride_id,r.pickup_zone,r.dropoff_zone,r.vehicle_category,r.fare_kobo,r.currency,r.status AS ride_status FROM drive_ride_offers o JOIN drive_ride_requests r ON r.id=o.ride_request_id WHERE o.driver_profile_id=? ORDER BY o.id DESC LIMIT 100`).bind(driver.id).all()
  return c.json({ offers: rows.results, offer_expiry_minutes: DRIVER_OFFER_EXPIRY_MINUTES })
})

drivePreviewApi.post('/driver/offers/:id/reject', requireAuth, async (c) => {
  const user = c.get('user')!
  const driver = await c.env.DB.prepare("SELECT id,status FROM driver_profiles WHERE user_id=?").bind(user.id).first<any>()
  if (!driver || driver.status !== 'active') return c.json({ error: 'Active driver profile required' }, 403)
  const body = await c.req.json<{ reason?: string }>().catch(() => null)
  const offer = await c.env.DB.prepare("SELECT o.id,o.ride_request_id,r.status AS ride_status FROM drive_ride_offers o JOIN drive_ride_requests r ON r.id=o.ride_request_id WHERE o.id=? AND o.driver_profile_id=? AND o.status='offered'").bind(Number(c.req.param('id')),driver.id).first<any>()
  if (!offer) return c.json({ error: 'Pending offer not found or already handled' }, 409)
  const changed = await c.env.DB.prepare("UPDATE drive_ride_offers SET status='rejected', rejection_reason=?, responded_at=datetime('now') WHERE id=? AND driver_profile_id=? AND status='offered' AND expires_at > datetime('now')").bind(body?.reason?.slice(0,200) || 'Driver rejected offer',offer.id,driver.id).run()
  if (!changed.meta.rows_written) { await recoverExpiredRideOffers(c.env.DB, offer.ride_request_id); return c.json({ error: 'Offer expired before rejection' }, 409) }
  await c.env.DB.prepare("INSERT INTO drive_ride_events (ride_request_id,from_status,to_status,actor_user_id,actor_role,note) VALUES (?,?,?,?,?,?)").bind(offer.ride_request_id,offer.ride_status,offer.ride_status,user.id,'driver','Offer rejected: '+(body?.reason || 'not available')).run()
  await reassignRideAfterOffer(c.env.DB, offer.ride_request_id, offer.ride_status)
  return c.json({ success: true, status: 'rejected' })
})

drivePreviewApi.post('/driver/offers/:id/expire', requireAuth, async (c) => {
  const user = c.get('user')!
  const driver = await c.env.DB.prepare("SELECT id FROM driver_profiles WHERE user_id=? AND status='active'").bind(user.id).first<any>()
  if (!driver) return c.json({ error: 'Active driver profile required' }, 403)
  await recoverExpiredRideOffers(c.env.DB)
  return c.json({ success: true })
})

drivePreviewApi.post('/driver/offers/:id/accept', requireAuth, async (c) => {
  await recoverExpiredRideOffers(c.env.DB)
  const user = c.get('user')!
  const offer = await c.env.DB.prepare('SELECT o.id,o.ride_request_id,o.driver_profile_id,o.status AS offer_status,o.expires_at,r.status FROM drive_ride_offers o JOIN drive_ride_requests r ON r.id=o.ride_request_id JOIN driver_profiles d ON d.id=o.driver_profile_id WHERE o.id=? AND d.user_id=?').bind(Number(c.req.param('id')), user.id).first<any>()
  if (!offer) return c.json({ error: 'Offer not found' }, 404)
  if (offer.offer_status !== 'offered' || !offer.expires_at || offer.expires_at <= new Date().toISOString().replace('T', ' ').slice(0, 19)) return c.json({ error: `Offer is no longer actionable (${offer.offer_status})` }, 409)
  const rideClaim = await c.env.DB.prepare("UPDATE drive_ride_requests SET status='accepted',accepted_driver_profile_id=?,accepted_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND status IN ('searching','offered') AND EXISTS (SELECT 1 FROM drive_ride_offers WHERE id=? AND driver_profile_id=? AND status='offered' AND expires_at > datetime('now'))").bind(offer.driver_profile_id, offer.ride_request_id, offer.id, offer.driver_profile_id).run()
  if (!rideClaim.meta.rows_written) return c.json({ error: 'Ride or offer changed concurrently; acceptance rejected' }, 409)
  const offerClaim = await c.env.DB.prepare("UPDATE drive_ride_offers SET status='accepted',responded_at=datetime('now') WHERE id=? AND driver_profile_id=? AND status='offered' AND expires_at > datetime('now')").bind(offer.id, offer.driver_profile_id).run()
  if (!offerClaim.meta.rows_written) {
    await c.env.DB.prepare("UPDATE drive_ride_requests SET status='offered',accepted_driver_profile_id=NULL,accepted_at=NULL,updated_at=datetime('now') WHERE id=? AND accepted_driver_profile_id=? AND status='accepted'").bind(offer.ride_request_id, offer.driver_profile_id).run()
    return c.json({ error: 'Offer changed concurrently; acceptance rejected' }, 409)
  }
  await c.env.DB.batch([c.env.DB.prepare("UPDATE drive_ride_offers SET status='expired',responded_at=datetime('now') WHERE ride_request_id=? AND id<>? AND status='offered'").bind(offer.ride_request_id, offer.id), c.env.DB.prepare("INSERT INTO drive_ride_events (ride_request_id,from_status,to_status,actor_user_id,actor_role,note) VALUES (?,?,?,?,?,?)").bind(offer.ride_request_id, offer.status, 'accepted', user.id, 'driver', 'Driver accepted offer atomically')])
  return c.json({ success: true, ride_id: offer.ride_request_id, status: 'accepted' })
})

drivePreviewApi.post('/driver/rides/:id/transition', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ status?: string }>().catch(() => null)
  const allowed = ['driver_arriving','driver_arrived','in_progress','completed']
  if (!body?.status || !allowed.includes(body.status)) return c.json({ error: 'Invalid driver transition' }, 400)
  const owner = await c.env.DB.prepare('SELECT r.status FROM drive_ride_requests r JOIN driver_profiles d ON d.id=r.accepted_driver_profile_id WHERE r.id=? AND d.user_id=?').bind(Number(c.req.param('id')), user.id).first<any>()
  if (!owner) return c.json({ error: 'Ride is not assigned to this driver' }, 403)
  try { await transitionRide(c.env.DB, Number(c.req.param('id')), [owner.status], body.status as any, user.id, 'driver', 'Driver lifecycle transition'); return c.json({ success: true, status: body.status }) } catch (err) { return c.json({ error: err instanceof Error ? err.message : 'Invalid transition' }, 409) }
})
