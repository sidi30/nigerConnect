import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, JwtUserPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RolesGuard } from './guards/roles.guard';
import { AuthService } from './auth.service';
import { loginSchema, refreshSchema } from './dto/login.dto';
import type { LoginDto, RefreshDto } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';
import type { RegisterDto } from './dto/register.dto';
import { reviewIdentitySchema, submitIdentitySchema } from './dto/verify-identity.dto';
import type { ReviewIdentityDto, SubmitIdentityDto } from './dto/verify-identity.dto';
import { serializeUser } from './auth.serializer';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Req() req: Request,
  ) {
    const ip = this.getIp(req);
    const result = await this.auth.register(dto, ip);
    return {
      user: serializeUser(result.user),
      tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken },
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: Request,
  ) {
    const ip = this.getIp(req);
    const result = await this.auth.login(dto, ip);
    return {
      user: serializeUser(result.user),
      tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken },
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    const result = await this.auth.refresh(dto.refreshToken);
    return {
      user: serializeUser(result.user),
      tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken },
    };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto,
  ): Promise<void> {
    await this.auth.logout(dto.refreshToken, user.jti, user.exp);
  }

  @Get('me')
  async me(@CurrentUser() user: JwtUserPayload) {
    const full = await this.auth.me(user.sub);
    return { user: serializeUser(full) };
  }

  @Post('identity/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  async submitIdentity(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(submitIdentitySchema)) dto: SubmitIdentityDto,
  ) {
    await this.auth.submitIdentity(user.sub, dto.documentType, dto.fileUrl);
    return { status: 'pending' };
  }

  @Get('identity/status')
  async identityStatus(@CurrentUser() user: JwtUserPayload) {
    return this.auth.getIdentityStatus(user.sub);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'moderator')
  @Patch('identity/review')
  async reviewIdentity(
    @CurrentUser() reviewer: JwtUserPayload,
    @Body(new ZodValidationPipe(reviewIdentitySchema)) dto: ReviewIdentityDto,
  ) {
    await this.auth.reviewIdentity(reviewer.sub, dto.userId, dto.decision, dto.reason);
    return { status: dto.decision };
  }

  private getIp(req: Request): string | undefined {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string') return fwd.split(',')[0]?.trim();
    return req.socket?.remoteAddress ?? undefined;
  }
}
