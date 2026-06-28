import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
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

const countryMembersSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
type CountryMembersDto = z.infer<typeof countryMembersSchema>;

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

  /**
   * Paginated list of the VISIBLE members (showOnMap, non-private, unblocked) in
   * a country — backs the "see the list of Nigeriens in country X" sheet when
   * the map is zoomed out. Privacy-preserving: only opted-in members are listed
   * (so this can be fewer than the anonymous cluster count, which includes hidden
   * users by design).
   */
  @Get('country/:code')
  countryMembers(
    @CurrentUser() me: JwtUserPayload,
    @Param('code') code: string,
    @Query(new ZodValidationPipe(countryMembersSchema)) dto: CountryMembersDto,
  ) {
    return this.geo.getCountryMembers(me.sub, code, dto.cursor, dto.limit);
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
