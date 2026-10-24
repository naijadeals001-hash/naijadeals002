import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { NaijaDealAuthGuard } from './auth.guard.js'
import { RedisPresenceStore } from '../infra/redis-presence.js'
import type { NaijaDealUser } from '../infra/identity-client.js'

@Controller('api/naijadrive/driver')
@UseGuards(NaijaDealAuthGuard)
export class DriverPresenceController {
  constructor(private readonly presence: RedisPresenceStore) {}

  @Post('presence')
  async heartbeat(@Req() request: FastifyRequest & { user?: NaijaDealUser }, @Body() body: { vehicleId: number; vehicleCategory: string; zoneKey: string; latitude: number; longitude: number; availabilityStatus: 'offline' | 'available' }) {
    const user = request.user
    if (!user?.driverProfileId || user.driverStatus !== 'active') {
      return { error: 'Approved active driver profile required' }
    }
    if (!Number.isInteger(body.vehicleId) || !body.vehicleCategory || !body.zoneKey) {
      return { error: 'vehicleId, vehicleCategory and zoneKey are required' }
    }
    await this.presence.heartbeat({
      driverId: user.driverProfileId,
      vehicleId: body.vehicleId,
      vehicleCategory: body.vehicleCategory,
      zoneKey: body.zoneKey,
      latitude: body.latitude,
      longitude: body.longitude,
      heartbeatAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 45_000).toISOString(),
    })
    return { accepted: true, expiresInSeconds: 45 }
  }
}
