import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CommunityPricesService } from './community-prices.service';
import {
  createCommunityPriceSchema,
  listCommunityPricesSchema,
  updateCommunityPriceSchema,
  voteCommunityPriceSchema,
  type CreateCommunityPriceDto,
  type ListCommunityPricesDto,
  type UpdateCommunityPriceDto,
  type VoteCommunityPriceDto,
} from './dto/rate.dto';

@Controller('community-prices')
export class CommunityPricesController {
  constructor(private readonly prices: CommunityPricesService) {}

  // Auth-gated (aligned with marketplace /services): the submitter projection
  // must never be handed to an anonymous scraper. Second barrier: the projection
  // itself is PII-free (SUBMITTER_SELECT).
  @Get()
  list(@Query(new ZodValidationPipe(listCommunityPricesSchema)) dto: ListCommunityPricesDto) {
    return this.prices.list(dto);
  }

  @Get('mine')
  mine(@CurrentUser() me: JwtUserPayload) {
    return this.prices.mine(me.sub);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prices.getById(id);
  }

  // Per-user daily throttle lives in the service (Redis); this per-IP guard is
  // a coarse extra layer, mirroring the feed's story-create protection.
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @Post()
  create(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createCommunityPriceSchema)) dto: CreateCommunityPriceDto,
  ) {
    return this.prices.create(me.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateCommunityPriceSchema)) dto: UpdateCommunityPriceDto,
  ) {
    return this.prices.update(me.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.prices.remove(me.sub, id);
  }

  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  @Post(':id/vote')
  vote(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(voteCommunityPriceSchema)) dto: VoteCommunityPriceDto,
  ) {
    return this.prices.vote(me.sub, id, dto);
  }
}
