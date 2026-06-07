import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { GeoService } from './geo.service';
import {
  boundsSchema,
  citiesQuerySchema,
  nearbySchema,
  proximityPingSchema,
  type BoundsDto,
  type CitiesQueryDto,
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

  /**
   * City autocomplete for worldwide registration.
   * Public — no auth required so the endpoint is usable during sign-up before
   * the user has a JWT.
   *
   * GET /geo/cities?q=par&country=FR&limit=10
   * Returns [{ name, countryCode, lat, lng, population }] sorted by population.
   */
  @Public()
  @Get('cities')
  cities(@Query(new ZodValidationPipe(citiesQuerySchema)) dto: CitiesQueryDto) {
    return this.geo.searchCities(dto);
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
