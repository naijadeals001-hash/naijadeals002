import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { RideService } from '../domain/ride.service.js'
import { NaijaDealAuthGuard, RequireRidePermission, RidePermissionGuard } from './auth.guard.js'
import type { DriverEligibility, RideStatus } from '../domain/types.js'

@Controller('api/naijadrive/rides')
@UseGuards(NaijaDealAuthGuard, RidePermissionGuard)
export class RideController {
  constructor(private readonly rides: RideService) {}

  @Post()
  create(@Req() req: { user: { id: number } }, @Body() body: any) {
    return this.rides.createRide({
      customerUserId: req.user.id,
      pickup: body.pickup,
      dropoff: body.dropoff,
      pickupZone: body.pickupZone,
      dropoffZone: body.dropoffZone,
      vehicleCategory: body.vehicleCategory,
      distanceKm: body.distanceKm,
      durationMinutes: body.durationMinutes,
    })
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user: { id: number } }) {
    return this.rides.getRideForCustomer(Number(id), req.user.id)
  }

  @Patch(':id/status')
  transition(@Param('id') id: string, @Req() req: { user: { id: number; role: 'customer' | 'driver' | 'admin' | 'system' } }, @Body() body: { status: RideStatus; note?: string }) {
    return this.rides.transition(Number(id), req.user.id, req.user.role, body.status, body.note)
  }

  @Post(':id/assign')
  @RequireRidePermission('rides.dispatch')
  assign(@Param('id') id: string, @Req() req: { user: { id: number } }, @Body() driver: DriverEligibility) {
    return this.rides.assignDriver(Number(id), req.user.id, driver)
  }
}
