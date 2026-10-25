import { estimateFareKobo } from '../../services/naijadrive-runtime/src/domain/fare.service.ts'
import { getAbujaFareRule } from '../../services/naijadrive-runtime/src/config/abuja.ts'
import type { VehicleCategory } from '../../services/naijadrive-runtime/src/domain/types.ts'
import { ACTIVE_NAIJADRIVE_ZONES, validateDrivePreviewBooking, type DrivePreviewBookingInput } from './drive-preview.ts'
import { createRoutingProvider, RoutingError, type RoutingEnvironment, type RoutingProvider, type RoutingRequest } from './routing.ts'

export type FareEstimateMode = 'simulated' | 'routed'

export type DrivePreviewFareResult =
  | {
      ok: true
      mode: FareEstimateMode
      isSimulated: boolean
      currency: 'NGN'
      pickupZone: string
      dropoffZone: string
      vehicleCategory: VehicleCategory
      distanceMeters: number
      distanceKm: number
      durationSeconds: number
      durationMinutes: number
      fareKobo: number
      fareNaira: string
      routeProvider: string
      disclaimer: string
    }
  | { ok: false; status: 400 | 503; error: string; code: string }

const SIMULATED_ROUTE_ESTIMATES: Record<string, { distanceMeters: number; durationSeconds: number }> = {
  'abuja-central:gwarinpa': { distanceMeters: 12000, durationSeconds: 1680 },
  'gwarinpa:abuja-central': { distanceMeters: 12000, durationSeconds: 1680 },
  'abuja-central:lokogoma': { distanceMeters: 14000, durationSeconds: 1920 },
  'lokogoma:abuja-central': { distanceMeters: 14000, durationSeconds: 1920 },
  'gwarinpa:lokogoma': { distanceMeters: 16000, durationSeconds: 2160 },
  'lokogoma:gwarinpa': { distanceMeters: 16000, durationSeconds: 2160 },
  'abuja-central:abuja-central': { distanceMeters: 800, durationSeconds: 240 },
  'gwarinpa:gwarinpa': { distanceMeters: 800, durationSeconds: 240 },
  'lokogoma:lokogoma': { distanceMeters: 800, durationSeconds: 240 },
}

export async function estimateDrivePreviewFare(
  input: DrivePreviewBookingInput | null,
  mode: FareEstimateMode,
  routingEnvironment: RoutingEnvironment,
  routingProvider: RoutingProvider | null = createRoutingProvider(routingEnvironment),
): Promise<DrivePreviewFareResult> {
  const validation = validateDrivePreviewBooking(input)
  if (!validation.ok) return validation

  if (input?.vehicleCategory !== 'car') {
    return {
      ok: false,
      status: 400,
      code: 'VEHICLE_CATEGORY_UNAVAILABLE',
      error: 'Only the car category has a development fare rule; booking remains disabled.',
    }
  }

  const pickupZone = input.pickupZone as typeof ACTIVE_NAIJADRIVE_ZONES[number]
  const dropoffZone = input.dropoffZone as typeof ACTIVE_NAIJADRIVE_ZONES[number]
  const routeKey = `${pickupZone}:${dropoffZone}`

  if (mode === 'simulated') {
    const simulatedRoute = SIMULATED_ROUTE_ESTIMATES[routeKey]
    if (!simulatedRoute) {
      return { ok: false, status: 400, code: 'ROUTE_SIMULATION_UNAVAILABLE', error: 'A simulated route is not available for this zone pair.' }
    }
    return buildFareResponse(pickupZone, dropoffZone, simulatedRoute, 'simulated', 'simulated-fixture')
  }

  if (!routingProvider) {
    return {
      ok: false,
      status: 503,
      code: 'ROUTING_UNAVAILABLE',
      error: 'Live road routing is unavailable. Configure a verified routing provider; no simulated fallback was used.',
    }
  }

  const routingRequest: RoutingRequest = {
    pickup: zoneCenter(pickupZone),
    dropoff: zoneCenter(dropoffZone),
  }
  try {
    const routed = await routingProvider.route(routingRequest)
    return buildFareResponse(pickupZone, dropoffZone, routed, 'routed', routed.provider)
  } catch (error) {
    const routingError = error instanceof RoutingError ? error : new RoutingError('ROUTING_PROVIDER_ERROR', 'Routing provider failed')
    return {
      ok: false,
      status: 503,
      code: routingError.code,
      error: routingError.message,
    }
  }
}

function buildFareResponse(
  pickupZone: string,
  dropoffZone: string,
  route: { distanceMeters: number; durationSeconds: number },
  mode: FareEstimateMode,
  routeProvider: string,
): DrivePreviewFareResult {
  const distanceKm = route.distanceMeters / 1000
  const durationMinutes = route.durationSeconds / 60
  const fareKobo = estimateFareKobo({ distanceKm, durationMinutes, rule: getAbujaFareRule('car') })
  return {
    ok: true,
    mode,
    isSimulated: mode === 'simulated',
    currency: 'NGN',
    pickupZone,
    dropoffZone,
    vehicleCategory: 'car',
    distanceMeters: route.distanceMeters,
    distanceKm,
    durationSeconds: route.durationSeconds,
    durationMinutes,
    fareKobo,
    fareNaira: (fareKobo / 100).toFixed(2),
    routeProvider,
    disclaimer: mode === 'simulated'
      ? 'Development simulation only. Distance, duration and fare are not a live road quote; no booking was created.'
      : 'Routed estimate from a configured provider. This is not a booking and no ride was created.',
  }
}

function zoneCenter(zone: typeof ACTIVE_NAIJADRIVE_ZONES[number]): { latitude: number; longitude: number } {
  const centers = {
    'abuja-central': { latitude: 9.0579, longitude: 7.4951 },
    gwarinpa: { latitude: 9.1057, longitude: 7.4042 },
    lokogoma: { latitude: 8.9856, longitude: 7.4295 },
  }
  return centers[zone]
}
