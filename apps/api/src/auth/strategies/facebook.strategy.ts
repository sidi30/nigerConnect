import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-facebook';
import type { Env } from '../../common/config/env.validation';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(config: ConfigService<Env, true>) {
    const clientID = config.get('FACEBOOK_CLIENT_ID', { infer: true }) ?? '';
    const clientSecret = config.get('FACEBOOK_CLIENT_SECRET', { infer: true }) ?? '';
    const apiUrl = config.get('API_URL', { infer: true });
    super({
      clientID,
      clientSecret,
      callbackURL: `${apiUrl}/api/auth/facebook/callback`,
      profileFields: ['id', 'emails', 'name', 'picture.type(large)'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (err: unknown, profile: unknown) => void,
  ) {
    done(null, {
      provider: 'facebook',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
      avatarUrl: (profile.photos?.[0] as { value?: string } | undefined)?.value,
    });
  }
}
