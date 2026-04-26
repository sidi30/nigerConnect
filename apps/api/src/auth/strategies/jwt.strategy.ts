import { readFileSync } from 'fs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../common/config/env.validation';
import type { JwtUserPayload } from '../../common/decorators/current-user.decorator';
import { deriveKid } from '../token.service';

/**
 * JWT strategy — validates:
 *   - signature (RS256) against one of the configured public keys, dispatched by `kid`,
 *   - expiration (`exp`),
 *   - issuer and audience.
 *
 * Rotation model:
 *   - The currently-signing key is configured via JWT_PUBLIC_KEY_PATH.
 *   - During a rotation, set JWT_PREVIOUS_PUBLIC_KEY_PATH to the OLD key PEM; tokens
 *     signed with it continue to verify until they expire naturally (at most the
 *     access-token TTL, i.e. 15 min by default).
 *   - Once JWT_ACCESS_EXPIRES has elapsed, remove JWT_PREVIOUS_PUBLIC_KEY_PATH.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private static readonly logger = new Logger('JwtStrategy');

  constructor(config: ConfigService<Env, true>) {
    const pubPath = config.get('JWT_PUBLIC_KEY_PATH', { infer: true });
    if (!pubPath) throw new Error('JWT_PUBLIC_KEY_PATH required');

    const currentKey = readFileSync(pubPath, 'utf8');
    const keysByKid = new Map<string, string>();
    keysByKid.set(deriveKid(currentKey), currentKey);

    const prevPath = config.get('JWT_PREVIOUS_PUBLIC_KEY_PATH', { infer: true });
    if (prevPath) {
      const prevKey = readFileSync(prevPath, 'utf8');
      const prevKid = deriveKid(prevKey);
      keysByKid.set(prevKid, prevKey);
      JwtStrategy.logger.log(`JWT accepting previous key during rotation (kid=${prevKid})`);
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      issuer: config.get('JWT_ISSUER', { infer: true }),
      audience: config.get('JWT_AUDIENCE', { infer: true }),
      // Dispatch by kid so rotation works without a redeploy.
      // Falls back to the current key if no kid is present (old tokens issued
      // before this change — they'll still verify if signed by the current key).
      secretOrKeyProvider: (
        _req: unknown,
        rawJwt: string,
        done: (err: Error | null, key?: string) => void,
      ) => {
        try {
          const [headerB64] = rawJwt.split('.');
          const headerJson = Buffer.from(headerB64 ?? '', 'base64url').toString('utf8');
          const header = JSON.parse(headerJson) as { kid?: string };
          const key = header.kid ? keysByKid.get(header.kid) : currentKey;
          if (!key) {
            return done(new Error(`Unknown JWT kid: ${header.kid ?? '<none>'}`));
          }
          done(null, key);
        } catch (error) {
          done(error as Error);
        }
      },
    });
  }

  validate(payload: JwtUserPayload): JwtUserPayload {
    return payload;
  }
}
