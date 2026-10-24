import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Pool } from 'pg'
import { loadRuntimeConfig } from './config/runtime-config.js'
import { RideService } from './domain/ride.service.js'
import { NaijaDealAuthGuard, RidePermissionGuard } from './http/auth.guard.js'
import { HealthController } from './http/health.controller.js'
import { DriverPresenceController } from './http/driver-presence.controller.js'
import { RideController } from './http/ride.controller.js'
import { RideGateway } from './http/ride.gateway.js'
import { NaijaDealIdentityClient } from './infra/identity-client.js'
import { PgAuditPort } from './infra/pg-audit.repository.js'
import { PgRideRepository } from './infra/pg-ride.repository.js'
import { createPostgresPool } from './infra/postgres.js'
import { RedisPresenceStore } from './infra/redis-presence.js'

const config = loadRuntimeConfig()
const pool = createPostgresPool(config)
const presence = new RedisPresenceStore(config)
const identity = new NaijaDealIdentityClient(config)

@Module({
  controllers: [HealthController, RideController, DriverPresenceController],
  providers: [
    Reflector,
    { provide: Pool, useValue: pool },
    { provide: RedisPresenceStore, useValue: presence },
    { provide: NaijaDealIdentityClient, useValue: identity },
    { provide: NaijaDealAuthGuard, useClass: NaijaDealAuthGuard },
    { provide: RidePermissionGuard, useClass: RidePermissionGuard },
    RideGateway,
    { provide: RideService, useFactory: () => new RideService(new PgRideRepository(pool), new PgAuditPort(pool), presence) },
  ],
  exports: [Pool, RedisPresenceStore, RideService],
})
export class AppModule {}
