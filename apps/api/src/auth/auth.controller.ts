import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SettingsService } from '../common/settings/settings.service';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../common/config/env.validation';
import { Public } from '../common/decorators/public.decorator';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { CurrentUser, JwtUserPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import { RolesGuard } from './guards/roles.guard';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { appleSchema, loginSchema, oauthSchema, refreshSchema } from './dto/login.dto';
import type { AppleDto, LoginDto, OAuthDto, RefreshDto } from './dto/login.dto';

// ── MFA (TOTP) DTOs ──────────────────────────────────────────────────────────
const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(20) }).strict();
type MfaCodeDto = z.infer<typeof mfaCodeSchema>;
const mfaVerifySchema = z
  .object({
    mfaToken: z.string().min(10),
    code: z.string().trim().min(6).max(20),
    deviceName: z.string().max(100).optional(),
  })
  .strict();
type MfaVerifyDto = z.infer<typeof mfaVerifySchema>;
import { registerSchema } from './dto/register.dto';
import type { RegisterDto } from './dto/register.dto';
import { reviewIdentitySchema, submitIdentitySchema } from './dto/verify-identity.dto';
import type { ReviewIdentityDto, SubmitIdentityDto } from './dto/verify-identity.dto';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailCodeSchema,
  type ForgotPasswordDto,
  type ResetPasswordDto,
  type VerifyEmailCodeDto,
} from './dto/password.dto';
import { serializeUser } from './auth.serializer';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly settingsService: SettingsService,
    private readonly mfa: MfaService,
  ) {}

  @Public()
  @Throttle({ short: { limit: 3, ttl: 60_000 }, long: { limit: 5, ttl: 3_600_000 } })
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
  @Throttle({ short: { limit: 5, ttl: 60_000 }, medium: { limit: 20, ttl: 900_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: Request,
  ) {
    const ip = this.getIp(req);
    const result = await this.auth.login(dto, ip);
    // MFA-enabled accounts get a challenge instead of tokens — the client then
    // calls POST /auth/mfa/verify with a TOTP/recovery code.
    if ('mfaRequired' in result) {
      return { mfaRequired: true, mfaToken: result.mfaToken };
    }
    return {
      user: serializeUser(result.user),
      tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken },
    };
  }

  /**
   * Second step of an MFA login: exchange the challenge token + a TOTP or
   * recovery code for real tokens. Public + throttled (it's pre-auth).
   */
  @Public()
  @Throttle({ short: { limit: 8, ttl: 60_000 }, medium: { limit: 30, ttl: 900_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('mfa/verify')
  async mfaVerify(@Body(new ZodValidationPipe(mfaVerifySchema)) dto: MfaVerifyDto, @Req() req: Request) {
    const result = await this.auth.verifyMfaLogin(dto, this.getIp(req));
    return {
      user: serializeUser(result.user),
      tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken },
    };
  }

  // ── MFA enrollment / management (authenticated) ─────────────────────────────

  /** Start TOTP enrollment — returns the secret + otpauth URL (render as QR). */
  @Post('mfa/enroll')
  @HttpCode(HttpStatus.OK)
  mfaEnroll(@CurrentUser() me: JwtUserPayload) {
    return this.mfa.beginEnrollment(me.sub);
  }

  /** Confirm enrollment with a live code → enables MFA, returns recovery codes once. */
  @Post('mfa/confirm')
  @HttpCode(HttpStatus.OK)
  mfaConfirm(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(mfaCodeSchema)) dto: MfaCodeDto,
  ) {
    return this.mfa.confirmEnrollment(me.sub, dto.code);
  }

  /** Disable MFA — requires a valid TOTP or recovery code. */
  @Post('mfa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async mfaDisable(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(mfaCodeSchema)) dto: MfaCodeDto,
  ): Promise<void> {
    await this.mfa.disable(me.sub, dto.code);
  }

  /** Whether the current user has MFA enabled. */
  @Get('mfa/status')
  mfaStatus(@CurrentUser() me: JwtUserPayload) {
    return this.mfa.status(me.sub);
  }

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60_000 }, long: { limit: 60, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('google')
  async google(@Body(new ZodValidationPipe(oauthSchema)) dto: OAuthDto) {
    const result = await this.auth.signInWithGoogle(dto.idToken, dto.deviceName, dto.nonce, dto.inviteCode);
    return {
      user: serializeUser(result.user),
      tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken },
    };
  }

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60_000 }, long: { limit: 60, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('apple')
  async apple(@Body(new ZodValidationPipe(appleSchema)) dto: AppleDto) {
    const result = await this.auth.signInWithApple({
      identityToken: dto.identityToken,
      fullName: dto.fullName,
      email: dto.email,
      rawNonce: dto.rawNonce,
      deviceName: dto.deviceName,
      inviteCode: dto.inviteCode,
    });
    return {
      user: serializeUser(result.user),
      tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken },
    };
  }

  /**
   * GET /auth/registration-mode
   * Public endpoint — client reads this to decide which UI to show.
   * Light throttle (global default is sufficient, but we add a medium cap).
   */
  @Public()
  @Throttle({ short: { limit: 10, ttl: 1_000 }, medium: { limit: 200, ttl: 60_000 } })
  @Get('registration-mode')
  async registrationMode(): Promise<{ mode: 'open' | 'invite_only' | 'closed' }> {
    const mode = await this.settingsService.getRegistrationMode();
    return { mode };
  }

  @Public()
  // Dedicated throttle tighter than the global one. A legitimate client will
  // refresh at most once per access-token TTL (15 min). Brute-forcing the
  // refresh token (even though it's hashed in DB) is pointless under these
  // limits. `skipSuccessfulRequests` means a healthy app is never throttled.
  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    medium: { limit: 30, ttl: 900_000 },
  })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    const result = await this.auth.refresh(dto.refreshToken);
    return {
      user: serializeUser(result.user),
      tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken },
    };
  }

  @AllowUnverified()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto,
  ): Promise<void> {
    await this.auth.logout(dto.refreshToken, user.jti, user.exp);
  }

  @AllowUnverified()
  @Get('me')
  async me(@CurrentUser() user: JwtUserPayload) {
    const full = await this.auth.me(user.sub);
    return { user: serializeUser(full) };
  }

  // ── Password reset ────────────────────────────────────────

  @Public()
  @Throttle({ short: { limit: 3, ttl: 60_000 }, long: { limit: 10, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('forgot-password')
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto,
  ): Promise<void> {
    // Never leak whether the email exists — always 204
    await this.auth.forgotPassword(dto.email);
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('reset-password')
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
  ): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  // ── Email verification ────────────────────────────────────

  @AllowUnverified()
  @Throttle({ short: { limit: 3, ttl: 60_000 }, long: { limit: 10, ttl: 3_600_000 } })
  @Post('verify-email/send')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendVerification(@CurrentUser() user: JwtUserPayload): Promise<void> {
    await this.auth.sendVerificationEmail(user.sub);
  }

  /**
   * Verify the 6-digit code typed into the app. Authenticated + @AllowUnverified
   * so a freshly-registered (unverified) user can reach it. Throttled hard —
   * the code is low-entropy and the service also caps wrong guesses per token.
   */
  @AllowUnverified()
  @Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 20, ttl: 3_600_000 } })
  @Post('verify-email/code')
  @HttpCode(HttpStatus.OK)
  async verifyEmailCode(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(verifyEmailCodeSchema)) dto: VerifyEmailCodeDto,
  ): Promise<{ ok: true }> {
    return this.auth.verifyEmailCode(user.sub, dto.code);
  }

  /**
   * Verify-email endpoint accessed via the token link sent by email.
   *
   * Two callers:
   *   1. The web app (`/verify-email` page) does an `Accept: application/json`
   *      fetch and renders the result itself.
   *   2. A user clicks the API URL directly (e.g. legacy email sent before the
   *      mailer was switched to point at the web). For that case we redirect
   *      to the web page so they don't see raw JSON.
   */
  @Public()
  @Get('verify-email')
  async verifyEmail(
    @Query('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = token ? await this.auth.verifyEmail(token) : { ok: false };
    const wantsJson = (req.headers.accept ?? '').includes('application/json');
    if (wantsJson) {
      return result.ok
        ? { ok: true, message: 'Email vérifié ✓' }
        : { ok: false, message: token ? 'Lien invalide ou expiré.' : 'Token manquant' };
    }
    const webBase =
      this.config.get('APP_WEB_URL', { infer: true }) ?? this.config.get('API_URL', { infer: true });
    const target = `${webBase}/verify-email${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    res.redirect(302, target);
    return null;
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
    // req.ip is the trust-proxy-resolved client IP (Express applies the
    // TRUST_PROXY_HOPS setting to X-Forwarded-For and returns the right hop).
    // The previous leftmost-XFF parse was client-spoofable. TRUST_PROXY_HOPS must
    // equal the real hop count in prod (Cloudflare→Traefik→api = 2) via env.
    return req.ip;
  }
}
