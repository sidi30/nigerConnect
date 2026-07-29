import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ModerationService } from './moderation.service';
import {
  createReportSchema,
  listReportsSchema,
  resolveReportSchema,
  type CreateReportDto,
  type ListReportsDto,
  type ResolveReportDto,
} from './dto/report.dto';

@Controller('reports')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  // Reporting is a safety valve, not a bulk action: a human flags a handful of
  // items, never dozens per minute. Combined with the per-target dedup in the
  // service, this bounds report-bombing of the moderation console.
  @Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 30, ttl: 3_600_000 } })
  @Post()
  create(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createReportSchema)) dto: CreateReportDto,
  ) {
    return this.moderation.create(me.sub, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'moderator')
  @Get()
  list(@Query(new ZodValidationPipe(listReportsSchema)) dto: ListReportsDto) {
    return this.moderation.list(dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'moderator')
  @Get(':id/target')
  getTarget(@CurrentUser() me: JwtUserPayload, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.moderation.getTarget(id, me.sub);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'moderator')
  @Patch(':id/resolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resolve(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(resolveReportSchema)) dto: ResolveReportDto,
  ): Promise<void> {
    await this.moderation.resolve(me.sub, id, dto);
  }
}
