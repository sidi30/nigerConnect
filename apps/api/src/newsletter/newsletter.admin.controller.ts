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
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  createCampaignSchema,
  listSubscribersSchema,
  previewRecipientsSchema,
  testCampaignSchema,
  updateCampaignSchema,
  uploadNewsletterMediaSchema,
  type CreateCampaignDto,
  type ListSubscribersDto,
  type PreviewRecipientsDto,
  type TestCampaignDto,
  type UpdateCampaignDto,
  type UploadNewsletterMediaDto,
} from './dto/newsletter.dto';
import { NewsletterService } from './newsletter.service';

/**
 * Admin-only newsletter console (subscribers + campaigns). Role-gated to
 * 'admin' — newsletter/marketing is an admin concern, not moderation. The
 * global JWT + email-verified guards already apply on top.
 */
@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin/newsletter')
export class NewsletterAdminController {
  constructor(private readonly newsletter: NewsletterService) {}

  // ── Subscribers ──────────────────────────────────────────────
  @Get('subscribers')
  listSubscribers(
    @Query(new ZodValidationPipe(listSubscribersSchema)) dto: ListSubscribersDto,
  ) {
    return this.newsletter.listSubscribers(dto.status, dto.limit, dto.cursor);
  }

  @Get('subscribers/stats')
  subscriberStats() {
    return this.newsletter.subscriberStats();
  }

  // ── Campaigns ────────────────────────────────────────────────
  @Get('campaigns')
  listCampaigns() {
    return this.newsletter.listCampaigns();
  }

  @Get('campaigns/:id')
  getCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.newsletter.getCampaign(id);
  }

  // Presign an image upload (body image or attachment). Same throttle profile as
  // the test send so a compromised admin session can't spam presigns; the service
  // restricts the content-type to images and bounds the object size.
  @Throttle({ short: { limit: 20, ttl: 60_000 }, long: { limit: 200, ttl: 3_600_000 } })
  @Post('upload')
  @HttpCode(200)
  uploadMedia(
    @Body(new ZodValidationPipe(uploadNewsletterMediaSchema)) dto: UploadNewsletterMediaDto,
  ) {
    return this.newsletter.uploadMedia(dto);
  }

  // Estimate a recipient count for an UNSAVED targeting draft (compose screen).
  @Post('recipients/preview')
  @HttpCode(200)
  async previewRecipients(
    @Body(new ZodValidationPipe(previewRecipientsSchema)) dto: PreviewRecipientsDto,
  ): Promise<{ totalRecipients: number }> {
    return { totalRecipients: await this.newsletter.previewRecipients(dto) };
  }

  @Post('campaigns')
  createCampaign(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createCampaignSchema)) dto: CreateCampaignDto,
  ) {
    return this.newsletter.createCampaign(dto, me.sub);
  }

  @Patch('campaigns/:id')
  updateCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema)) dto: UpdateCampaignDto,
  ) {
    return this.newsletter.updateCampaign(id, dto);
  }

  @Delete('campaigns/:id')
  @HttpCode(204)
  deleteCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.newsletter.deleteCampaign(id);
  }

  // Defence-in-depth: cap test sends so a compromised admin session can't use
  // this as an open mail relay to arbitrary addresses.
  @Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 30, ttl: 3_600_000 } })
  @Post('campaigns/:id/test')
  @HttpCode(200)
  async testCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(testCampaignSchema)) dto: TestCampaignDto,
  ): Promise<{ ok: true }> {
    await this.newsletter.testCampaign(id, dto.email);
    return { ok: true };
  }

  @Post('campaigns/:id/send')
  @HttpCode(202)
  sendCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.newsletter.sendCampaign(id);
  }
}
