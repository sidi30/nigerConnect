import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AdminService } from './admin.service';

const listIdentitySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
type ListIdentityDto = z.infer<typeof listIdentitySchema>;

/**
 * Internal admin/moderator console API. Every route is role-gated by RolesGuard;
 * the global JWT + email-verified guards already apply. Identity-document view
 * URLs are short-lived presigned GETs (see AdminService) — the private bucket
 * is never exposed.
 */
@UseGuards(RolesGuard)
@Roles('admin', 'moderator')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  @Get('identity')
  identity(@Query(new ZodValidationPipe(listIdentitySchema)) dto: ListIdentityDto) {
    return this.admin.listIdentityDocuments(dto.status, dto.limit, dto.cursor);
  }
}
