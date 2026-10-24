import { Redis } from 'ioredis'
import type { RuntimeConfig } from '../config/runtime-config.js'

export interface DriverPresence {
  driverId: number
  vehicleId: number
  vehicleCategory: string
  zoneKey: string
  latitude: number
  longitude: number
  heartbeatAt: string
  expiresAt: string
}

export const PRESENCE_TTL_SECONDS = { min: 5, max: 300 }
export const ASSIGNMENT_TTL_SECONDS = { min: 5, max: 900 }

export function assertTtlSeconds(value: number, range: { min: number; max: number }, label: string): void {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new Error(`${label} must be an integer between ${range.min} and ${range.max} seconds`)
  }
}

export class RedisPresenceStore {
  private readonly redis: Redis

  constructor(config: RuntimeConfig) {
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 5000,
    })
  }

  async connect(): Promise<void> {
    await this.redis.connect()
    await this.redis.ping()
  }

  async close(): Promise<void> {
    await this.redis.quit()
  }

  async heartbeat(presence: DriverPresence, ttlSeconds = 45): Promise<void> {
    assertTtlSeconds(ttlSeconds, PRESENCE_TTL_SECONDS, 'Presence TTL')
    if (!Number.isFinite(presence.latitude) || presence.latitude < -90 || presence.latitude > 90) throw new Error('Invalid driver latitude')
    if (!Number.isFinite(presence.longitude) || presence.longitude < -180 || presence.longitude > 180) throw new Error('Invalid driver longitude')
    const presenceKey = `naijadrive:presence:${presence.driverId}`
    const zoneKey = `naijadrive:zone:${presence.zoneKey}:drivers`
    await this.redis.multi()
      .set(presenceKey, JSON.stringify(presence), 'EX', ttlSeconds)
      .sadd(zoneKey, String(presence.driverId))
      .expire(zoneKey, ttlSeconds)
      .exec()
  }

  async get(driverId: number): Promise<DriverPresence | null> {
    const value = await this.redis.get(`naijadrive:presence:${driverId}`)
    if (!value) return null
    try {
      return JSON.parse(value) as DriverPresence
    } catch {
      throw new Error(`Invalid presence payload for driver ${driverId}`)
    }
  }

  async claimAssignment(driverId: number, rideId: number, ttlSeconds = 120): Promise<boolean> {
    assertTtlSeconds(ttlSeconds, ASSIGNMENT_TTL_SECONDS, 'Assignment TTL')
    const result = await this.redis.call('SET', `naijadrive:assignment:${driverId}`, String(rideId), 'NX', 'EX', ttlSeconds)
    return result === 'OK'
  }

  async releaseAssignment(driverId: number, rideId: number): Promise<boolean> {
    const key = `naijadrive:assignment:${driverId}`
    const result = await this.redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      1,
      key,
      String(rideId),
    )
    return result === 1
  }

  async isReady(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG'
    } catch {
      return false
    }
  }
}
