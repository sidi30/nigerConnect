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
  getTarget(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.moderation.getTarget(id);
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
