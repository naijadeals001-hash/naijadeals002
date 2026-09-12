/**
 * Logistics Engine 2.0 — Universal Delivery, Dispatch, Driver, Route,
 * Tracking & Fulfillment API.
 *
 * ONE generic API surface consumed by every vertical (NaijaSend as the
 * primary marketplace, NaijaShop/Fresh/Eats/Farm/Auto/Health as
 * fulfillment consumers) — mirrors api-bookings.ts's "one engine, many
 * verticals" discipline exactly.
 *
 * PATH NAMESPACE NOTE (learned from Booking Engine 2.0's own documented
 * collision, api-bookings.ts's header comment): Hono applies every
 * mounted sub-app's app.use() wildcard middleware against the SHARED
 * '/api' path space in registration order, not scoped per sub-app.
 * api-provider.ts already owns '/providers/me/*'; this engine therefore
 * uses '/logistics-drivers/me/*' and '/logistics-providers/me/*' —
 * distinct prefixes, zero collision risk. This module is registered in
 * index.tsx immediately after bookingsApi/versionRoute, BEFORE any
 * sub-app carrying a bare '*' wildcard (serviceRequestsApi, providerApi,
 * sellerApi, etc) — same fix pattern as Booking Engine 2.0.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { resolveMembership } from '../lib/organizations'
import { createLogisticsQuote, getQuoteForCustomer } from '../lib/logistics-pricing'
import {
  createStandaloneShipment,
  createReturnShipment,
  getShipmentForCustomer,
  getShipmentByTrackingNumber,
  getShipmentsForCustomer,
  getAddressesForShipment,
  getItemsForShipment,
  NotOwnedShipmentError,
  LogisticsShipmentError,
} from '../lib/logistics-shipments'
import {
  getEventsForShipment,
  getCustomerTrackingView,
  recordDriverLocation,
  LogisticsTrackingError,
} from '../lib/logistics-tracking'
import {
  resolveDriverStatus,
  requireActiveDriver,
  createDriverProfile,
  setDriverOperationalStatus,
  getDriverJobs,
  getAvailableJobsForDriver,
  createLogisticsProvider,
  resolveLogisticsProviderForUser,
  addVehicleToProvider,
  getVehiclesForProvider,
  assignVehicleToDriver,
  getVehicleTypes,
  getDriversForProvider,
  LogisticsDriverError,
} from '../lib/logistics-drivers'
import {
  requestDispatch,
  rankCandidateDrivers,
  assignDriverToJob,
  acceptJob,
  reassignJob,
  getJob,
  getJobForDriver,
  LogisticsDispatchError,
  NotOwnedJobError,
  type JobType,
} from '../lib/logistics-dispatch'
import {
  generateDeliveryOtp,
  markJobEnRoute,
  markJobArrived,
  completeJob,
  recordFailedAttempt,
  getAttemptsForJob,
  LogisticsDeliveryError,
  InvalidOtpError,
  type FailureReason,
} from '../lib/logistics-delivery'

export const logisticsApi = new Hono<AppEnv>()

// ============================================================
// PUBLIC — no auth. Section 26/27: customer-safe tracking-number lookup,
// zone/vehicle-type reference data.
// ============================================================

logisticsApi.get('/logistics/vehicle-types', async (c) => {
  const types = await getVehicleTypes(c.env.DB)
  return c.json(types)
})

logisticsApi.get('/logistics/zones', async (c) => {
  const countryIso = c.req.query('country') ?? 'NG'
  const { results } = await c.env.DB.prepare('SELECT * FROM delivery_zones WHERE country_iso = ? AND is_active = 1 ORDER BY name ASC').bind(countryIso).all<any>()
  return c.json(results)
})

/** Public tracking-number lookup (section 26/27). Reveals only tracking-relevant fields — never the full internal shipment row (no customer PII beyond what's needed to confirm "this is my package"). */
logisticsApi.get('/track/:trackingNumber', async (c) => {
  const shipment = await getShipmentByTrackingNumber(c.env.DB, c.req.param('trackingNumber'))
  if (!shipment) return c.json({ error: 'Tracking number not found' }, 404)
  const events = await getEventsForShipment(c.env.DB, shipment.id, 50)
  return c.json({
    tracking_number: shipment.tracking_number,
    status: shipment.status,
    fulfillment_category: shipment.fulfillment_category,
    speed_tier: shipment.speed_tier,
    events: events.map((e: any) => ({ status: e.status, note: e.note, created_at: e.created_at })),
  })
})

// ============================================================
// AUTHENTICATED — customer-facing quotes & shipments
// ============================================================

logisticsApi.use('/logistics/quotes*', requireAuth)
logisticsApi.use('/shipments', requireAuth)
logisticsApi.use('/shipments/*', requireAuth)
logisticsApi.use('/logistics-drivers/me*', requireAuth)
logisticsApi.use('/logistics-providers/me*', requireAuth)
logisticsApi.use('/pickup-jobs/*', requireAuth)
logisticsApi.use('/delivery-jobs/*', requireAuth)
logisticsApi.use('/dispatch*', requireAuth)

logisticsApi.post('/logistics/quotes', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{
    origin_country_iso: string; destination_country_iso: string
    origin_zone_key?: string; destination_zone_key?: string
    vehicle_type_id: number; speed_tier: string; declared_weight_kg: number; package_count?: number
  }>()
  if (!body.origin_country_iso || !body.destination_country_iso || !body.vehicle_type_id || !body.speed_tier) {
    return c.json({ error: 'origin_country_iso, destination_country_iso, vehicle_type_id and speed_tier are required' }, 400)
  }
  const quote = await createLogisticsQuote(c.env.DB, user.id, {
    customerUserId: user.id,
    originCountryIso: body.origin_country_iso,
    destinationCountryIso: body.destination_country_iso,
    originZoneKey: body.origin_zone_key ?? null,
    destinationZoneKey: body.destination_zone_key ?? null,
    vehicleTypeId: body.vehicle_type_id,
    speedTier: body.speed_tier,
    declaredWeightKg: body.declared_weight_kg ?? 1,
    packageCount: body.package_count ?? 1,
  })
  return c.json(quote, 201)
})

logisticsApi.get('/logistics/quotes/:id', async (c) => {
  const user = c.get('user')!
  const quote = await getQuoteForCustomer(c.env.DB, user.id, Number(c.req.param('id')))
  if (!quote) return c.json({ error: 'Quote not found' }, 404)
  return c.json(quote)
})

/** NaijaSend standalone shipment booking (section 46's full customer flow: quote -> book -> pay -> track). */
logisticsApi.post('/shipments', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>()
  if (!body.pickup || !body.dropoff || !body.vehicle_type_id || !body.speed_tier || !body.quoted_price_kobo) {
    return c.json({ error: 'pickup, dropoff, vehicle_type_id, speed_tier and quoted_price_kobo are required' }, 400)
  }
  try {
    const result = await createStandaloneShipment(c.env.DB, user.id, {
      originCountryIso: body.origin_country_iso ?? 'NG',
      destinationCountryIso: body.destination_country_iso ?? 'NG',
      originZoneKey: body.origin_zone_key ?? null,
      destinationZoneKey: body.destination_zone_key ?? null,
      vehicleTypeId: body.vehicle_type_id,
      speedTier: body.speed_tier,
      fulfillmentCategory: body.fulfillment_category ?? 'parcel',
      declaredWeightKg: body.declared_weight_kg ?? 1,
      packageCount: body.package_count ?? 1,
      declaredValueKobo: body.declared_value_kobo ?? null,
      isFragile: !!body.is_fragile,
      isTemperatureSensitive: !!body.is_temperature_sensitive,
      parcelDescription: body.parcel_description ?? null,
      specialHandlingNotes: body.special_handling_notes ?? null,
      quotedPriceKobo: body.quoted_price_kobo,
      rateCardId: body.rate_card_id ?? null,
      logisticsQuoteId: body.logistics_quote_id ?? null,
      pickup: body.pickup,
      dropoff: body.dropoff,
    })
    return c.json(result, 201)
  } catch (err) {
    if (err instanceof LogisticsShipmentError) return c.json({ error: err.message }, 400)
    throw err
  }
})

logisticsApi.get('/shipments', async (c) => {
  const user = c.get('user')!
  const shipments = await getShipmentsForCustomer(c.env.DB, user.id)
  return c.json(shipments)
})

logisticsApi.get('/shipments/:id', async (c) => {
  const user = c.get('user')!
  const shipment = await getShipmentForCustomer(c.env.DB, user.id, Number(c.req.param('id')))
  if (!shipment) return c.json({ error: 'Shipment not found' }, 404)
  const [addresses, items] = await Promise.all([getAddressesForShipment(c.env.DB, shipment.id), getItemsForShipment(c.env.DB, shipment.id)])
  return c.json({ ...shipment, addresses, items })
})

logisticsApi.get('/shipments/:id/tracking', async (c) => {
  const user = c.get('user')!
  const shipment = await getShipmentForCustomer(c.env.DB, user.id, Number(c.req.param('id')))
  if (!shipment) return c.json({ error: 'Shipment not found' }, 404)
  const view = await getCustomerTrackingView(c.env.DB, shipment.id)
  return c.json(view)
})

logisticsApi.get('/shipments/:id/events', async (c) => {
  const user = c.get('user')!
  const shipment = await getShipmentForCustomer(c.env.DB, user.id, Number(c.req.param('id')))
  if (!shipment) return c.json({ error: 'Shipment not found' }, 404)
  const events = await getEventsForShipment(c.env.DB, shipment.id)
  return c.json(events)
})

logisticsApi.post('/shipments/:id/return', async (c) => {
  const user = c.get('user')!
  try {
    const result = await createReturnShipment(c.env.DB, user.id, Number(c.req.param('id')))
    return c.json(result, 201)
  } catch (err) {
    if (err instanceof NotOwnedShipmentError) return c.json({ error: err.message }, 404)
    if (err instanceof LogisticsShipmentError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// ============================================================
// DISPATCH — merchant/admin-triggered. Section 17.
// ============================================================

logisticsApi.post('/dispatch', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ shipment_id: number }>()
  const shipment = await getShipmentForCustomer(c.env.DB, user.id, body.shipment_id)
    ?? await c.env.DB.prepare('SELECT * FROM shipments WHERE id = ? AND vendor_id IN (SELECT id FROM vendors WHERE user_id = ?)').bind(body.shipment_id, user.id).first<any>()
  if (!shipment) return c.json({ error: 'Shipment not found or not accessible' }, 404)
  try {
    const result = await requestDispatch(c.env.DB, body.shipment_id)
    return c.json(result, 201)
  } catch (err) {
    if (err instanceof LogisticsDispatchError) return c.json({ error: err.message }, 400)
    if (err instanceof LogisticsTrackingError) return c.json({ error: err.message }, 409)
    throw err
  }
})

/**
 * SECURITY FIX (Logistics Proof Gate, live cross-tenant test): this route
 * previously had NO authorization check at all — any authenticated user
 * could assign/reassign ANY job on ANY shipment just by guessing its id.
 * Scoped to: the shipment's owning customer, the fulfilling vendor, or a
 * platform admin (no dedicated fleet/Control Center dispatch UI/role exists
 * yet — documented gap, this is the minimum honest bar, not the final
 * authorization model).
 */
async function requireDispatchAuthority(c: any, shipmentId: number): Promise<boolean> {
  const user = c.get('user')!
  if (user.role === 'admin') return true
  const owned = await getShipmentForCustomer(c.env.DB, user.id, shipmentId)
  if (owned) return true
  const vendorOwned = await c.env.DB.prepare('SELECT id FROM shipments WHERE id = ? AND vendor_id IN (SELECT id FROM vendors WHERE user_id = ?)').bind(shipmentId, user.id).first()
  return !!vendorOwned
}

logisticsApi.use('/dispatch/:jobType/:id/assign', requireAuth)
logisticsApi.use('/dispatch/:jobType/:id/reassign', requireAuth)

logisticsApi.post('/dispatch/:jobType/:id/assign', async (c) => {
  const jobType = c.req.param('jobType') as JobType
  if (jobType !== 'pickup' && jobType !== 'delivery') return c.json({ error: 'jobType must be pickup or delivery' }, 400)
  const body = await c.req.json<{ driver_id?: number }>()
  const jobId = Number(c.req.param('id'))

  const jobForAuth = await getJob(c.env.DB, jobType, jobId)
  if (!jobForAuth) return c.json({ error: 'Job not found' }, 404)
  if (!(await requireDispatchAuthority(c, jobForAuth.shipment_id))) {
    return c.json({ error: 'You are not permitted to dispatch this shipment' }, 403)
  }

  let driverId = body.driver_id
  if (!driverId) {
    const job = await getJob(c.env.DB, jobType, jobId)
    if (!job) return c.json({ error: 'Job not found' }, 404)
    const shipment = await c.env.DB.prepare('SELECT origin_country_iso, vehicle_type_id FROM shipments WHERE id = ?').bind(job.shipment_id).first<any>()
    const candidates = await rankCandidateDrivers(c.env.DB, { countryIso: shipment?.origin_country_iso ?? 'NG', vehicleTypeId: shipment?.vehicle_type_id })
    if (candidates.length === 0) return c.json({ error: 'No available drivers found for automatic dispatch' }, 409)
    driverId = candidates[0].id
  }

  try {
    await assignDriverToJob(c.env.DB, jobType, jobId, driverId, 'admin')
    return c.json({ ok: true, driver_id: driverId })
  } catch (err) {
    if (err instanceof LogisticsDispatchError) return c.json({ error: err.message }, 409)
    throw err
  }
})

logisticsApi.post('/dispatch/:jobType/:id/reassign', async (c) => {
  const jobType = c.req.param('jobType') as JobType
  if (jobType !== 'pickup' && jobType !== 'delivery') return c.json({ error: 'jobType must be pickup or delivery' }, 400)
  const user = c.get('user')!
  const jobId = Number(c.req.param('id'))
  const jobForAuth = await getJob(c.env.DB, jobType, jobId)
  if (!jobForAuth) return c.json({ error: 'Job not found' }, 404)
  if (!(await requireDispatchAuthority(c, jobForAuth.shipment_id))) {
    return c.json({ error: 'You are not permitted to dispatch this shipment' }, 403)
  }
  const body = await c.req.json<{ reason?: string }>()
  try {
    await reassignJob(c.env.DB, jobType, jobId, user.id, body.reason ?? 'Reassigned by admin')
    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof LogisticsDispatchError) return c.json({ error: err.message }, 400)
    if (err instanceof LogisticsTrackingError) return c.json({ error: err.message }, 409)
    throw err
  }
})

// ============================================================
// DRIVER — self-service onboarding, status, location, jobs. Sections
// 11-13, 47.
// ============================================================

logisticsApi.get('/logistics-drivers/me', async (c) => {
  const user = c.get('user')!
  const resolution = await resolveDriverStatus(c.env.DB, user.id)
  return c.json(resolution)
})

logisticsApi.post('/logistics-drivers/me/onboard', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ license_number: string; country_iso?: string; provider_id?: number }>()
  if (!body.license_number) return c.json({ error: 'license_number is required' }, 400)
  try {
    const driverId = await createDriverProfile(c.env.DB, user.id, { licenseNumber: body.license_number, countryIso: body.country_iso, providerId: body.provider_id ?? null })
    return c.json({ driver_id: driverId }, 201)
  } catch (err) {
    if (err instanceof LogisticsDriverError) return c.json({ error: err.message }, 409)
    throw err
  }
})

logisticsApi.patch('/logistics-drivers/me/status', requireActiveDriver, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ status: 'offline' | 'available' | 'on_break' }>()
  try {
    await setDriverOperationalStatus(c.env.DB, user.id, body.status)
    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof LogisticsDriverError) return c.json({ error: err.message }, 400)
    throw err
  }
})

/** Section 25: driver app sends location updates. Rate-limiting NOT implemented (documented gap — no rate-limit infra exists anywhere in this codebase yet, see final report). */
logisticsApi.post('/logistics-drivers/me/location', requireActiveDriver, async (c) => {
  const driver = c.get('driverProfile' as any) as any
  const body = await c.req.json<{ client_event_id: string; latitude: number; longitude: number; accuracy_m?: number; shipment_id?: number }>()
  if (!body.client_event_id || body.latitude == null || body.longitude == null) {
    return c.json({ error: 'client_event_id, latitude and longitude are required' }, 400)
  }
  await recordDriverLocation(c.env.DB, driver.id, body.client_event_id, body.latitude, body.longitude, { shipmentId: body.shipment_id ?? null, accuracyM: body.accuracy_m ?? null })
  return c.json({ ok: true })
})

logisticsApi.get('/logistics-drivers/me/jobs', requireActiveDriver, async (c) => {
  const driver = c.get('driverProfile' as any) as any
  const jobs = await getDriverJobs(c.env.DB, driver.id)
  return c.json(jobs)
})

logisticsApi.get('/logistics-drivers/me/jobs/available', requireActiveDriver, async (c) => {
  const driver = c.get('driverProfile' as any) as any
  const jobs = await getAvailableJobsForDriver(c.env.DB, driver.id)
  return c.json(jobs)
})

// ============================================================
// PICKUP/DELIVERY JOB EXECUTION — driver-facing. Sections 6-8, 33-37.
// ============================================================

function jobRoutes(jobType: JobType) {
  const prefix = jobType === 'pickup' ? '/pickup-jobs' : '/delivery-jobs'

  logisticsApi.post(`${prefix}/:id/accept`, requireActiveDriver, async (c) => {
    const driver = c.get('driverProfile' as any) as any
    try {
      await acceptJob(c.env.DB, jobType, Number(c.req.param('id')), driver.id)
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof NotOwnedJobError) return c.json({ error: err.message }, 404)
      throw err
    }
  })

  logisticsApi.post(`${prefix}/:id/en-route`, requireActiveDriver, async (c) => {
    const driver = c.get('driverProfile' as any) as any
    const body = await c.req.json<{ latitude?: number; longitude?: number }>().catch(() => ({} as { latitude?: number; longitude?: number }))
    try {
      await markJobEnRoute(c.env.DB, jobType, Number(c.req.param('id')), driver.id, body.latitude != null && body.longitude != null ? { latitude: body.latitude, longitude: body.longitude } : undefined)
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof NotOwnedJobError) return c.json({ error: err.message }, 404)
      if (err instanceof LogisticsTrackingError) return c.json({ error: err.message }, 409)
      throw err
    }
  })

  logisticsApi.post(`${prefix}/:id/arrived`, requireActiveDriver, async (c) => {
    const driver = c.get('driverProfile' as any) as any
    const body = await c.req.json<{ latitude?: number; longitude?: number }>().catch(() => ({} as { latitude?: number; longitude?: number }))
    try {
      await markJobArrived(c.env.DB, jobType, Number(c.req.param('id')), driver.id, body.latitude != null && body.longitude != null ? { latitude: body.latitude, longitude: body.longitude } : undefined)
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof NotOwnedJobError) return c.json({ error: err.message }, 404)
      if (err instanceof LogisticsTrackingError) return c.json({ error: err.message }, 409)
      throw err
    }
  })

  /** Section 34: generates a customer-facing OTP for this job's completion proof. */
  logisticsApi.post(`${prefix}/:id/request-otp`, requireActiveDriver, async (c) => {
    const driver = c.get('driverProfile' as any) as any
    const job = await getJobForDriver(c.env.DB, jobType, Number(c.req.param('id')), driver.id)
    if (!job) return c.json({ error: 'Job not found' }, 404)
    const otp = await generateDeliveryOtp(c.env.DB, jobType, job.id)
    // In production this would be sent via the Notification Engine to the
    // customer's phone, never returned in this response. Returned here
    // ONLY because no SMS/notification provider is wired yet (documented
    // gap) — this is an honest placeholder, not a security-safe pattern
    // to keep once notifications are integrated.
    return c.json({ otp_sent: true, otp_debug_only: otp })
  })

  logisticsApi.post(`${prefix}/:id/complete`, requireActiveDriver, async (c) => {
    const driver = c.get('driverProfile' as any) as any
    const body = await c.req.json<{ proof_type: 'otp' | 'signature' | 'photo' | 'qr' | 'none'; otp_code?: string; signature_ref?: string; photo_ref?: string; latitude?: number; longitude?: number }>()
    try {
      await completeJob(c.env.DB, jobType, Number(c.req.param('id')), driver.id, {
        type: body.proof_type,
        otpCode: body.otp_code,
        signatureRef: body.signature_ref,
        photoRef: body.photo_ref,
        location: body.latitude != null && body.longitude != null ? { latitude: body.latitude, longitude: body.longitude } : undefined,
      })
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof InvalidOtpError) return c.json({ error: err.message }, 400)
      if (err instanceof NotOwnedJobError) return c.json({ error: err.message }, 404)
      if (err instanceof LogisticsDeliveryError) return c.json({ error: err.message }, 400)
      if (err instanceof LogisticsTrackingError) return c.json({ error: err.message }, 409)
      throw err
    }
  })

  logisticsApi.post(`${prefix}/:id/attempt`, requireActiveDriver, async (c) => {
    const driver = c.get('driverProfile' as any) as any
    const body = await c.req.json<{ reason: FailureReason; notes?: string; latitude?: number; longitude?: number }>()
    try {
      await recordFailedAttempt(c.env.DB, jobType, Number(c.req.param('id')), driver.id, body.reason, body.notes, body.latitude != null && body.longitude != null ? { latitude: body.latitude, longitude: body.longitude } : undefined)
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof NotOwnedJobError) return c.json({ error: err.message }, 404)
      if (err instanceof LogisticsTrackingError) return c.json({ error: err.message }, 409)
      throw err
    }
  })

  // SECURITY FIX (Logistics Proof Gate, live cross-tenant test): this route
  // was reading attempts by a bare job id with NO ownership check, letting
  // any authenticated driver read another driver's job attempt history
  // (including GPS coordinates) by guessing/incrementing the id. Now
  // scoped through getJobForDriver exactly like every other job route.
  logisticsApi.get(`${prefix}/:id/attempts`, requireActiveDriver, async (c) => {
    const driver = c.get('driverProfile' as any) as any
    const job = await getJobForDriver(c.env.DB, jobType, Number(c.req.param('id')), driver.id)
    if (!job) return c.json({ error: 'Job not found or not accessible to this actor' }, 404)
    const attempts = await getAttemptsForJob(c.env.DB, jobType, job.id)
    return c.json(attempts)
  })
}

jobRoutes('pickup')
jobRoutes('delivery')

// ============================================================
// FLEET / LOGISTICS PROVIDER — sections 15-16, 48.
// ============================================================

logisticsApi.get('/logistics-providers/me', async (c) => {
  const user = c.get('user')!
  const provider = await resolveLogisticsProviderForUser(c.env.DB, user.id)
  return c.json(provider ?? null)
})

logisticsApi.post('/logistics-providers/me', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ provider_name: string; country_iso?: string; contact_phone?: string; contact_email?: string; organization_id?: number }>()
  if (!body.provider_name) return c.json({ error: 'provider_name is required' }, 400)
  try {
    const providerId = await createLogisticsProvider(c.env.DB, user.id, { providerName: body.provider_name, countryIso: body.country_iso, contactPhone: body.contact_phone, contactEmail: body.contact_email, organizationId: body.organization_id ?? null })
    return c.json({ provider_id: providerId }, 201)
  } catch (err) {
    if (err instanceof LogisticsDriverError) return c.json({ error: err.message }, 409)
    throw err
  }
})

logisticsApi.get('/logistics-providers/me/vehicles', async (c) => {
  const user = c.get('user')!
  const provider = await resolveLogisticsProviderForUser(c.env.DB, user.id)
  if (!provider) return c.json({ error: 'No logistics provider profile found' }, 404)
  const vehicles = await getVehiclesForProvider(c.env.DB, provider.id)
  return c.json(vehicles)
})

logisticsApi.post('/logistics-providers/me/vehicles', async (c) => {
  const user = c.get('user')!
  const provider = await resolveLogisticsProviderForUser(c.env.DB, user.id)
  if (!provider) return c.json({ error: 'No logistics provider profile found' }, 404)
  const body = await c.req.json<{ vehicle_type_id: number; registration_number: string; country_iso?: string; make?: string; model?: string; year?: number; weight_capacity_kg?: number; base_city?: string }>()
  if (!body.vehicle_type_id || !body.registration_number) return c.json({ error: 'vehicle_type_id and registration_number are required' }, 400)
  const vehicleId = await addVehicleToProvider(c.env.DB, provider.id, {
    vehicleTypeId: body.vehicle_type_id,
    registrationNumber: body.registration_number,
    countryIso: body.country_iso,
    make: body.make ?? null,
    model: body.model ?? null,
    year: body.year ?? null,
    weightCapacityKg: body.weight_capacity_kg ?? null,
    baseCity: body.base_city ?? null,
  })
  return c.json({ vehicle_id: vehicleId }, 201)
})

logisticsApi.get('/logistics-providers/me/drivers', async (c) => {
  const user = c.get('user')!
  const provider = await resolveLogisticsProviderForUser(c.env.DB, user.id)
  if (!provider) return c.json({ error: 'No logistics provider profile found' }, 404)
  const drivers = await getDriversForProvider(c.env.DB, provider.id)
  return c.json(drivers)
})

logisticsApi.post('/logistics-providers/me/drivers/:driverId/vehicles/:vehicleId', async (c) => {
  const user = c.get('user')!
  const provider = await resolveLogisticsProviderForUser(c.env.DB, user.id)
  if (!provider) return c.json({ error: 'No logistics provider profile found' }, 404)
  const driverId = Number(c.req.param('driverId'))
  // Ownership check: driver must belong to THIS provider's fleet.
  const driver = await c.env.DB.prepare('SELECT id FROM driver_profiles WHERE id = ? AND provider_id = ?').bind(driverId, provider.id).first<{ id: number }>()
  if (!driver) return c.json({ error: 'Driver not found in your fleet' }, 404)
  await assignVehicleToDriver(c.env.DB, driverId, Number(c.req.param('vehicleId')))
  return c.json({ ok: true })
})

// ============================================================
// ORGANIZATION-SCOPED variants (fleet/merchant orgs — mirrors
// api-bookings.ts's organization pattern, reusing the EXISTING
// 'shipments.read'/'shipments.manage'/'drivers.read'/'drivers.manage'
// permissions already seeded in migration 0037).
// ============================================================

logisticsApi.use('/organizations/:organizationId/shipments*', requireAuth)
logisticsApi.use('/organizations/:organizationId/drivers*', requireAuth)

logisticsApi.get('/organizations/:organizationId/shipments', async (c) => {
  const user = c.get('user')!
  const organizationId = Number(c.req.param('organizationId'))
  const membership = await resolveMembership(c.env.DB, user.id, organizationId)
  if (!membership || !membership.permissionKeys.has('shipments.read')) return c.json({ error: 'Organization not found' }, 404)
  const { results } = await c.env.DB
    .prepare(`SELECT s.* FROM shipments s JOIN vendors v ON v.id = s.vendor_id WHERE v.organization_id = ? ORDER BY s.id DESC LIMIT 100`)
    .bind(organizationId)
    .all<any>()
  return c.json(results)
})

logisticsApi.get('/organizations/:organizationId/drivers', async (c) => {
  const user = c.get('user')!
  const organizationId = Number(c.req.param('organizationId'))
  const membership = await resolveMembership(c.env.DB, user.id, organizationId)
  if (!membership || !membership.permissionKeys.has('drivers.read')) return c.json({ error: 'Organization not found' }, 404)
  const { results } = await c.env.DB.prepare('SELECT * FROM driver_profiles WHERE identity_organization_id = ? ORDER BY id DESC').bind(organizationId).all<any>()
  return c.json(results)
})
