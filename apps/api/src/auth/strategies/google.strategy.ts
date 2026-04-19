import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { Env } from '../../common/config/env.validation';

export interface OAuthProfile {
  provider: 'google';
  providerId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    const clientID = config.get('GOOGLE_CLIENT_ID', { infer: true }) ?? '';
    const clientSecret = config.get('GOOGLE_CLIENT_SECRET', { infer: true }) ?? '';
    const apiUrl = config.get('API_URL', { infer: true });
    super({
      clientID,
      clientSecret,
      callbackURL: `${apiUrl}/api/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) {
    const payload: OAuthProfile = {
      provider: 'google',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
      avatarUrl: profile.photos?.[0]?.value,
    };
    done(null, payload);
  }
}
