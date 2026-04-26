import { ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

describe('AuthService', () => {
  const password = new PasswordService();

  function makePrisma(overrides: Record<string, unknown> = {}) {
    return {
      user: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
          id: 'u1',
          email: args.data.email,
          passwordHash: args.data.passwordHash ?? null,
          role: 'user',
          identityStatus: 'not_submitted',
          status: 'active',
          failedLoginCount: 0,
          lockedUntil: null,
          ...args.data,
        })),
        update: jest.fn(async () => ({})),
      },
      identityDocument: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      ...overrides,
    };
  }

  function makeTokens() {
    return {
      issueTokens: jest.fn(async () => ({
        accessToken: 'access.jwt.token',
        refreshToken: 'refresh.raw.token',
        accessExpiresIn: 900,
        refreshExpiresAt: new Date(),
      })),
      rotateRefreshToken: jest.fn(),
      revokeRefreshToken: jest.fn(),
      revokeAllUserTokens: jest.fn(),
    };
  }

  function makeRedis() {
    return {
      incrementCounter: jest.fn(async () => 1),
      blacklistJwt: jest.fn(),
      isJwtBlacklisted: jest.fn(async () => false),
    };
  }

  it('registers a new user', async () => {
    const prisma = makePrisma();
    const tokens = makeTokens();
    const redis = makeRedis();
    const svc = new AuthService(
      prisma as never,
      password,
      tokens as never,
      redis as never,
      { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn() } as never,
      { create: jest.fn(), consume: jest.fn() } as never, { verifyIdToken: jest.fn() } as never, { verify: jest.fn(), isConfigured: false } as never
    );

    const result = await svc.register(
      {
        email: 'a@b.com',
        password: 'Str0ng!Password',
        firstName: 'Al',
        lastName: 'Ou',
      },
      '1.2.3.4',
    );
    expect(result.accessToken).toBe('access.jwt.token');
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it('throws ConflictException if email exists', async () => {
    const prisma = makePrisma({
      user: {
        findFirst: jest.fn(async () => ({ id: 'exists' })),
        create: jest.fn(),
      },
    });
    const svc = new AuthService(prisma as never, password, makeTokens() as never, makeRedis() as never, { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn() } as never, { create: jest.fn(), consume: jest.fn() } as never, { verifyIdToken: jest.fn() } as never, { verify: jest.fn(), isConfigured: false } as never);
    await expect(
      svc.register(
        { email: 'a@b.com', password: 'Str0ng!Password', firstName: 'A', lastName: 'O' },
        '1.2.3.4',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs in with correct credentials', async () => {
    const hash = await password.hash('Str0ng!Password');
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1',
          email: 'a@b.com',
          passwordHash: hash,
          role: 'user',
          identityStatus: 'approved',
          status: 'active',
          failedLoginCount: 0,
          lockedUntil: null,
        })),
        update: jest.fn(async () => ({})),
      },
    });
    const svc = new AuthService(prisma as never, password, makeTokens() as never, makeRedis() as never, { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn() } as never, { create: jest.fn(), consume: jest.fn() } as never, { verifyIdToken: jest.fn() } as never, { verify: jest.fn(), isConfigured: false } as never);
    const result = await svc.login({ email: 'a@b.com', password: 'Str0ng!Password' });
    expect(result.accessToken).toBeDefined();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
      }),
    );
  });

  it('rejects wrong password and increments failedLoginCount', async () => {
    const hash = await password.hash('Str0ng!Password');
    const update = jest.fn(async () => ({}));
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1',
          email: 'a@b.com',
          passwordHash: hash,
          role: 'user',
          identityStatus: 'not_submitted',
          status: 'active',
          failedLoginCount: 0,
          lockedUntil: null,
        })),
        update,
      },
    });
    const svc = new AuthService(prisma as never, password, makeTokens() as never, makeRedis() as never, { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn() } as never, { create: jest.fn(), consume: jest.fn() } as never, { verifyIdToken: jest.fn() } as never, { verify: jest.fn(), isConfigured: false } as never);
    await expect(svc.login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginCount: 1 }),
      }),
    );
  });

  it('locks account after MAX_FAILED_LOGINS failed attempts', async () => {
    const hash = await password.hash('Str0ng!Password');
    const update = jest.fn(async () => ({}));
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1',
          email: 'a@b.com',
          passwordHash: hash,
          role: 'user',
          identityStatus: 'not_submitted',
          status: 'active',
          failedLoginCount: 4,
          lockedUntil: null,
        })),
        update,
      },
    });
    const svc = new AuthService(prisma as never, password, makeTokens() as never, makeRedis() as never, { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn() } as never, { create: jest.fn(), consume: jest.fn() } as never, { verifyIdToken: jest.fn() } as never, { verify: jest.fn(), isConfigured: false } as never);
    await expect(svc.login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const firstCall = update.mock.calls[0] as unknown as [{ data: { lockedUntil: Date | null } }];
    expect(firstCall).toBeDefined();
    expect(firstCall[0].data.lockedUntil).toBeInstanceOf(Date);
  });

  it('rejects login if account is locked', async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1',
          passwordHash: 'x',
          role: 'user',
          identityStatus: 'not_submitted',
          status: 'active',
          failedLoginCount: 5,
          lockedUntil: new Date(Date.now() + 60_000),
        })),
      },
    });
    const svc = new AuthService(prisma as never, password, makeTokens() as never, makeRedis() as never, { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn() } as never, { create: jest.fn(), consume: jest.fn() } as never, { verifyIdToken: jest.fn() } as never, { verify: jest.fn(), isConfigured: false } as never);
    await expect(svc.login({ email: 'a@b.com', password: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects banned users', async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1',
          passwordHash: 'x',
          role: 'user',
          identityStatus: 'not_submitted',
          status: 'banned',
          failedLoginCount: 0,
          lockedUntil: null,
        })),
      },
    });
    const svc = new AuthService(prisma as never, password, makeTokens() as never, makeRedis() as never, { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn() } as never, { create: jest.fn(), consume: jest.fn() } as never, { verifyIdToken: jest.fn() } as never, { verify: jest.fn(), isConfigured: false } as never);
    await expect(svc.login({ email: 'a@b.com', password: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
