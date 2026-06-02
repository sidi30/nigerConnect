import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EmailVerifiedGuard } from './email-verified.guard';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ALLOW_UNVERIFIED_KEY } from '../../common/decorators/allow-unverified.decorator';
import type { JwtUserPayload } from '../../common/decorators/current-user.decorator';

type Meta = { isPublic?: boolean; allowUnverified?: boolean };

function makeReflector(meta: Meta): Reflector {
  return {
    getAllAndOverride: jest.fn((key: string) =>
      key === IS_PUBLIC_KEY
        ? meta.isPublic
        : key === ALLOW_UNVERIFIED_KEY
          ? meta.allowUnverified
          : undefined,
    ),
  } as unknown as Reflector;
}

function makeContext(user?: Partial<JwtUserPayload>): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

const user: JwtUserPayload = {
  sub: 'u1',
  role: 'user',
  identityStatus: 'not_submitted',
  jti: 'j1',
  iat: 0,
  exp: 0,
};

describe('EmailVerifiedGuard', () => {
  function makePrisma(emailVerified: boolean | null) {
    return {
      user: {
        findUnique: jest.fn(async () =>
          emailVerified === null ? null : { emailVerified },
        ),
      },
    };
  }

  it('lets @Public() routes pass without touching the DB', async () => {
    const prisma = makePrisma(false);
    const guard = new EmailVerifiedGuard(makeReflector({ isPublic: true }), prisma as never);
    await expect(guard.canActivate(makeContext(user))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('lets @AllowUnverified() routes pass without touching the DB', async () => {
    const prisma = makePrisma(false);
    const guard = new EmailVerifiedGuard(makeReflector({ allowUnverified: true }), prisma as never);
    await expect(guard.canActivate(makeContext(user))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('passes when there is no authenticated user', async () => {
    const prisma = makePrisma(false);
    const guard = new EmailVerifiedGuard(makeReflector({}), prisma as never);
    await expect(guard.canActivate(makeContext(undefined))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('passes a verified user', async () => {
    const prisma = makePrisma(true);
    const guard = new EmailVerifiedGuard(makeReflector({}), prisma as never);
    await expect(guard.canActivate(makeContext(user))).resolves.toBe(true);
  });

  it('throws EMAIL_NOT_VERIFIED for an unverified user', async () => {
    const prisma = makePrisma(false);
    const guard = new EmailVerifiedGuard(makeReflector({}), prisma as never);
    await expect(guard.canActivate(makeContext(user))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(makeContext(user))).rejects.toMatchObject({
      response: { code: 'EMAIL_NOT_VERIFIED' },
    });
  });

  it('caches a positive verdict to avoid repeat DB lookups', async () => {
    const prisma = makePrisma(true);
    const guard = new EmailVerifiedGuard(makeReflector({}), prisma as never);
    await guard.canActivate(makeContext(user));
    await guard.canActivate(makeContext(user));
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('does not cache a negative verdict (re-checks DB each call)', async () => {
    const prisma = makePrisma(false);
    const guard = new EmailVerifiedGuard(makeReflector({}), prisma as never);
    await expect(guard.canActivate(makeContext(user))).rejects.toThrow();
    await expect(guard.canActivate(makeContext(user))).rejects.toThrow();
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
