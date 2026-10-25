import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { requireActiveDriver } from '../lib/logistics-drivers'
import { completeJob, markJobArrived, markJobEnRoute } from '../lib/logistics-delivery'
import { getJobForDriver } from '../lib/logistics-dispatch'
import { completeEatsDelivery, EatsCourierDispatchError, getEatsCourierOffersForUser, offerNextEatsCourier, respondToEatsCourierOffer, requestEatsDeliveryOtp } from '../lib/eats-courier-dispatch'

export const eatsCourierApi = new Hono<AppEnv>()
eatsCourierApi.use('*', requireAuth)

function positive(value: string | undefined) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

async function driverIdForUser(c: any) {
  const profile = c.get('driverProfile' as any)
  return profile?.id as number | undefined
}

eatsCourierApi.get('/courier/offers', requireActiveDriver, async (c) => {
  return c.json({ offers: await getEatsCourierOffersForUser(c.env.DB, c.get('user')!.id) })
})

eatsCourierApi.post('/courier/offers/:id/respond', requireActiveDriver, async (c) => {
  const offerId = positive(c.req.param('id'))
  if (!offerId) return c.json({ error: 'Invalid offer id' }, 400)
  const body = await c.req.json<{ decision?: 'accept' | 'reject'; reason?: string }>().catch(() => null)
  if (!body || !['accept', 'reject'].includes(body.decision ?? '')) return c.json({ error: 'decision must be accept or reject' }, 400)
  try {
    return c.json(await respondToEatsCourierOffer(c.env.DB, offerId, c.get('user')!.id, body.decision!, body.reason))
  } catch (err) {
    if (err instanceof EatsCourierDispatchError) return c.json({ error: err.message }, 409)
    throw err
  }
})

eatsCourierApi.post('/courier/zones', requireActiveDriver, async (c) => {
  const profile = c.get('driverProfile' as any) as any
  const body = await c.req.json<{ country_iso?: string; zone_key?: string; active?: boolean }>().catch(() => null)
  if (!body?.country_iso || !body.zone_key) return c.json({ error: 'country_iso and zone_key are required' }, 400)
  const zone = await c.env.DB.prepare('SELECT key FROM delivery_zones WHERE country_iso=? AND key=? AND is_active=1').bind(body.country_iso, body.zone_key).first()
  if (!zone) return c.json({ error: 'Delivery zone is not active' }, 400)
  await c.env.DB.prepare(`INSERT INTO eats_courier_zone_permissions(driver_id,country_iso,zone_key,is_active) VALUES(?,?,?,?) ON CONFLICT(driver_id,country_iso,zone_key) DO UPDATE SET is_active=excluded.is_active`).bind(profile.id, body.country_iso, body.zone_key, body.active === false ? 0 : 1).run()
  return c.json({ ok: true })
})

async function jobAction(c: any, jobType: 'pickup' | 'delivery', action: 'en_route' | 'arrived' | 'complete') {
  const id = positive(c.req.param('id')); const driverId = await driverIdForUser(c)
  if (!id || !driverId) return c.json({ error: 'Invalid job or courier identity' }, 400)
  const job = await getJobForDriver(c.env.DB, jobType, id, driverId)
  if (!job) return c.json({ error: 'Job not found or not assigned to this courier' }, 404)
  try {
    if (action === 'en_route') await markJobEnRoute(c.env.DB, jobType, id, driverId)
    else if (action === 'arrived') await markJobArrived(c.env.DB, jobType, id, driverId)
    else {
      const body = await c.req.json<{ otp_code?: string }>().catch(() => null)
      if (job.status !== 'arrived') return c.json({ error: 'Courier must arrive before completing this job' }, 409)
      if (jobType === 'delivery') await completeEatsDelivery(c.env.DB, id, driverId, body?.otp_code ?? '')
      else {
        await completeJob(c.env.DB, 'pickup', id, driverId, { type: 'none' })
        const fulfillment = await c.env.DB.prepare('SELECT eof.id FROM eats_order_fulfillments eof JOIN pickup_jobs pj ON pj.shipment_id=eof.shipment_id WHERE pj.id=?').bind(id).first<{ id: number }>()
        if (fulfillment) await c.env.DB.prepare(`UPDATE eats_order_fulfillments SET dispatch_outcome='picked_up', updated_at=datetime('now') WHERE id=?`).bind(fulfillment.id).run()
      }
    }
    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof EatsCourierDispatchError) return c.json({ error: err.message }, 409)
    return c.json({ error: err instanceof Error ? err.message : 'Courier action failed' }, 409)
  }
}

eatsCourierApi.post('/courier/pickup-jobs/:id/en-route', requireActiveDriver, (c) => jobAction(c, 'pickup', 'en_route'))
eatsCourierApi.post('/courier/pickup-jobs/:id/arrived', requireActiveDriver, (c) => jobAction(c, 'pickup', 'arrived'))
eatsCourierApi.post('/courier/pickup-jobs/:id/complete', requireActiveDriver, (c) => jobAction(c, 'pickup', 'complete'))
eatsCourierApi.post('/courier/delivery-jobs/:id/en-route', requireActiveDriver, (c) => jobAction(c, 'delivery', 'en_route'))
eatsCourierApi.post('/courier/delivery-jobs/:id/arrived', requireActiveDriver, (c) => jobAction(c, 'delivery', 'arrived'))
eatsCourierApi.post('/courier/delivery-jobs/:id/request-proof', requireActiveDriver, async (c) => {
  const id = positive(c.req.param('id')); const driverId = await driverIdForUser(c)
  if (!id || !driverId) return c.json({ error: 'Invalid delivery job or courier identity' }, 400)
  try {
    const otp = await requestEatsDeliveryOtp(c.env.DB, id, driverId)
    return c.json({ otp_sent: true, otp_debug_only: otp })
  } catch (err) {
    if (err instanceof EatsCourierDispatchError) return c.json({ error: err.message }, 409)
    throw err
  }
})
eatsCourierApi.post('/courier/delivery-jobs/:id/complete', requireActiveDriver, (c) => jobAction(c, 'delivery', 'complete'))

export async function dispatchNextEatsCourier(db: D1Database, fulfillmentId: number) {
  return offerNextEatsCourier(db, fulfillmentId, null, 'operator')
}
