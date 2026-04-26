import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import type { Env } from '../common/config/env.validation';

export interface GoogleProfile {
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

/**
 * Verifies a Google ID token and extracts the user profile.
 *
 * ID tokens are issued by Google after a successful OAuth flow on the client
 * (expo-auth-session on mobile, Google Sign-In SDK on web). We verify the
 * signature against Google's public keys and ensure the `aud` claim matches
 * one of our configured client IDs.
 *
 * The list of accepted audiences covers every platform we ship:
 *   - GOOGLE_CLIENT_ID          → web / legacy
 *   - GOOGLE_CLIENT_ID_WEB      → Expo web build
 *   - GOOGLE_CLIENT_ID_ANDROID  → Android native
 *   - GOOGLE_CLIENT_ID_IOS      → iOS native
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly client = new OAuth2Client();
  private readonly audiences: string[];

  constructor(config: ConfigService<Env, true>) {
    this.audiences = [
      config.get('GOOGLE_CLIENT_ID', { infer: true }),
      config.get('GOOGLE_CLIENT_ID_WEB', { infer: true }),
      config.get('GOOGLE_CLIENT_ID_ANDROID', { infer: true }),
      config.get('GOOGLE_CLIENT_ID_IOS', { infer: true }),
    ].filter((v): v is string => !!v);

    if (this.audiences.length === 0) {
      this.logger.warn(
        'Google sign-in disabled — set at least one of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_ID_{WEB,ANDROID,IOS}',
      );
    } else {
      this.logger.log(`Google sign-in ready (${this.audiences.length} client IDs trusted)`);
    }
  }

  isConfigured(): boolean {
    return this.audiences.length > 0;
  }

  async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    if (!this.isConfigured()) {
      throw new UnauthorizedException('Google sign-in is not configured on this server');
    }
    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.audiences,
      });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(`Google ID token verification failed: ${String(error)}`);
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    return {
      providerId: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified === true,
      firstName: payload.given_name ?? null,
      lastName: payload.family_name ?? null,
      avatarUrl: payload.picture ?? null,
    };
  }
}
