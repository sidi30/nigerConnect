import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PollService } from './poll.service';
import {
  createPollSchema,
  listPollsSchema,
  votePollSchema,
  type CreatePollDto,
  type ListPollsDto,
  type VotePollDto,
} from './dto/poll.dto';

@Controller('polls')
export class PollController {
  constructor(private readonly polls: PollService) {}

  @Post()
  create(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createPollSchema)) dto: CreatePollDto,
  ) {
    return this.polls.create(me.sub, dto);
  }

  @Get()
  list(
    @CurrentUser() me: JwtUserPayload,
    @Query(new ZodValidationPipe(listPollsSchema)) dto: ListPollsDto,
  ) {
    return this.polls.list(dto, me.sub);
  }

  @Get(':id')
  get(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.polls.getById(id, me.sub);
  }

  @Post(':id/vote')
  vote(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(votePollSchema)) dto: VotePollDto,
  ) {
    return this.polls.vote(me.sub, id, dto);
  }

  @Delete(':id/vote')
  @HttpCode(HttpStatus.NO_CONTENT)
  async retract(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.polls.retractVote(me.sub, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.polls.remove(me.sub, id);
  }
}
