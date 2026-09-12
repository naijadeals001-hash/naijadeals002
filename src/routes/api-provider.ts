/**
 * Provider dashboard API — Service Engine 2.0 (spec sections 38, 45).
 *
 * OWNERSHIP RESOLUTION mirrors src/routes/api-seller.ts's
 * resolveSellerVendor exactly: `resolveProviderProfile` below is the ONLY
 * way any handler in this file learns "which provider_profile_id am I
 * acting as" — never from the client. Two paths:
 *   1. Individual provider: c.get('user').id -> provider_profiles.user_id
 *      (src/lib/providers.ts's resolveProviderStatus).
 *   2. Organization-owned service business: c.get('user').id -> ACTIVE
 *      membership with 'services.manage' permission -> provider_profiles
 *      via identity_organization_id (resolveOrganizationProvider).
 */
import { Hono } from 'hono'
import type { AppEnv, ProviderProfileRow } from '../types'
import { requireAuth } from '../lib/auth'
import { resolveProviderStatus, resolveOrganizationProvider, createProviderProfile } from '../lib/providers'
import {
  createServiceListing,
  getOwnedServiceListing,
  updateServiceListing,
  getListingsForProvider,
  createServicePackage,
  getOwnedPackage,
  getPackagesForListing,
  createServiceArea,
  getAreasForProvider,
  getResourcesForProvider,
  getOwnedResource,
  replaceAvailabilityHours,
  getAvailabilityHoursForResource
} from '../lib/services'
import { getOpenRequestsForProvider, createQuote, getQuotesSentByProvider, withdrawQuote, NotOwnedError, QuoteStateError } from '../lib/service-requests'
import { getOwnedOrderForProvider, getOrdersForProvider, getEventsForOrder, providerTransitionOrder, OrderStateError } from '../lib/service-orders'

export const providerApi = new Hono<AppEnv>()

providerApi.use('*', requireAuth)

/** Resolves the acting provider profile from the AUTHENTICATED user only — mirrors api-seller.ts's resolveSellerVendor pattern exactly. */
async function resolveProviderProfile(c: any): Promise<ProviderProfileRow | null> {
  const user = c.get('user')
  if (!user) return null

  const individual = await resolveProviderStatus(c.env.DB, user.id)
  if (individual.state === 'ACTIVE_PROVIDER' && individual.provider) return individual.provider

  const organizationId = Number(c.req.query('organization_id'))
  if (organizationId && !Number.isNaN(organizationId)) {
    const provider = await resolveOrganizationProvider(c.env.DB, user.id, organizationId)
    if (provider) return provider
  }
  return null
}

async function requireProviderProfile(c: any, next: () => Promise<void>) {
  const provider = await resolveProviderProfile(c)
  if (!provider) {
    return c.json({ error: 'You do not have an active service provider profile. Complete provider onboarding or use an organization with services.manage permission.' }, 403)
  }
  c.set('providerProfile', provider)
  await next()
}

function providerOf(c: any): ProviderProfileRow {
  return c.get('providerProfile') as ProviderProfileRow
}

// ---------- Provider onboarding (individual) — not gated by requireProviderProfile ----------

// POST /api/providers/me/onboard — spec sections 2, 3, 38
providerApi.post('/providers/me/onboard', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => null)
  if (!body?.display_name) return c.json({ error: 'display_name is required' }, 400)

  try {
    const providerId = await createProviderProfile(c.env.DB, user.id, body)
    return c.json({ id: providerId }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create provider profile' }, 400)
  }
})

// GET /api/providers/me — current provider status (no gating, so a NO_PROVIDER user can see onboarding CTA)
providerApi.get('/providers/me', async (c) => {
  const user = c.get('user')!
  const status = await resolveProviderStatus(c.env.DB, user.id)
  return c.json(status)
})

providerApi.use('/providers/me/*', requireProviderProfile)
providerApi.use('/service-listings/*', requireProviderProfile)

// ---------- Service listings (spec section 45: GET/POST /api/providers/me/services, PATCH /api/providers/me/services/:id) ----------

providerApi.get('/providers/me/services', async (c) => {
  const provider = providerOf(c)
  const listings = await getListingsForProvider(c.env.DB, provider.id)
  return c.json(listings)
})

providerApi.post('/providers/me/services', async (c) => {
  const provider = providerOf(c)
  const body = await c.req.json<any>().catch(() => null)
  if (!body?.category_id || !body?.title) return c.json({ error: 'category_id and title are required' }, 400)

  try {
    const listingId = await createServiceListing(c.env.DB, provider.id, body)
    return c.json({ id: listingId }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create service listing' }, 400)
  }
})

providerApi.patch('/providers/me/services/:id', async (c) => {
  const provider = providerOf(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<any>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  const ok = await updateServiceListing(c.env.DB, provider.id, id, body)
  if (!ok) return c.json({ error: 'Service listing not found' }, 404)
  return c.json({ success: true })
})

providerApi.get('/providers/me/services/:id', async (c) => {
  const provider = providerOf(c)
  const id = Number(c.req.param('id'))
  const listing = await getOwnedServiceListing(c.env.DB, provider.id, id)
  if (!listing) return c.json({ error: 'Service listing not found' }, 404)
  const packages = await getPackagesForListing(c.env.DB, id)
  return c.json({ listing, packages })
})

// ---------- Service packages ----------

providerApi.post('/providers/me/services/:id/packages', async (c) => {
  const provider = providerOf(c)
  const listingId = Number(c.req.param('id'))
  const listing = await getOwnedServiceListing(c.env.DB, provider.id, listingId)
  if (!listing) return c.json({ error: 'Service listing not found' }, 404)

  const body = await c.req.json<any>().catch(() => null)
  if (!body?.title || !body?.price_kobo) return c.json({ error: 'title and price_kobo are required' }, 400)

  try {
    const packageId = await createServicePackage(c.env.DB, listingId, body)
    return c.json({ id: packageId }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create package' }, 400)
  }
})

// ---------- Service areas ----------

providerApi.get('/providers/me/areas', async (c) => {
  const provider = providerOf(c)
  const areas = await getAreasForProvider(c.env.DB, provider.id)
  return c.json(areas)
})

providerApi.post('/providers/me/areas', async (c) => {
  const provider = providerOf(c)
  const body = await c.req.json<any>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  const areaId = await createServiceArea(c.env.DB, provider.id, body)
  return c.json({ id: areaId }, 201)
})

// ---------- Availability (spec section 45: GET/POST /api/providers/me/availability) ----------

providerApi.get('/providers/me/availability', async (c) => {
  const provider = providerOf(c)
  const resources = await getResourcesForProvider(c.env.DB, provider.id)
  const withHours = await Promise.all(
    resources.map(async (r) => ({ resource: r, hours: await getAvailabilityHoursForResource(c.env.DB, r.id) }))
  )
  return c.json(withHours)
})

providerApi.post('/providers/me/availability', async (c) => {
  const provider = providerOf(c)
  const body = await c.req.json<{ resource_id: number; hours: { day_of_week: number; start_time: string; end_time: string; buffer_minutes?: number }[] }>().catch(() => null)
  if (!body?.resource_id || !Array.isArray(body.hours)) return c.json({ error: 'resource_id and hours[] are required' }, 400)

  const resource = await getOwnedResource(c.env.DB, provider.id, body.resource_id)
  if (!resource) return c.json({ error: 'Resource not found' }, 404)

  try {
    await replaceAvailabilityHours(c.env.DB, resource.id, body.hours)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to save availability' }, 400)
  }
})

// ---------- Requests, quotes, orders (provider side) ----------

// GET /api/providers/me/requests — spec section 45 (open requests matching the provider's category)
providerApi.get('/providers/me/requests', async (c) => {
  const provider = providerOf(c)
  const requests = await getOpenRequestsForProvider(c.env.DB, provider.primary_category_id, provider.country_iso)
  return c.json(requests)
})

providerApi.post('/providers/me/requests/:id/quotes', async (c) => {
  const provider = providerOf(c)
  const requestId = Number(c.req.param('id'))
  const body = await c.req.json<any>().catch(() => null)
  if (!body?.price_kobo) return c.json({ error: 'price_kobo is required' }, 400)

  try {
    const quoteId = await createQuote(c.env.DB, provider.id, requestId, body)
    return c.json({ id: quoteId }, 201)
  } catch (err: any) {
    if (err instanceof NotOwnedError) return c.json({ error: err.message }, 404)
    if (err instanceof QuoteStateError) return c.json({ error: err.message }, 400)
    return c.json({ error: err.message ?? 'Failed to create quote' }, 400)
  }
})

// GET /api/providers/me/quotes — spec section 45
providerApi.get('/providers/me/quotes', async (c) => {
  const provider = providerOf(c)
  const quotes = await getQuotesSentByProvider(c.env.DB, provider.id)
  return c.json(quotes)
})

providerApi.post('/providers/me/quotes/:id/withdraw', async (c) => {
  const provider = providerOf(c)
  const quoteId = Number(c.req.param('id'))
  const ok = await withdrawQuote(c.env.DB, provider.id, quoteId)
  if (!ok) return c.json({ error: 'Quote not found or cannot be withdrawn' }, 404)
  return c.json({ success: true })
})

// GET /api/providers/me/orders — spec section 45
providerApi.get('/providers/me/orders', async (c) => {
  const provider = providerOf(c)
  const orders = await getOrdersForProvider(c.env.DB, provider.id)
  return c.json(orders)
})

providerApi.get('/providers/me/orders/:id', async (c) => {
  const provider = providerOf(c)
  const id = Number(c.req.param('id'))
  const order = await getOwnedOrderForProvider(c.env.DB, provider.id, id)
  if (!order) return c.json({ error: 'Service order not found' }, 404)
  const events = await getEventsForOrder(c.env.DB, id)
  return c.json({ order, events })
})

/**
 * Generic provider-side lifecycle transition (schedule / provider_arriving /
 * in_progress / cancelled / no_show) — flexible endpoint for statuses the
 * spec's example list (section 45) doesn't name individually.
 */
providerApi.post('/providers/me/orders/:id/transition', async (c) => {
  const provider = providerOf(c)
  const id = Number(c.req.param('id'))
  const user = c.get('user')!
  const body = await c.req.json<{ status?: string; reason?: string }>().catch(() => null)
  if (!body?.status) return c.json({ error: 'status is required' }, 400)

  try {
    const order = await providerTransitionOrder(c.env.DB, provider.id, id, body.status as any, user.id, { reason: body.reason })
    return c.json({ success: true, order })
  } catch (err) {
    if (err instanceof NotOwnedError) return c.json({ error: err.message }, 404)
    if (err instanceof OrderStateError) return c.json({ error: err.message }, 400)
    throw err
  }
})

/**
 * POST /api/service-orders/:id/complete — spec section 45's explicit
 * example endpoint. Provider-only (a customer can never force this — spec
 * section 42/47's "customer cannot force service completion" security
 * test). Mounted on providerApi but at the SAME /service-orders/:id/...
 * path family as the customer-side cancel/confirm/dispute routes in
 * api-service-requests.ts — both routers are mounted at /api in index.tsx,
 * so this becomes /api/service-orders/:id/complete exactly as specified.
 */
providerApi.post('/service-orders/:id/complete', requireProviderProfile, async (c) => {
  const provider = providerOf(c)
  const id = Number(c.req.param('id'))
  const user = c.get('user')!

  try {
    const order = await providerTransitionOrder(c.env.DB, provider.id, id, 'completed', user.id)
    return c.json({ success: true, order })
  } catch (err) {
    if (err instanceof NotOwnedError) return c.json({ error: err.message }, 404)
    if (err instanceof OrderStateError) return c.json({ error: err.message }, 400)
    throw err
  }
})
