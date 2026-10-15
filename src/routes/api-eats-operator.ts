import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import {
  EatsOperatorFilterError,
  EatsOperatorNotFoundError,
  EatsOperatorStateError,
  getEatsOperatorOrderEvents,
  getEatsOrderItemsForOperator,
  getEatsOrdersForOperator,
  getOwnedEatsOrderForOperator,
  getOwnedEatsRestaurants,
  isEatsOperatorStatus,
  resolveEatsOperatorProfile,
  transitionEatsOrderForOperator,
} from '../lib/eats-operator'

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
  const [items, events] = await Promise.all([
    getEatsOrderItemsForOperator(c.env.DB, profile.id, orderId),
    getEatsOperatorOrderEvents(c.env.DB, profile.id, orderId),
  ])
  return c.json({ order, items, events })
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
