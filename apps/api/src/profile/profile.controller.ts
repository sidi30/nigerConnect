import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { serializeUser } from '../auth/auth.serializer';
import { ProfileService } from './profile.service';
import {
  updateAvatarSchema,
  updateCoverSchema,
  updateProfileSchema,
  type UpdateAvatarDto,
  type UpdateCoverDto,
  type UpdateProfileDto,
} from './dto/update-profile.dto';
import {
  createPhotoSchema,
  presignUploadSchema,
  searchSchema,
  type CreatePhotoDto,
  type PresignUploadDto,
  type SearchDto,
} from './dto/photo.dto';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('me')
  async me(@CurrentUser() user: JwtUserPayload) {
    const u = await this.profile.getMe(user.sub);
    return { user: serializeUser(u) };
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ) {
    const updated = await this.profile.updateMe(user.sub, dto);
    return { user: serializeUser(updated) };
  }

  @Patch('me/avatar')
  async updateAvatar(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(updateAvatarSchema)) dto: UpdateAvatarDto,
  ) {
    const updated = await this.profile.updateAvatar(user.sub, dto.avatarUrl);
    return { user: serializeUser(updated) };
  }

  @Patch('me/cover')
  async updateCover(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(updateCoverSchema)) dto: UpdateCoverDto,
  ) {
    const updated = await this.profile.updateCover(user.sub, dto.coverUrl);
    return { user: serializeUser(updated) };
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(@CurrentUser() user: JwtUserPayload): Promise<void> {
    await this.profile.deleteAccount(user.sub);
  }

  /**
   * RGPD article 20 (right to data portability) — produces a JSON dump of
   * everything we have on the caller. Streamed as a download so the user can
   * archive it locally without going through email. Tightly throttled because
   * the dump scans several large tables.
   */
  @Get('me/export')
  @Throttle({ short: { limit: 1, ttl: 60_000 }, long: { limit: 5, ttl: 86_400_000 } })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async exportMyData(@CurrentUser() user: JwtUserPayload, @Res() res: Response): Promise<void> {
    const dump = await this.profile.exportUserData(user.sub);
    const filename = `nigerconnect-export-${user.sub}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(dump, null, 2));
  }

  @Get('search')
  async search(
    @CurrentUser() user: JwtUserPayload,
    @Query(new ZodValidationPipe(searchSchema)) dto: SearchDto,
  ) {
    return this.profile.search(user.sub, dto);
  }

  @Post('me/photos/presign')
  async presignPhoto(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(presignUploadSchema)) dto: PresignUploadDto,
  ) {
    return this.profile.presignUpload(user.sub, dto.contentType, dto.kind);
  }

  @Post('me/photos')
  async addPhoto(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(createPhotoSchema)) dto: CreatePhotoDto,
  ) {
    return this.profile.addPhoto(user.sub, dto);
  }

  @Delete('me/photos/:photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePhoto(
    @CurrentUser() user: JwtUserPayload,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ): Promise<void> {
    await this.profile.deletePhoto(user.sub, photoId);
  }

  @Get(':id')
  async getById(
    @CurrentUser() viewer: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const user = await this.profile.getById(viewer.sub, id);
    return { user: serializeUser(user) };
  }

  @Get(':id/photos')
  async getPhotos(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(50, Math.max(1, Number(limit))) : 20;
    return this.profile.getPhotos(id, cursor, lim);
  }

  @Get(':id/friends')
  async getFriends(
    @CurrentUser() viewer: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(100, Math.max(1, Number(limit))) : 30;
    return this.profile.listFriendsOf(viewer.sub, id, cursor, lim);
  }
}
