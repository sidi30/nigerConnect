import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export interface JwtUserPayload {
  sub: string;
  role: 'user' | 'moderator' | 'admin';
  identityStatus: 'not_submitted' | 'pending' | 'approved' | 'rejected';
  jti: string;
  iat: number;
  exp: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUserPayload => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: JwtUserPayload }>();
    if (!request.user) throw new Error('CurrentUser used on an unprotected route');
    return request.user;
  },
);
