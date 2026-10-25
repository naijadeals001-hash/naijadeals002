export type RoutingProviderId = 'osrm'

export type RoutingCoordinate = {
  latitude: number
  longitude: number
}

export type RoutingRequest = {
  pickup: RoutingCoordinate
  dropoff: RoutingCoordinate
}

export type RoutingResult = {
  provider: RoutingProviderId
  distanceMeters: number
  durationSeconds: number
}

export type RoutingFailureCode = 'ROUTING_UNAVAILABLE' | 'ROUTING_TIMEOUT' | 'ROUTING_PROVIDER_ERROR' | 'ROUTING_INVALID_RESPONSE'

export class RoutingError extends Error {
  readonly code: RoutingFailureCode

  constructor(code: RoutingFailureCode, message: string) {
    super(message)
    this.name = 'RoutingError'
    this.code = code
  }
}

export type RoutingProvider = {
  id: RoutingProviderId
  route(input: RoutingRequest): Promise<RoutingResult>
}

export type RoutingEnvironment = {
  NAIJADRIVE_ROUTING_PROVIDER?: string
  NAIJADRIVE_ROUTING_URL?: string
  NAIJADRIVE_ROUTING_TIMEOUT_MS?: string
}

type FetchLike = typeof fetch

type OsrmRouteResponse = {
  code?: unknown
  routes?: Array<{ distance?: unknown; duration?: unknown }>
}

export class OsrmRoutingProvider implements RoutingProvider {
  readonly id = 'osrm' as const
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetcher: FetchLike

  constructor(baseUrl: string, timeoutMs = 5000, fetcher: FetchLike = fetch) {
    this.baseUrl = baseUrl
    this.timeoutMs = timeoutMs
    this.fetcher = fetcher
  }

  async route(input: RoutingRequest): Promise<RoutingResult> {
    validateCoordinate(input.pickup)
    validateCoordinate(input.dropoff)

    const url = new URL(
      `route/v1/driving/${input.pickup.longitude},${input.pickup.latitude};${input.dropoff.longitude},${input.dropoff.latitude}`,
      `${this.baseUrl.replace(/\/$/, '')}/`,
    )
    url.searchParams.set('overview', 'false')
    url.searchParams.set('steps', 'false')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(url, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal })
      if (!response.ok) throw new RoutingError('ROUTING_PROVIDER_ERROR', `Routing provider returned HTTP ${response.status}`)
      let body: OsrmRouteResponse
      try {
        body = await response.json() as OsrmRouteResponse
      } catch {
        throw new RoutingError('ROUTING_INVALID_RESPONSE', 'Routing provider returned malformed JSON')
      }
      return { provider: 'osrm', ...parseOsrmRouteResponse(body) }
    } catch (error) {
      if (error instanceof RoutingError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new RoutingError('ROUTING_TIMEOUT', 'Routing provider timed out')
      }
      throw new RoutingError('ROUTING_PROVIDER_ERROR', 'Routing provider could not be reached')
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function parseOsrmRouteResponse(body: OsrmRouteResponse): Pick<RoutingResult, 'distanceMeters' | 'durationSeconds'> {
  const route = body.code === 'Ok' ? body.routes?.[0] : undefined
  const distanceMeters = route?.distance
  const durationSeconds = route?.duration
  if (
    !route
    || typeof distanceMeters !== 'number'
    || !Number.isFinite(distanceMeters)
    || distanceMeters < 0
    || typeof durationSeconds !== 'number'
    || !Number.isFinite(durationSeconds)
    || durationSeconds < 0
  ) {
    throw new RoutingError('ROUTING_INVALID_RESPONSE', 'Routing provider returned no valid route')
  }
  return { distanceMeters, durationSeconds }
}

export function createRoutingProvider(env: RoutingEnvironment): RoutingProvider | null {
  const provider = env.NAIJADRIVE_ROUTING_PROVIDER?.trim().toLowerCase()
  const baseUrl = env.NAIJADRIVE_ROUTING_URL?.trim()
  if (!provider || provider === 'none') return null
  if (provider !== 'osrm' || !baseUrl) return null
  const timeoutMs = Number(env.NAIJADRIVE_ROUTING_TIMEOUT_MS ?? 5000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 15000) return null
  return new OsrmRoutingProvider(baseUrl, timeoutMs)
}

function validateCoordinate(point: RoutingCoordinate): void {
  if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90) throw new RoutingError('ROUTING_INVALID_RESPONSE', 'Invalid pickup or destination latitude')
  if (!Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) throw new RoutingError('ROUTING_INVALID_RESPONSE', 'Invalid pickup or destination longitude')
}
