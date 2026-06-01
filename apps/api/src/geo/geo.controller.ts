import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { GeoService } from './geo.service';
import {
  boundsSchema,
  nearbySchema,
  proximityPingSchema,
  type BoundsDto,
  type NearbyDto,
  type ProximityPingDto,
} from './dto/geo.dto';

@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('members')
  members(
    @CurrentUser() me: JwtUserPayload,
    @Query(new ZodValidationPipe(boundsSchema)) dto: BoundsDto,
  ) {
    return this.geo.getMarkers(me.sub, dto);
  }

  @Public()
  @Get('stats')
  stats() {
    return this.geo.getStats();
  }

  @Get('nearby')
  nearby(
    @CurrentUser() me: JwtUserPayload,
    @Query(new ZodValidationPipe(nearbySchema)) dto: NearbyDto,
  ) {
    return this.geo.getNearby(me.sub, dto);
  }

  @Post('proximity/ping')
  proximityPing(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(proximityPingSchema)) dto: ProximityPingDto,
  ) {
    return this.geo.proximityPing(me.sub, dto);
  }
}
