import { readFileSync } from 'fs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../common/config/env.validation';
import type { JwtUserPayload } from '../../common/decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    const pubPath = config.get('JWT_PUBLIC_KEY_PATH', { infer: true });
    if (!pubPath) throw new Error('JWT_PUBLIC_KEY_PATH required');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      secretOrKey: readFileSync(pubPath, 'utf8'),
    });
  }

  validate(payload: JwtUserPayload): JwtUserPayload {
    return payload;
  }
}
