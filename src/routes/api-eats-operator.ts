import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import {
  EatsOperatorFilterError,
  EatsOperatorNotFoundError,
  EatsOperatorStateError,
  getEatsOperatorOrderEvents,
  getEatsFulfillmentForOperator,
  getEatsOrderItemsForOperator,
  getEatsOrdersForOperator,
  getOwnedEatsOrderForOperator,
  getOwnedEatsRestaurants,
  isEatsOperatorStatus,
  resolveEatsOperatorProfile,
  transitionEatsOrderForOperator,
} from '../lib/eats-operator'
import { dispatchEatsOrder, EatsFulfillmentError } from '../lib/eats-fulfillment'
import { offerNextEatsCourier, EatsCourierDispatchError } from '../lib/eats-courier-dispatch'

export const eatsOperatorApi = new Hono<AppEnv>()
eatsOperatorApi.use('*', requireAuth)

async function requireOperator(c: any, next: () => Promise<void>) {
  const user = c.get('user')
  const profile = await resolveEatsOperatorProfile(c.env.DB, user.id)
  if (!profile) return c.json({ error: 'An active, verified restaurant-operator profile is required' }, 403)
  c.set('eatsOperatorProfile', profile)
  await next()
}

eatsOperatorApi.use('/operator/*', requireOperator)

function profileOf(c: any) {
  return c.get('eatsOperatorProfile') as { id: number; user_id: number }
}

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

eatsOperatorApi.get('/operator/restaurants', async (c) => {
  const profile = profileOf(c)
  return c.json({ restaurants: await getOwnedEatsRestaurants(c.env.DB, profile.id) })
})

eatsOperatorApi.get('/operator/orders', async (c) => {
  const profile = profileOf(c)
  const restaurantId = positiveInteger(c.req.query('restaurant_id'))
  const limit = positiveInteger(c.req.query('limit'))
  const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined
  const rawStatus = c.req.query('status')
  const status = rawStatus?.trim() ? rawStatus.trim() : undefined
  try {
    const orders = await getEatsOrdersForOperator(c.env.DB, profile.id, { restaurantId, status, limit, offset })
    return c.json({ orders })
  } catch (err) {
    if (err instanceof EatsOperatorFilterError) return c.json({ error: err.message, code: 'invalid_status_filter' }, 400)
    throw err
  }
})

eatsOperatorApi.get('/operator/orders/:id', async (c) => {
  const profile = profileOf(c)
  const orderId = positiveInteger(c.req.param('id'))
  if (!orderId) return c.json({ error: 'Invalid order id' }, 400)
  const order = await getOwnedEatsOrderForOperator(c.env.DB, profile.id, orderId)
  if (!order) return c.json({ error: 'Order not found' }, 404)
  const [items, events, fulfillment] = await Promise.all([
    getEatsOrderItemsForOperator(c.env.DB, profile.id, orderId),
    getEatsOperatorOrderEvents(c.env.DB, profile.id, orderId),
    getEatsFulfillmentForOperator(c.env.DB, profile.id, orderId),
  ])
  return c.json({ order, items, events, fulfillment })
})

eatsOperatorApi.post('/operator/orders/:id/transition', async (c) => {
  const profile = profileOf(c)
  const user = c.get('user')!
  const orderId = positiveInteger(c.req.param('id'))
  if (!orderId) return c.json({ error: 'Invalid order id' }, 400)
  const body = await c.req.json<{ status?: string; note?: string }>().catch(() => null)
  if (!body?.status || !isEatsOperatorStatus(body.status)) {
    return c.json({ error: 'status must be one of: accepted, preparing, ready, handoff, completed, declined' }, 400)
  }

  try {
    const order = await transitionEatsOrderForOperator(c.env.DB, profile.id, orderId, body.status, user.id, body.note)
    return c.json({ success: true, order })
  } catch (err) {
    if (err instanceof EatsOperatorNotFoundError) return c.json({ error: err.message }, 404)
    if (err instanceof EatsOperatorStateError) return c.json({ error: err.message }, 409)
    throw err
  }
})

/** Bridge a ready, paid restaurant order into the existing Logistics Engine. */
eatsOperatorApi.post('/operator/orders/:id/dispatch', async (c) => {
  const profile = profileOf(c)
  const orderId = positiveInteger(c.req.param('id'))
  if (!orderId) return c.json({ error: 'Invalid order id' }, 400)
  const owned = await getOwnedEatsOrderForOperator(c.env.DB, profile.id, orderId)
  if (!owned) return c.json({ error: 'Order not found' }, 404)
  const body = await c.req.json<{ vehicle_type_id?: number; quoted_price_kobo?: number; speed_tier?: string; pickup?: { line1?: string; city?: string; state?: string; phone?: string }; delivery_instructions?: string }>().catch(() => null)
  try {
    const existing = await getEatsFulfillmentForOperator(c.env.DB, profile.id, orderId)
    if (existing) {
      const offer = await offerNextEatsCourier(c.env.DB, Number(existing.id), profile.user_id, 'merchant')
      await c.env.DB.prepare(`INSERT INTO eats_fulfillment_events (fulfillment_id,event_type,actor_user_id,actor_role,metadata_json) VALUES (?,?,?,?,?)`).bind(existing.id, 'dispatch_retry_requested', profile.user_id, 'merchant', JSON.stringify({ order_id: orderId })).run()
      return c.json({ success: true, retry: true, fulfillment: { ...existing, dispatch_outcome: offer ? 'offers_open' : existing.dispatch_outcome }, courier_dispatch: offer ? { status: 'offer_created', expires_at: offer.expiresAt } : { status: existing.dispatch_outcome === 'no_courier_available' ? 'no_courier_available' : 'retry_limit_exhausted' } })
    }
    if (!body?.vehicle_type_id || !body.quoted_price_kobo || body.quoted_price_kobo < 1) {
      return c.json({ error: 'vehicle_type_id and a positive quoted_price_kobo are required; no courier or price is invented' }, 400)
    }
    const fulfillment = await dispatchEatsOrder(c.env.DB, orderId, {
      vehicleTypeId: body.vehicle_type_id,
      quotedPriceKobo: body.quoted_price_kobo,
      speedTier: body.speed_tier,
      pickup: body.pickup,
      deliveryInstructions: body.delivery_instructions,
    })
    const offer = await offerNextEatsCourier(c.env.DB, Number(fulfillment.fulfillmentId), profile.user_id, 'merchant')
    return c.json({ success: true, fulfillment, courier_dispatch: offer ? { status: 'offer_created', expires_at: offer.expiresAt } : { status: 'dispatch_pending' } }, 201)
  } catch (err) {
    if (err instanceof EatsFulfillmentError || err instanceof EatsCourierDispatchError) return c.json({ error: err.message }, 409)
    throw err
  }
})
