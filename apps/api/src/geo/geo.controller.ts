import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
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
  city: z.string().trim().min(1).max(100).optional(),
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
    return this.geo.getMarkers(me.sub, dto, me.role);
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
    return this.geo.getCountryMembers(me.sub, code, {
      city: dto.city,
      cursor: dto.cursor,
      limit: dto.limit,
    });
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

  // A proximity ping returns the current matches; it's an action, not a resource
  // creation — respond 200 (not the POST-default 201), matching the API contract.
  @Post('proximity/ping')
  @HttpCode(HttpStatus.OK)
  proximityPing(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(proximityPingSchema)) dto: ProximityPingDto,
  ) {
    return this.geo.proximityPing(me.sub, dto);
  }

  /** The viewer's live proximity encounters (anonymous unless someone requested them). */
  @Get('proximity/encounters')
  encounters(@CurrentUser() me: JwtUserPayload) {
    return this.geo.listEncounters(me.sub);
  }

  // Action endpoints — participant-only (404 otherwise), respond 200.
  @Post('proximity/encounters/:id/connect')
  @HttpCode(HttpStatus.OK)
  connect(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.geo.connectEncounter(me.sub, id);
  }

  @Post('proximity/encounters/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.geo.acceptEncounter(me.sub, id);
  }

  @Post('proximity/encounters/:id/decline')
  @HttpCode(HttpStatus.OK)
  decline(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.geo.declineEncounter(me.sub, id);
  }
}
