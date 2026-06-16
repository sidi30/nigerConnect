import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminController } from './admin.controller';
import type { JwtUserPayload } from '../common/decorators/current-user.decorator';

/**
 * Security regression — admin AuthZ (§5.3 re-audit).
 *
 * Locks in the critical guarantee the prior pentest required once the admin
 * settings endpoint was built: PATCH /admin/settings and POST
 * /admin/invitations/root are admin-ONLY, even though the controller class is
 * annotated @Roles('admin','moderator').
 *
 * It uses the REAL Reflector against the REAL decorator metadata on the actual
 * AdminController methods, so it fails if anyone:
 *   - removes the method-level @Roles('admin') from those two handlers, or
 *   - changes RolesGuard to stop using getAllAndOverride (method-over-class).
 */

const realReflector = new Reflector();
const guard = new RolesGuard(realReflector);

const moderator: JwtUserPayload = {
  sub: 'mod-1',
  role: 'moderator',
  identityStatus: 'approved',
  jti: 'j-mod',
  iat: 0,
  exp: 0,
};

const admin: JwtUserPayload = { ...moderator, sub: 'admin-1', role: 'admin', jti: 'j-admin' };

/**
 * Build an ExecutionContext whose getHandler() / getClass() return the real
 * decorated targets, so the real Reflector reads the real @Roles metadata.
 */
function ctxFor(methodName: keyof AdminController, user?: JwtUserPayload): ExecutionContext {
  const handler = (AdminController.prototype as unknown as Record<string, unknown>)[
    methodName as string
  ];
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => AdminController,
  } as unknown as ExecutionContext;
}

describe('Admin AuthZ — admin-only writes (method @Roles overrides class)', () => {
  describe.each(['patchSettings', 'generateRootInvites'] as const)('%s (admin-only)', (method) => {
    it('rejects a moderator with 403', () => {
      expect(() => guard.canActivate(ctxFor(method, moderator))).toThrow(ForbiddenException);
    });

    it('allows an admin', () => {
      expect(guard.canActivate(ctxFor(method, admin))).toBe(true);
    });

    it('rejects an unauthenticated request', () => {
      expect(() => guard.canActivate(ctxFor(method, undefined))).toThrow(ForbiddenException);
    });
  });

  describe.each(['getSettings', 'inviteMetrics', 'metrics'] as const)('%s (admin + moderator)', (method) => {
    it('allows a moderator (class-level @Roles applies)', () => {
      expect(guard.canActivate(ctxFor(method, moderator))).toBe(true);
    });

    it('allows an admin', () => {
      expect(guard.canActivate(ctxFor(method, admin))).toBe(true);
    });
  });

  it('a regular user is denied even the read endpoints', () => {
    const user: JwtUserPayload = { ...moderator, role: 'user' };
    expect(() => guard.canActivate(ctxFor('getSettings', user))).toThrow(ForbiddenException);
  });
});
