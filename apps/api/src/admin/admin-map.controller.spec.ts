import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtUserPayload } from '../common/decorators/current-user.decorator';
import { AdminMapController, unlockPreciseSchema } from './admin-map.controller';

/**
 * Security regression — admin members map.
 *
 * The map plots every member (private accounts included) and is the only way to
 * the real GPS position, so it is admin-ONLY where the rest of the console also
 * admits moderators. Uses the REAL Reflector against the REAL @Roles metadata,
 * so it fails if the class annotation is ever widened.
 */
const guard = new RolesGuard(new Reflector());

const moderator: JwtUserPayload = {
  sub: 'mod-1',
  role: 'moderator',
  identityStatus: 'approved',
  jti: 'j-mod',
  iat: 0,
  exp: 0,
};
const admin: JwtUserPayload = { ...moderator, sub: 'admin-1', role: 'admin', jti: 'j-admin' };
const member: JwtUserPayload = { ...moderator, sub: 'u-1', role: 'user', jti: 'j-user' };

function ctxFor(methodName: keyof AdminMapController, user?: JwtUserPayload): ExecutionContext {
  const handler = (AdminMapController.prototype as unknown as Record<string, unknown>)[
    methodName as string
  ];
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => AdminMapController,
  } as unknown as ExecutionContext;
}

const ROUTES = [
  'listUsers',
  'getUser',
  'facets',
  'preciseLocation',
  'unlockPreciseLocation',
  'revokePreciseLocation',
] as const;

describe('AdminMapController — admin-only', () => {
  describe.each(ROUTES)('%s', (method) => {
    it('rejects a moderator with 403', () => {
      expect(() => guard.canActivate(ctxFor(method, moderator))).toThrow(ForbiddenException);
    });

    it('rejects a plain member with 403', () => {
      expect(() => guard.canActivate(ctxFor(method, member))).toThrow(ForbiddenException);
    });

    it('allows an admin', () => {
      expect(guard.canActivate(ctxFor(method, admin))).toBe(true);
    });
  });
});

describe('AdminMapController — unlock payload', () => {
  it('refuses an unlock with no written motive', () => {
    expect(unlockPreciseSchema.safeParse({ code: '123456' }).success).toBe(false);
  });

  it('refuses a token motive ("ok", "test")', () => {
    expect(unlockPreciseSchema.safeParse({ code: '123456', reason: 'ok' }).success).toBe(false);
  });

  it('refuses anything that is not a 6-digit code (recovery codes included)', () => {
    for (const code of ['12345', '1234567', 'A1B2C-D3E4F', '']) {
      expect(unlockPreciseSchema.safeParse({ code, reason: 'membre signalé en danger' }).success).toBe(
        false,
      );
    }
  });

  it('accepts a 6-digit code with a real motive', () => {
    expect(
      unlockPreciseSchema.safeParse({ code: '123456', reason: 'membre signalé en danger' }).success,
    ).toBe(true);
  });
});
