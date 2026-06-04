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
import { z } from 'zod';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ReviewService } from './review.service';
import {
  listReviewsSchema,
  reviewTargetEnum,
  upsertReviewSchema,
  type ListReviewsDto,
  type UpsertReviewDto,
} from './dto/review.dto';

const targetParamPipe = new ZodValidationPipe(reviewTargetEnum);

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Post()
  upsert(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(upsertReviewSchema)) dto: UpsertReviewDto,
  ) {
    return this.reviews.upsert(me.sub, dto);
  }

  @Get(':targetType/:targetId')
  list(
    @Param('targetType', targetParamPipe) targetType: z.infer<typeof reviewTargetEnum>,
    @Param('targetId', new ParseUUIDPipe()) targetId: string,
    @Query(new ZodValidationPipe(listReviewsSchema)) dto: ListReviewsDto,
  ) {
    return this.reviews.list(targetType, targetId, dto);
  }

  @Get(':targetType/:targetId/summary')
  summary(
    @CurrentUser() me: JwtUserPayload,
    @Param('targetType', targetParamPipe) targetType: z.infer<typeof reviewTargetEnum>,
    @Param('targetId', new ParseUUIDPipe()) targetId: string,
  ) {
    return this.reviews.summary(targetType, targetId, me.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.reviews.remove(me.sub, id);
  }
}
