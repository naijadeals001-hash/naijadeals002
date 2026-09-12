/**
 * Booking Engine 2.0 — Universal Availability, Reservations, Appointments,
 * Capacity & Booking API.
 *
 * ONE generic API surface reused by every vertical (NaijaStay, NaijaTravel,
 * NaijaEvents, NaijaHealth, NaijaBeauty, NaijaHome, NaijaGigs, NaijaAuto) —
 * NOT seven separate booking route files. A vertical distinguishes itself
 * via bookable_listings.vertical/listing_type/category, never a different
 * endpoint shape.
 *
 * OWNERSHIP RESOLUTION mirrors src/routes/api-provider.ts's
 * resolveProviderProfile pattern: `resolveBookingProvider` below is the
 * ONLY way any handler learns "which provider_user_id / organization_id am
 * I acting as" — an individual provider acts as their own user id; an
 * organization-owned bookable business acts via a resolved ACTIVE
 * membership with the EXISTING 'bookings.manage'/'bookings.read'
 * organization permissions (migration 0037) — never a client-supplied id.
 *
 * PATH NAMESPACE NOTE: individual-provider routes live under
 * /api/booking-providers/me/... rather than /api/providers/me/... —
 * discovered during smoke-testing that Hono's router applies EVERY
 * sub-app's app.use() wildcard middleware against the shared '/api' path
 * space, so api-provider.ts's `providerApi.use('/providers/me/*',
 * requireProviderProfile)` (Service Engine 2.0) was silently intercepting
 * this engine's /providers/me/* requests and demanding an unrelated
 * gig_provider profile. Renamed to avoid the collision rather than risk
 * touching Service Engine 2.0's own middleware.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { resolveMembership } from '../lib/organizations'
import {
  createBookableListing,
  getOwnedListingForProvider,
  getOwnedListingForOrganization,
  getPublicListingById,
  searchPublicListings,
  updateBookableListing,
  getListingsForProvider,
  getListingsForOrganization,
  addResourceToListing,
  createAvailabilityBlock,
  setAvailabilityRule,
  getAvailabilityRulesForResource,
  getAvailabilityBlocksForListing,
  NotOwnedListingError,
} from '../lib/bookings'
import { getResourcesForListing, getOwnedResource, checkAvailability, getCapacityReport } from '../lib/booking-availability'
import { createHold, releaseHold, getHoldForCustomer, createBookingFromHold, expireHoldsIfNeeded, BookingHoldError } from '../lib/booking-holds'
import {
  transitionBooking,
  getEventsForBooking,
  getBookingsForCustomer,
  getBookingsForProvider,
  getBookingsForOrganization,
  BookingLifecycleError,
  NotOwnedBookingError,
  IllegalBookingTransitionError,
} from '../lib/booking-lifecycle'
import { cancelBookingWithPolicy, quoteCancellation, createCancellationPolicy, getPoliciesForProvider, getPoliciesForOrganization, BookingCancellationError } from '../lib/booking-cancellation'
import { payForBooking, BookingPaymentError } from '../lib/booking-payments'
import type { BookableListingRow, BookingStatus } from '../types'

export const bookingsApi = new Hono<AppEnv>()

// ============================================================
// Public discovery — no authentication required (spec: availability-aware
// search). Mounted at /api so paths read /api/bookable-listings/....
// ============================================================

bookingsApi.get('/bookable-listings', async (c) => {
  const listingType = c.req.query('type') as 'gig_service' | 'stay_unit' | undefined
  const vertical = c.req.query('vertical') ?? undefined
  const countryIso = c.req.query('country') ?? undefined
  const city = c.req.query('city') ?? undefined
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
  const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined
  const listings = await searchPublicListings(c.env.DB, { listingType, vertical, countryIso, city, limit, offset })
  return c.json(listings)
})

bookingsApi.get('/bookable-listings/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
  const listing = await getPublicListingById(c.env.DB, id)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  const resources = await getResourcesForListing(c.env.DB, id)
  return c.json({ listing, resources })
})

/** GET /api/bookable-listings/:id/availability?resource_id=&starts_at=&ends_at=&capacity= — the core "can I book this window" check. Never trust a client's own arithmetic about capacity; this endpoint is the single source of truth a frontend calendar/search page must call before offering a slot. */
bookingsApi.get('/bookable-listings/:id/availability', async (c) => {
  const listingId = Number(c.req.param('id'))
  const resourceId = Number(c.req.query('resource_id'))
  const startsAt = c.req.query('starts_at')
  const endsAt = c.req.query('ends_at')
  const capacity = c.req.query('capacity') ? Number(c.req.query('capacity')) : 1
  if (Number.isNaN(listingId) || Number.isNaN(resourceId) || !startsAt || !endsAt) {
    return c.json({ error: 'listing id, resource_id, starts_at and ends_at are required' }, 400)
  }

  const listing = await getPublicListingById(c.env.DB, listingId)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  const resource = await getOwnedResource(c.env.DB, listingId, resourceId)
  if (!resource) return c.json({ error: 'Resource not found for this listing' }, 404)

  await expireHoldsIfNeeded(c.env.DB, resourceId)
  const result = await checkAvailability(c.env.DB, listing, resource, startsAt, endsAt, capacity)
  return c.json(result)
})

/** GET /api/bookable-listings/:id/capacity?resource_id=&starts_at=&ends_at= — capacity reporting for search/listing pages (spec: total/reserved/available exposed to search). */
bookingsApi.get('/bookable-listings/:id/capacity', async (c) => {
  const listingId = Number(c.req.param('id'))
  const resourceId = Number(c.req.query('resource_id'))
  const startsAt = c.req.query('starts_at')
  const endsAt = c.req.query('ends_at')
  if (Number.isNaN(listingId) || Number.isNaN(resourceId) || !startsAt || !endsAt) {
    return c.json({ error: 'resource_id, starts_at and ends_at are required' }, 400)
  }
  const resource = await getOwnedResource(c.env.DB, listingId, resourceId)
  if (!resource) return c.json({ error: 'Resource not found for this listing' }, 404)
  await expireHoldsIfNeeded(c.env.DB, resourceId)
  const report = await getCapacityReport(c.env.DB, resource, startsAt, endsAt)
  return c.json(report)
})

// ============================================================
// Everything below requires authentication.
// ============================================================
bookingsApi.use('/booking-holds/*', requireAuth)
bookingsApi.use('/bookings', requireAuth)
bookingsApi.use('/bookings/*', requireAuth)
bookingsApi.use('/booking-providers/me/bookable-listings*', requireAuth)
bookingsApi.use('/booking-providers/me/bookings*', requireAuth)
bookingsApi.use('/booking-providers/me/cancellation-policies*', requireAuth)
bookingsApi.use('/organizations/:organizationId/bookable-listings*', requireAuth)
bookingsApi.use('/organizations/:organizationId/bookings*', requireAuth)

/**
 * Resolves the acting provider identity for a booking-management request:
 * either the authenticated user acting as themself (individual provider),
 * or — if an `organizationId` route param is present — a server-resolved
 * ACTIVE membership carrying 'bookings.manage' (write) or 'bookings.read'
 * (read-only) on the EXISTING organization_permissions grants (migration
 * 0037). Returns null if neither resolves, meaning "not authorized" — the
 * caller returns 403/404 accordingly. Mirrors requireOrganizationMember's
 * "same 404 whether org doesn't exist or isn't a member" anti-enumeration
 * pattern by simply returning null in both cases.
 */
async function resolveBookingProvider(c: any, permission: 'bookings.manage' | 'bookings.read'): Promise<{ providerUserId: number | null; organizationId: number | null } | null> {
  const user = c.get('user')
  if (!user) return null
  const organizationId = c.req.param('organizationId') ? Number(c.req.param('organizationId')) : null
  if (organizationId) {
    const membership = await resolveMembership(c.env.DB, user.id, organizationId)
    if (!membership || !membership.permissionKeys.has(permission)) return null
    return { providerUserId: null, organizationId }
  }
  return { providerUserId: user.id, organizationId: null }
}

// ---------- Provider: bookable listing management ----------

/**
 * SECURITY (Booking Engine 2.0 — 57-check gate, Area F finding #1): this is
 * the INDIVIDUAL-provider listing-creation path — organizationId/organization
 * ownership must NEVER be accepted from the client here. Org-owned listings
 * have their own dedicated, membership-checked endpoint below
 * (POST /organizations/:organizationId/bookable-listings). Before this fix,
 * `body.organizationId` was passed straight into createBookableListing with
 * zero membership verification, letting any authenticated user plant a
 * listing tagged with an arbitrary organization_id they don't belong to —
 * reproduced live: a non-member successfully created a listing carrying
 * organization_id=1. Also verifies a client-supplied cancellationPolicyId
 * actually belongs to the caller (previously accepted any policy id,
 * including another provider's, unverified).
 */
bookingsApi.post('/booking-providers/me/bookable-listings', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const { organizationId: _ignoredOrganizationId, ...safeBody } = body ?? {}
  if (safeBody.cancellationPolicyId !== undefined && safeBody.cancellationPolicyId !== null) {
    const owned = await c.env.DB.prepare('SELECT id FROM booking_cancellation_policies WHERE id = ? AND owner_user_id = ?').bind(safeBody.cancellationPolicyId, user.id).first()
    if (!owned) return c.json({ error: 'cancellationPolicyId not found or not owned by you' }, 404)
  }
  try {
    const id = await createBookableListing(c.env.DB, user.id, safeBody)
    return c.json({ id }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

bookingsApi.get('/booking-providers/me/bookable-listings', async (c) => {
  const user = c.get('user')!
  const listings = await getListingsForProvider(c.env.DB, user.id)
  return c.json(listings)
})

bookingsApi.get('/booking-providers/me/bookable-listings/:id', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const listing = await getOwnedListingForProvider(c.env.DB, user.id, id)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  const resources = await getResourcesForListing(c.env.DB, id)
  return c.json({ listing, resources })
})

bookingsApi.patch('/booking-providers/me/bookable-listings/:id', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  // SECURITY (57-check gate, Area F): verify a client-supplied cancellationPolicyId
  // is actually owned by this provider before it can be attached to their listing.
  if (body.cancellationPolicyId !== undefined && body.cancellationPolicyId !== null) {
    const owned = await c.env.DB.prepare('SELECT id FROM booking_cancellation_policies WHERE id = ? AND owner_user_id = ?').bind(body.cancellationPolicyId, user.id).first()
    if (!owned) return c.json({ error: 'cancellationPolicyId not found or not owned by you' }, 404)
  }
  const ok = await updateBookableListing(c.env.DB, user.id, id, body)
  if (!ok) return c.json({ error: 'Listing not found or not owned by you' }, 404)
  return c.json({ success: true })
})

bookingsApi.post('/booking-providers/me/bookable-listings/:id/resources', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  try {
    const resourceId = await addResourceToListing(c.env.DB, user.id, id, body)
    return c.json({ id: resourceId }, 201)
  } catch (err) {
    if (err instanceof NotOwnedListingError) return c.json({ error: err.message }, 404)
    return c.json({ error: (err as Error).message }, 400)
  }
})

bookingsApi.post('/booking-providers/me/bookable-listings/:id/availability-blocks', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  try {
    const blockId = await createAvailabilityBlock(c.env.DB, user.id, id, { resourceId: body.resource_id, blockedFrom: body.blocked_from, blockedUntil: body.blocked_until, reason: body.reason })
    return c.json({ id: blockId }, 201)
  } catch (err) {
    if (err instanceof NotOwnedListingError) return c.json({ error: err.message }, 404)
    return c.json({ error: (err as Error).message }, 400)
  }
})

bookingsApi.get('/booking-providers/me/bookable-listings/:id/availability-blocks', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const listing = await getOwnedListingForProvider(c.env.DB, user.id, id)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  const blocks = await getAvailabilityBlocksForListing(c.env.DB, id)
  return c.json(blocks)
})

bookingsApi.post('/booking-providers/me/bookable-listings/:id/resources/:resourceId/availability-rules', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const resourceId = Number(c.req.param('resourceId'))
  const body = await c.req.json().catch(() => ({}))
  try {
    const ruleId = await setAvailabilityRule(c.env.DB, user.id, id, resourceId, { dayOfWeek: body.day_of_week, startTime: body.start_time, endTime: body.end_time, capacityOverride: body.capacity_override })
    return c.json({ id: ruleId }, 201)
  } catch (err) {
    if (err instanceof NotOwnedListingError) return c.json({ error: err.message }, 404)
    return c.json({ error: (err as Error).message }, 400)
  }
})

bookingsApi.get('/booking-providers/me/bookable-listings/:id/resources/:resourceId/availability-rules', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const resourceId = Number(c.req.param('resourceId'))
  const listing = await getOwnedListingForProvider(c.env.DB, user.id, id)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  const rules = await getAvailabilityRulesForResource(c.env.DB, resourceId)
  return c.json(rules)
})

// ---------- Provider: cancellation policies ----------

bookingsApi.post('/booking-providers/me/cancellation-policies', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  try {
    const id = await createCancellationPolicy(c.env.DB, { userId: user.id }, body)
    return c.json({ id }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

bookingsApi.get('/booking-providers/me/cancellation-policies', async (c) => {
  const user = c.get('user')!
  const policies = await getPoliciesForProvider(c.env.DB, user.id)
  return c.json(policies)
})

// ---------- Provider: booking management (view/act on customer bookings) ----------

bookingsApi.get('/booking-providers/me/bookings', async (c) => {
  const user = c.get('user')!
  const bookings = await getBookingsForProvider(c.env.DB, user.id)
  return c.json(bookings)
})

// ---------- Customer: booking holds (Search -> Hold step) ----------

bookingsApi.post('/booking-holds', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  try {
    const hold = await createHold(c.env.DB, {
      listingId: body.listing_id,
      resourceId: body.resource_id,
      customerUserId: user.id,
      startsAt: body.starts_at,
      endsAt: body.ends_at,
      capacityRequested: body.capacity_requested,
      ttlMinutes: body.ttl_minutes,
    })
    return c.json(hold, 201)
  } catch (err) {
    if (err instanceof BookingHoldError) return c.json({ error: err.message }, 409)
    return c.json({ error: (err as Error).message }, 400)
  }
})

bookingsApi.delete('/booking-holds/:id', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const ok = await releaseHold(c.env.DB, user.id, id)
  if (!ok) return c.json({ error: 'Hold not found, not owned by you, or already inactive' }, 404)
  return c.json({ success: true })
})

// ---------- Customer: bookings (Hold -> Price -> Confirm -> Payment -> Created) ----------

/**
 * POST /api/bookings — confirms a hold into a real booking. The price is
 * SERVER-COMPUTED here from the listing's base_price_kobo and the hold's
 * window/capacity (spec's non-negotiable "client cannot modify price" rule)
 * — a client-supplied price in the request body is IGNORED entirely.
 */
bookingsApi.post('/bookings', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const holdId = Number(body.hold_id)
  if (Number.isNaN(holdId)) return c.json({ error: 'hold_id is required' }, 400)

  const hold = await getHoldForCustomer(c.env.DB, user.id, holdId)
  if (!hold) return c.json({ error: 'Hold not found or not owned by you' }, 404)

  const listing = await getPublicListingById(c.env.DB, hold.listing_id)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  // Server-authoritative pricing: per_night/per_hour multiplies the unit
  // price by the number of nights/hours in the hold's window; per_booking
  // is a flat charge regardless of duration. Never derived from the
  // client. Multiplied by capacity_requested for multi-unit bookings
  // (e.g. 3 identical rooms in one booking).
  const startMs = new Date(hold.starts_at).getTime()
  const endMs = new Date(hold.ends_at).getTime()
  let units = 1
  if (listing.pricing_unit === 'per_night') units = Math.max(1, Math.round((endMs - startMs) / 86_400_000))
  else if (listing.pricing_unit === 'per_hour') units = Math.max(1, Math.round((endMs - startMs) / 3_600_000))
  const totalPriceKobo = listing.base_price_kobo * units * hold.capacity_requested

  try {
    const bookingId = await createBookingFromHold(c.env.DB, listing, {
      holdId,
      customerUserId: user.id,
      totalPriceKobo,
      currency: listing.currency,
      timezone: listing.timezone,
      guestsCount: body.guests_count,
      metadata: body.metadata,
    })
    const booking = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first()
    return c.json(booking, 201)
  } catch (err) {
    if (err instanceof BookingHoldError) return c.json({ error: err.message }, 409)
    return c.json({ error: (err as Error).message }, 400)
  }
})

bookingsApi.get('/bookings', async (c) => {
  const user = c.get('user')!
  const bookings = await getBookingsForCustomer(c.env.DB, user.id)
  return c.json(bookings)
})

async function loadBookingForRequest(c: any, id: number) {
  const user = c.get('user')!
  const booking = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first()
  if (!booking) return null
  const isCustomer = booking.customer_user_id === user.id
  const isProvider = booking.provider_user_id === user.id
  if (!isCustomer && !isProvider) {
    if (booking.organization_id) {
      const membership = await resolveMembership(c.env.DB, user.id, booking.organization_id)
      if (membership && membership.permissionKeys.has('bookings.read')) return booking
    }
    return null
  }
  return booking
}

bookingsApi.get('/bookings/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const booking = await loadBookingForRequest(c, id)
  if (!booking) return c.json({ error: 'Booking not found' }, 404)
  const events = await getEventsForBooking(c.env.DB, id)
  return c.json({ booking, events })
})

bookingsApi.post('/bookings/:id/pay', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const listing = await c.env.DB.prepare('SELECT bl.deposit_percentage FROM bookings b JOIN bookable_listings bl ON bl.id = b.listing_id WHERE b.id = ?').bind(id).first<{ deposit_percentage: number }>()
  try {
    const booking = await payForBooking(c.env.DB, id, user.id, listing?.deposit_percentage ?? 100)
    return c.json(booking)
  } catch (err) {
    if (err instanceof BookingPaymentError) return c.json({ error: err.message }, 400)
    return c.json({ error: (err as Error).message }, 500)
  }
})

/** GET /api/bookings/:id/cancellation-quote — preview the refund/fee before confirming (spec: never surprise the customer). */
bookingsApi.get('/bookings/:id/cancellation-quote', async (c) => {
  const id = Number(c.req.param('id'))
  const booking = await loadBookingForRequest(c, id)
  if (!booking) return c.json({ error: 'Booking not found' }, 404)
  const quote = await quoteCancellation(c.env.DB, booking as any)
  return c.json(quote)
})

bookingsApi.post('/bookings/:id/cancel', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const booking = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<{ customer_user_id: number; provider_user_id: number; organization_id: number | null }>()
  if (!booking) return c.json({ error: 'Booking not found' }, 404)

  let role: 'customer' | 'provider' | null = null
  let organizationId: number | null = null
  if (booking.customer_user_id === user.id) role = 'customer'
  else if (booking.provider_user_id === user.id) role = 'provider'
  else if (booking.organization_id) {
    const membership = await resolveMembership(c.env.DB, user.id, booking.organization_id)
    if (membership && membership.permissionKeys.has('bookings.manage')) {
      role = 'provider'
      organizationId = booking.organization_id
    }
  }
  if (!role) return c.json({ error: 'Booking not found' }, 404)

  try {
    const { booking: updated, quote } = await cancelBookingWithPolicy(c.env.DB, id, { userId: user.id, role, organizationId }, body.reason)
    return c.json({ booking: updated, quote })
  } catch (err) {
    if (err instanceof IllegalBookingTransitionError || err instanceof BookingCancellationError || err instanceof NotOwnedBookingError) {
      return c.json({ error: err.message }, 400)
    }
    return c.json({ error: (err as Error).message }, 500)
  }
})

/** Generic transition endpoint for provider/admin lifecycle actions that aren't cancellation/payment (confirm/decline/check-in/check-out/complete/no-show). Kept as one endpoint (spec's transitionOrderStatus-style single entry point) rather than six near-identical routes. */
bookingsApi.post('/bookings/:id/transition', async (c) => {
  const user = c.get('user')!
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const targetStatus = body.status as BookingStatus
  const validProviderTargets: BookingStatus[] = ['confirmed', 'declined', 'checked_in', 'in_progress', 'completed', 'no_show']
  const validCustomerTargets: BookingStatus[] = ['disputed']
  if (!targetStatus) return c.json({ error: 'status is required' }, 400)

  const booking = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<{ customer_user_id: number; provider_user_id: number; organization_id: number | null }>()
  if (!booking) return c.json({ error: 'Booking not found' }, 404)

  let role: 'customer' | 'provider' | null = null
  let organizationId: number | null = null
  if (booking.provider_user_id === user.id && validProviderTargets.includes(targetStatus)) role = 'provider'
  else if (booking.organization_id && validProviderTargets.includes(targetStatus)) {
    const membership = await resolveMembership(c.env.DB, user.id, booking.organization_id)
    if (membership && membership.permissionKeys.has('bookings.manage')) {
      role = 'provider'
      organizationId = booking.organization_id
    }
  } else if (booking.customer_user_id === user.id && validCustomerTargets.includes(targetStatus)) role = 'customer'

  if (!role) return c.json({ error: 'You are not permitted to make this transition' }, 403)

  try {
    const updated = await transitionBooking(c.env.DB, id, targetStatus, { userId: user.id, role, organizationId }, { reason: body.reason, metadata: body.metadata })
    return c.json(updated)
  } catch (err) {
    if (err instanceof IllegalBookingTransitionError || err instanceof NotOwnedBookingError) return c.json({ error: err.message }, 400)
    return c.json({ error: (err as Error).message }, 500)
  }
})

// ---------- Organization-owned bookable listings/bookings ----------

bookingsApi.post('/organizations/:organizationId/bookable-listings', async (c) => {
  const resolved = await resolveBookingProvider(c, 'bookings.manage')
  if (!resolved || !resolved.organizationId) return c.json({ error: 'Organization not found' }, 404)
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  if (body.cancellationPolicyId !== undefined && body.cancellationPolicyId !== null) {
    const owned = await c.env.DB.prepare('SELECT id FROM booking_cancellation_policies WHERE id = ? AND organization_id = ?').bind(body.cancellationPolicyId, resolved.organizationId).first()
    if (!owned) return c.json({ error: 'cancellationPolicyId not found or not owned by this organization' }, 404)
  }
  try {
    const id = await createBookableListing(c.env.DB, user.id, { ...body, organizationId: resolved.organizationId })
    return c.json({ id }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

bookingsApi.get('/organizations/:organizationId/bookable-listings', async (c) => {
  const resolved = await resolveBookingProvider(c, 'bookings.read')
  if (!resolved || !resolved.organizationId) return c.json({ error: 'Organization not found' }, 404)
  const listings = await getListingsForOrganization(c.env.DB, resolved.organizationId)
  return c.json(listings)
})

bookingsApi.get('/organizations/:organizationId/bookings', async (c) => {
  const resolved = await resolveBookingProvider(c, 'bookings.read')
  if (!resolved || !resolved.organizationId) return c.json({ error: 'Organization not found' }, 404)
  const bookings = await getBookingsForOrganization(c.env.DB, resolved.organizationId)
  return c.json(bookings)
})

bookingsApi.post('/organizations/:organizationId/cancellation-policies', async (c) => {
  const resolved = await resolveBookingProvider(c, 'bookings.manage')
  if (!resolved || !resolved.organizationId) return c.json({ error: 'Organization not found' }, 404)
  const body = await c.req.json().catch(() => ({}))
  try {
    const id = await createCancellationPolicy(c.env.DB, { organizationId: resolved.organizationId }, body)
    return c.json({ id }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

bookingsApi.get('/organizations/:organizationId/cancellation-policies', async (c) => {
  const resolved = await resolveBookingProvider(c, 'bookings.read')
  if (!resolved || !resolved.organizationId) return c.json({ error: 'Organization not found' }, 404)
  const policies = await getPoliciesForOrganization(c.env.DB, resolved.organizationId)
  return c.json(policies)
})
