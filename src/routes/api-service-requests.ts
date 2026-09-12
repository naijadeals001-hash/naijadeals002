/**
 * Customer-facing Service Request / Quote / Service Order API — Service
 * Engine 2.0 (spec sections 8, 9, 10, 39, 45).
 *
 * Every route requires auth. Ownership is enforced entirely inside the
 * src/lib/service-requests.ts and src/lib/service-orders.ts functions this
 * file calls — a customer_user_id is ALWAYS taken from c.get('user').id,
 * never from the request body/query/params (spec section 42/43).
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import {
  createServiceRequest,
  getOwnedServiceRequest,
  getRequestsForCustomer,
  getRequirementsForRequest,
  getAttachmentsForRequest,
  findMatchingProviders,
  getQuotesForRequest,
  getQuoteForCustomer,
  acceptQuote,
  rejectQuote,
  expireQuoteIfNeeded,
  NotOwnedError,
  QuoteStateError
} from '../lib/service-requests'
import { createServiceOrderFromQuote, getOwnedOrderForCustomer, getOrdersForCustomer, getEventsForOrder, customerTransitionOrder, confirmAdditionalCharge, OrderStateError } from '../lib/service-orders'

export const serviceRequestsApi = new Hono<AppEnv>()

serviceRequestsApi.use('*', requireAuth)

// ---------- Service requests ----------

// POST /api/service-requests — spec section 45
serviceRequestsApi.post('/service-requests', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => null)
  if (!body?.category_id || !body?.title) return c.json({ error: 'category_id and title are required' }, 400)

  try {
    const requestId = await createServiceRequest(c.env.DB, user.id, body)
    return c.json({ id: requestId }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create service request' }, 400)
  }
})

// GET /api/service-requests — spec section 45
serviceRequestsApi.get('/service-requests', async (c) => {
  const user = c.get('user')!
  const requests = await getRequestsForCustomer(c.env.DB, user.id)
  return c.json(requests)
})

// GET /api/service-requests/:id — spec section 45
serviceRequestsApi.get('/service-requests/:id', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const request = await getOwnedServiceRequest(c.env.DB, user.id, id)
  if (!request) return c.json({ error: 'Service request not found' }, 404)

  const [requirements, attachments, quotes] = await Promise.all([
    getRequirementsForRequest(c.env.DB, id),
    getAttachmentsForRequest(c.env.DB, id),
    getQuotesForRequest(c.env.DB, id)
  ])
  // Lazily expire any quote past its expires_at before returning the comparison list (spec section 42).
  const freshQuotes = await Promise.all(quotes.map((q) => expireQuoteIfNeeded(c.env.DB, q)))

  return c.json({ request, requirements, attachments, quotes: freshQuotes })
})

// GET /api/service-requests/:id/matches — spec section 9 (provider matching)
serviceRequestsApi.get('/service-requests/:id/matches', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const request = await getOwnedServiceRequest(c.env.DB, user.id, id)
  if (!request) return c.json({ error: 'Service request not found' }, 404)

  const matches = await findMatchingProviders(c.env.DB, id)
  return c.json(matches)
})

// GET /api/service-requests/:id/quotes — spec section 45
serviceRequestsApi.get('/service-requests/:id/quotes', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const request = await getOwnedServiceRequest(c.env.DB, user.id, id)
  if (!request) return c.json({ error: 'Service request not found' }, 404)

  const quotes = await getQuotesForRequest(c.env.DB, id)
  const fresh = await Promise.all(quotes.map((q) => expireQuoteIfNeeded(c.env.DB, q)))
  return c.json(fresh)
})

// ---------- Quotes: accept / reject ----------

// POST /api/quotes/:id/accept — spec section 45. Creates the service_order in the same request.
serviceRequestsApi.post('/quotes/:id/accept', async (c) => {
  const user = c.get('user')!
  const quoteId = Number(c.req.param('id'))

  try {
    const quote = await acceptQuote(c.env.DB, user.id, quoteId)
    const orderId = await createServiceOrderFromQuote(c.env.DB, quote, user.id)
    return c.json({ success: true, quote, service_order_id: orderId })
  } catch (err) {
    if (err instanceof NotOwnedError) return c.json({ error: err.message }, 404)
    if (err instanceof QuoteStateError || err instanceof OrderStateError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// POST /api/quotes/:id/reject — spec section 45
serviceRequestsApi.post('/quotes/:id/reject', async (c) => {
  const user = c.get('user')!
  const quoteId = Number(c.req.param('id'))

  try {
    const ok = await rejectQuote(c.env.DB, user.id, quoteId)
    if (!ok) return c.json({ error: 'Quote not found' }, 404)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof QuoteStateError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// ---------- Service orders (customer side) ----------

// GET /api/service-orders — spec section 45
serviceRequestsApi.get('/service-orders', async (c) => {
  const user = c.get('user')!
  const orders = await getOrdersForCustomer(c.env.DB, user.id)
  return c.json(orders)
})

// GET /api/service-orders/:id — spec section 45
serviceRequestsApi.get('/service-orders/:id', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const order = await getOwnedOrderForCustomer(c.env.DB, user.id, id)
  if (!order) return c.json({ error: 'Service order not found' }, 404)

  const events = await getEventsForOrder(c.env.DB, id)
  return c.json({ order, events })
})

// POST /api/service-orders/:id/cancel — spec section 45
serviceRequestsApi.post('/service-orders/:id/cancel', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as any)

  try {
    const order = await customerTransitionOrder(c.env.DB, user.id, id, 'cancelled', { reason: body?.reason ?? 'Cancelled by customer' })
    return c.json({ success: true, order })
  } catch (err) {
    if (err instanceof NotOwnedError) return c.json({ error: err.message }, 404)
    if (err instanceof OrderStateError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// POST /api/service-orders/:id/confirm — spec section 45 (customer confirms completion)
serviceRequestsApi.post('/service-orders/:id/confirm', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))

  try {
    const order = await customerTransitionOrder(c.env.DB, user.id, id, 'customer_confirmed')
    return c.json({ success: true, order })
  } catch (err) {
    if (err instanceof NotOwnedError) return c.json({ error: err.message }, 404)
    if (err instanceof OrderStateError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// POST /api/service-orders/:id/dispute — customer raises a dispute after completion (spec section 27)
serviceRequestsApi.post('/service-orders/:id/dispute', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as any)

  try {
    const order = await customerTransitionOrder(c.env.DB, user.id, id, 'disputed', { reason: body?.reason ?? '' })
    return c.json({ success: true, order })
  } catch (err) {
    if (err instanceof NotOwnedError) return c.json({ error: err.message }, 404)
    if (err instanceof OrderStateError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// POST /api/service-orders/:id/confirm-charge — customer confirms an additional/variable-scope charge (spec section 26)
serviceRequestsApi.post('/service-orders/:id/confirm-charge', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ additional_charges_kobo?: number }>().catch(() => null)
  if (!body || body.additional_charges_kobo === undefined) return c.json({ error: 'additional_charges_kobo is required' }, 400)

  try {
    const order = await confirmAdditionalCharge(c.env.DB, user.id, id, body.additional_charges_kobo)
    return c.json({ success: true, order })
  } catch (err: any) {
    if (err instanceof NotOwnedError) return c.json({ error: err.message }, 404)
    if (err instanceof OrderStateError) return c.json({ error: err.message }, 400)
    return c.json({ error: err.message ?? 'Failed to confirm charge' }, 400)
  }
})
