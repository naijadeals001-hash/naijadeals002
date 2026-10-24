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
    if (!Number.isFinite(presence.latitude) || presence.latitude < -90 || presence.latitude > 90) throw new Error('Invalid driver latitude')
    if (!Number.isFinite(presence.longitude) || presence.longitude < -180 || presence.longitude > 180) throw new Error('Invalid driver longitude')
    await this.redis.set(`naijadrive:presence:${presence.driverId}`, JSON.stringify(presence), 'EX', ttlSeconds)
    await this.redis.sadd(`naijadrive:zone:${presence.zoneKey}:drivers`, String(presence.driverId))
    await this.redis.expire(`naijadrive:zone:${presence.zoneKey}:drivers`, ttlSeconds)
  }

  async get(driverId: number): Promise<DriverPresence | null> {
    const value = await this.redis.get(`naijadrive:presence:${driverId}`)
    return value ? JSON.parse(value) as DriverPresence : null
  }

  async claimAssignment(driverId: number, rideId: number, ttlSeconds = 120): Promise<boolean> {
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
    return (await this.redis.ping()) === 'PONG'
  }
}
