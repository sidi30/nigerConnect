import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JWTPayload } from 'jose';
import type { Env } from '../common/config/env.validation';

const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
const APPLE_ISSUER = 'https://appleid.apple.com';

export interface AppleIdentity {
  /** Stable user identifier, unique across Apple's ecosystem. */
  sub: string;
  /** Email (may be a relay address like `xyz@privaterelay.appleid.com`). */
  email: string | null;
  /** `true` if Apple has verified the email (always `true` when present). */
  emailVerified: boolean;
  /** `true` if the email is a private relay address — informational. */
  isPrivateEmail: boolean;
}

type RemoteJwks = Awaited<ReturnType<typeof import('jose').createRemoteJWKSet>>;

/**
 * Verifies "Sign in with Apple" identity tokens using Apple's JWKS.
 *
 * Implementation note :
 *   `jose` ships as pure ESM; importing it at module top-level breaks Jest's
 *   CommonJS default. We defer the import to first use via `loadJose()` —
 *   this keeps unit tests that stub out the service (see auth.service.spec.ts)
 *   from needing the ESM transformer pipeline.
 *
 * Security notes :
 *   - We require `iss === https://appleid.apple.com`, signature valid, and the
 *     audience to match one of our configured Apple client IDs (the iOS bundle
 *     ID for native sign-in, or a web Services ID for the web flow).
 *   - `createRemoteJWKSet` caches keys in-process with a TTL, so we don't
 *     hammer Apple on every login.
 */
@Injectable()
export class AppleVerifierService {
  private readonly logger = new Logger(AppleVerifierService.name);
  private readonly audiences: string[];
  private jwksPromise: Promise<RemoteJwks> | null = null;

  constructor(config: ConfigService<Env, true>) {
    const audiences = [
      config.get('APPLE_CLIENT_ID', { infer: true }),
      (config as unknown as ConfigService).get<string>('APPLE_CLIENT_ID_WEB'),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    this.audiences = audiences;
    if (audiences.length === 0) {
      this.logger.warn(
        'APPLE_CLIENT_ID is empty — Sign in with Apple will reject every token. Set it to your app bundle id (e.g. com.nigerconnect.app).',
      );
    }
  }

  get isConfigured(): boolean {
    return this.audiences.length > 0;
  }

  async verify(identityToken: string): Promise<AppleIdentity> {
    if (this.audiences.length === 0) {
      throw new UnauthorizedException('Apple sign-in is not configured on this server.');
    }
    const { jwtVerify } = await import('jose');
    const jwks = await this.getJwks();
    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(identityToken, jwks, {
        issuer: APPLE_ISSUER,
        audience: this.audiences,
        algorithms: ['RS256'],
      });
      payload = verified.payload;
    } catch (error) {
      this.logger.warn(`Apple token verification failed: ${String(error)}`);
      throw new UnauthorizedException('Invalid Apple identity token');
    }

    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (!sub) throw new UnauthorizedException('Apple token missing sub');

    const email = typeof payload.email === 'string' ? payload.email : null;
    const rawVerified = (payload as { email_verified?: boolean | string }).email_verified;
    const emailVerified =
      email !== null && (rawVerified === true || rawVerified === 'true' || rawVerified === undefined);
    const rawPrivate = (payload as { is_private_email?: boolean | string }).is_private_email;
    const isPrivateEmail = rawPrivate === true || rawPrivate === 'true';

    return { sub, email, emailVerified, isPrivateEmail };
  }

  private async getJwks(): Promise<RemoteJwks> {
    if (!this.jwksPromise) {
      this.jwksPromise = import('jose').then((jose) => jose.createRemoteJWKSet(APPLE_JWKS_URL));
    }
    return this.jwksPromise;
  }
}
