import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ServicesService } from './services.service';
import {
  createServiceSchema,
  listServicesSchema,
  rateSchema,
  respondSchema,
  type CreateServiceDto,
  type ListServicesDto,
  type RateDto,
  type RespondDto,
} from './dto/service.dto';

@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Post()
  create(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createServiceSchema)) dto: CreateServiceDto,
  ) {
    return this.services.create(me.sub, dto);
  }

  @Get()
  list(@Query(new ZodValidationPipe(listServicesSchema)) dto: ListServicesDto) {
    return this.services.list(dto);
  }

  @Get('mine')
  mine(@CurrentUser() me: JwtUserPayload) {
    return this.services.mine(me.sub);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.services.getById(id);
  }

  @Post(':id/respond')
  respond(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(respondSchema)) dto: RespondDto,
  ) {
    return this.services.respond(me.sub, id, dto);
  }

  @Get(':id/responses')
  responses(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.services.listResponses(me.sub, id);
  }

  @Patch(':id/resolve')
  resolve(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.services.resolve(me.sub, id);
  }

  @Post(':id/rate')
  rate(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(rateSchema)) dto: RateDto,
  ) {
    return this.services.rate(me.sub, id, dto);
  }
}
