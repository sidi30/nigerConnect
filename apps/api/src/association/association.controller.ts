import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AssociationService } from './association.service';
import {
  changeRoleSchema,
  createAssociationSchema,
  createEventSchema,
  listAssociationsSchema,
  updateAssociationSchema,
  type ChangeRoleDto,
  type CreateAssociationDto,
  type CreateEventDto,
  type ListAssociationsDto,
  type UpdateAssociationDto,
} from './dto/association.dto';

@Controller()
export class AssociationController {
  constructor(private readonly assoc: AssociationService) {}

  @Post('associations')
  create(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createAssociationSchema)) dto: CreateAssociationDto,
  ) {
    return this.assoc.create(me.sub, dto);
  }

  @Get('associations')
  list(@Query(new ZodValidationPipe(listAssociationsSchema)) dto: ListAssociationsDto) {
    return this.assoc.list(dto);
  }

  @Get('associations/mine')
  mine(@CurrentUser() me: JwtUserPayload) {
    return this.assoc.listMine(me.sub);
  }

  @Get('associations/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.assoc.getById(id);
  }

  @Patch('associations/:id')
  update(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateAssociationSchema)) dto: UpdateAssociationDto,
  ) {
    return this.assoc.update(me.sub, id, dto);
  }

  @Post('associations/:id/join')
  join(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.assoc.join(me.sub, id);
  }

  @Delete('associations/:id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.assoc.leave(me.sub, id);
  }

  @Patch('associations/:id/members/:userId/role')
  changeRole(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) dto: ChangeRoleDto,
  ) {
    return this.assoc.changeRole(me.sub, id, userId, dto);
  }

  @Get('associations/:id/members')
  members(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(100, Math.max(1, Number(limit))) : 30;
    return this.assoc.listMembers(id, cursor, lim);
  }

  @Get('associations/:id/pending')
  pendingRequests(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(100, Math.max(1, Number(limit))) : 30;
    return this.assoc.listPendingRequests(me.sub, id, cursor, lim);
  }

  @Post('associations/:id/members/:userId/approve')
  approveRequest(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.assoc.approveJoinRequest(me.sub, id, userId);
  }

  @Post('associations/:id/members/:userId/reject')
  rejectRequest(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body('reason') reason?: string,
  ) {
    return this.assoc.rejectJoinRequest(me.sub, id, userId, reason);
  }

  @Post('associations/:id/events')
  createEvent(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(createEventSchema)) dto: CreateEventDto,
  ) {
    return this.assoc.createEvent(me.sub, id, dto);
  }

  @Get('associations/:id/events')
  events(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.assoc.listEvents(id);
  }

  @Get('events/upcoming')
  upcoming(@Query('limit') limit?: string) {
    const lim = limit ? Math.min(50, Math.max(1, Number(limit))) : 20;
    return this.assoc.upcomingEvents(lim);
  }
}
