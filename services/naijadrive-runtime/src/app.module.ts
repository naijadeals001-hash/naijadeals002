import { Module } from '@nestjs/common'
import { RideController } from './http/ride.controller.js'
import { RideGateway } from './http/ride.gateway.js'
import { RideService } from './domain/ride.service.js'
import { InMemoryAuditPort, InMemoryRideRepository } from './infra/in-memory-ride.repository.js'

/** Development composition root. Production wiring will replace the in-memory adapter with PgRideRepository. */
@Module({
  controllers: [RideController],
  providers: [
    RideGateway,
    InMemoryRideRepository,
    InMemoryAuditPort,
    { provide: RideService, useFactory: (rides: InMemoryRideRepository, audit: InMemoryAuditPort) => new RideService(rides, audit), inject: [InMemoryRideRepository, InMemoryAuditPort] },
  ],
})
export class AppModule {}
