import { Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EmailTokenService } from './email-token.service';
import { GoogleOAuthService } from './google-oauth.service';
import { AppleVerifierService } from './apple-verifier.service';
import { MfaSecretService } from './mfa-secret.service';
import { MfaService } from './mfa.service';
import { IdentityCleanupCron } from './identity-cleanup.cron';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EmailVerifiedGuard } from './guards/email-verified.guard';
import { InvitationsModule } from '../invitations/invitations.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), forwardRef(() => InvitationsModule)],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    EmailTokenService,
    GoogleOAuthService,
    AppleVerifierService,
    MfaSecretService,
    MfaService,
    IdentityCleanupCron,
    JwtStrategy,
    // Order matters: APP_GUARD providers run in declaration order. JwtAuthGuard
    // authenticates and populates req.user first; EmailVerifiedGuard then runs
    // and blocks authenticated-but-unverified users.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: EmailVerifiedGuard },
  ],
  exports: [AuthService, TokenService, PasswordService, MfaSecretService, MfaService],
})
export class AuthModule {}
