import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import type { Pool } from 'pg'
import { RedisPresenceStore } from '../infra/redis-presence.js'

@Controller('health')
export class HealthController {
  constructor(private readonly pool: Pool, private readonly presence: RedisPresenceStore) {}

  @Get()
  async health() {
    try {
      await this.pool.query('SELECT 1')
      const redis = await this.presence.isReady()
      if (!redis) throw new Error('Redis did not respond with PONG')
      return { healthy: true, postgres: 'ready', redis: 'ready' }
    } catch (error) {
      throw new ServiceUnavailableException({ healthy: false, error: error instanceof Error ? error.message : 'Infrastructure unavailable' })
    }
  }
}
