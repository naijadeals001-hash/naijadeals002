import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTIVE_NAIJADRIVE_ZONES, validateDrivePreviewBooking } from '../src/lib/drive-preview.ts'
import { estimateDrivePreviewFare } from '../src/lib/drive-preview-fare.ts'
import { createRoutingProvider, OsrmRoutingProvider, parseOsrmRouteResponse, RoutingError } from '../src/lib/routing.ts'

test('NaijaDrive preview accepts only configured Abuja pilot zones', () => {
  assert.deepEqual(ACTIVE_NAIJADRIVE_ZONES, ['abuja-central', 'gwarinpa', 'lokogoma'])
  assert.deepEqual(validateDrivePreviewBooking({ pickupZone: 'abuja-central', dropoffZone: 'gwarinpa' }), { ok: true })
})

test('NaijaDrive preview rejects missing and unsupported locations without persistence', () => {
  assert.deepEqual(validateDrivePreviewBooking(null), { ok: false, status: 400, code: 'INVALID_ZONES', error: 'Choose both a pickup and destination zone.' })
  assert.deepEqual(validateDrivePreviewBooking({ pickupZone: 'airport-axis', dropoffZone: 'gwarinpa' }), { ok: false, status: 400, code: 'ZONE_UNAVAILABLE', error: 'That location is outside the active Abuja pilot zones.' })
})

test('NaijaDrive public planning slice returns an explicitly simulated NGN fare without creating a booking', async () => {
  const result = await estimateDrivePreviewFare({ pickupZone: 'abuja-central', dropoffZone: 'gwarinpa', vehicleCategory: 'car' }, 'simulated', {})
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'simulated')
  assert.equal(result.isSimulated, true)
  assert.equal(result.currency, 'NGN')
  assert.equal(result.routeProvider, 'simulated-fixture')
  assert.match(result.disclaimer, /simulation only/i)
})

test('NaijaDrive public planning slice fails closed when routed fare lacks a provider', async () => {
  const result = await estimateDrivePreviewFare({ pickupZone: 'abuja-central', dropoffZone: 'gwarinpa', vehicleCategory: 'car' }, 'routed', {})
  assert.deepEqual(result, {
    ok: false,
    status: 503,
    code: 'ROUTING_UNAVAILABLE',
    error: 'Live road routing is unavailable. Configure a verified routing provider; no simulated fallback was used.',
  })
})

test('OSRM adapter converts a valid route response into meters and seconds', async () => {
  const provider = new OsrmRoutingProvider('https://router.test', 500, async () => new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 12000, duration: 1680 }] }), { status: 200 }))
  assert.deepEqual(await provider.route({ pickup: { latitude: 9, longitude: 7 }, dropoff: { latitude: 9.1, longitude: 7.1 } }), {
    provider: 'osrm',
    distanceMeters: 12000,
    durationSeconds: 1680,
  })
})

test('OSRM adapter rejects malformed route responses without fallback', () => {
  assert.throws(() => parseOsrmRouteResponse({ code: 'Ok', routes: [{ distance: -1, duration: 20 }] }), (error) => error instanceof RoutingError && error.code === 'ROUTING_INVALID_RESPONSE')
})

test('OSRM adapter maps provider failures and timeouts to structured routing errors', async () => {
  const providerError = new OsrmRoutingProvider('https://router.test', 500, async () => new Response('', { status: 503 }))
  await assert.rejects(() => providerError.route({ pickup: { latitude: 9, longitude: 7 }, dropoff: { latitude: 9.1, longitude: 7.1 } }), (error) => error instanceof RoutingError && error.code === 'ROUTING_PROVIDER_ERROR')

  const timeout = new OsrmRoutingProvider('https://router.test', 500, async () => { throw new DOMException('timed out', 'AbortError') })
  await assert.rejects(() => timeout.route({ pickup: { latitude: 9, longitude: 7 }, dropoff: { latitude: 9.1, longitude: 7.1 } }), (error) => error instanceof RoutingError && error.code === 'ROUTING_TIMEOUT')
})

test('routing provider configuration stays unavailable until explicitly configured', () => {
  assert.equal(createRoutingProvider({}), null)
  assert.equal(createRoutingProvider({ NAIJADRIVE_ROUTING_PROVIDER: 'osrm' }), null)
  assert.equal(createRoutingProvider({ NAIJADRIVE_ROUTING_PROVIDER: 'osrm', NAIJADRIVE_ROUTING_URL: 'http://127.0.0.1:9999', NAIJADRIVE_ROUTING_TIMEOUT_MS: '100' }), null)
  assert.equal(createRoutingProvider({ NAIJADRIVE_ROUTING_PROVIDER: 'osrm', NAIJADRIVE_ROUTING_URL: 'http://127.0.0.1:9999', NAIJADRIVE_ROUTING_TIMEOUT_MS: '5000' })?.id, 'osrm')
})

test('OSRM adapter rejects invalid coordinates before a provider call', async () => {
  const provider = new OsrmRoutingProvider('https://router.test', 500, async () => { throw new Error('network call should not happen') })
  await assert.rejects(() => provider.route({ pickup: { latitude: 91, longitude: 7 }, dropoff: { latitude: 9.1, longitude: 7.1 } }), (error) => error instanceof RoutingError && error.code === 'ROUTING_INVALID_RESPONSE')
})
