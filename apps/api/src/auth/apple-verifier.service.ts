import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JWTPayload } from 'jose';
import type { Env } from '../common/config/env.validation';

const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
const APPLE_ISSUER = 'https://appleid.apple.com';

/** Constant-time string comparison (lengths may differ). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** SHA-256 hex digest — used to hash a raw nonce for the Apple `nonce` claim. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface AppleIdentity {
  /** Stable user identifier, unique across Apple's ecosystem. */
  sub: string;
  /** Email (may be a relay address like `xyz@privaterelay.appleid.com`). */
  email: string | null;
  /** `true` only if Apple sent an explicit truthy `email_verified` claim. */
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

  /**
   * @param expectedNonce Already-hashed nonce (`sha256(rawNonce)`) to match the
   *   token's `nonce` claim. When provided, a mismatch (or missing claim) is
   *   rejected — anti-replay. Omitted by older clients → no nonce check.
   */
  async verify(identityToken: string, expectedNonce?: string): Promise<AppleIdentity> {
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

    if (expectedNonce !== undefined) {
      const tokenNonce = typeof payload.nonce === 'string' ? payload.nonce : '';
      if (!tokenNonce || !timingSafeEqualStr(tokenNonce, expectedNonce)) {
        this.logger.warn('Apple token nonce mismatch — possible replay');
        throw new UnauthorizedException('Apple identity token nonce mismatch');
      }
    }

    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (!sub) throw new UnauthorizedException('Apple token missing sub');

    const email = typeof payload.email === 'string' ? payload.email : null;
    const rawVerified = (payload as { email_verified?: boolean | string }).email_verified;
    // Require an explicit truthy claim. A MISSING `email_verified` is NOT trusted
    // as verified — this verdict feeds the OAuth auto-link security decision, and
    // optimistically trusting an absent claim would weaken the account-takeover
    // guard. Apple normally sends `email_verified` (as a bool or the string
    // "true") whenever an email claim is present.
    const emailVerified = email !== null && (rawVerified === true || rawVerified === 'true');
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
