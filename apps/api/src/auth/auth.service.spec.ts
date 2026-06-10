import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
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

  function makeConfig(privateBucket = 'nigerconnect-private') {
    return { get: jest.fn(() => privateBucket) };
  }

  /** Builds a fully wired AuthService with injectable mock overrides. */
  function makeSvc({
    prisma = makePrisma(),
    tokens = makeTokens(),
    redis = makeRedis(),
    google = { verifyIdToken: jest.fn() },
    apple = { verify: jest.fn(), isConfigured: false as boolean | undefined },
    config = makeConfig(),
  }: {
    prisma?: ReturnType<typeof makePrisma>;
    tokens?: ReturnType<typeof makeTokens>;
    redis?: ReturnType<typeof makeRedis>;
    google?: { verifyIdToken: jest.Mock };
    apple?: { verify: jest.Mock; isConfigured?: boolean };
    config?: ReturnType<typeof makeConfig>;
  } = {}) {
    return new AuthService(
      prisma as never,
      password,
      tokens as never,
      redis as never,
      { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn() } as never,
      { create: jest.fn(), consume: jest.fn() } as never,
      google as never,
      apple as never,
      config as never,
    );
  }

  // ── Password / register ────────────────────────────────────────────────────

  it('registers a new user', async () => {
    const prisma = makePrisma();
    const tokens = makeTokens();
    const svc = makeSvc({ prisma, tokens });

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
    const svc = makeSvc({ prisma });
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
    const svc = makeSvc({ prisma });
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
    const svc = makeSvc({ prisma });
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
    const svc = makeSvc({ prisma });
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
    const svc = makeSvc({ prisma });
    await expect(svc.login({ email: 'a@b.com', password: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('stores a valid private identity pointer scoped to the caller', async () => {
    const prisma = makePrisma();
    const svc = makeSvc({ prisma });
    await svc.submitIdentity(
      'u1',
      'passport',
      's3://nigerconnect-private/users/u1/identity/doc.jpg',
    );
    expect(prisma.identityDocument.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        documentType: 'passport',
        fileUrl: 's3://nigerconnect-private/users/u1/identity/doc.jpg',
        status: 'pending',
      },
    });
  });

  it('rejects an identity pointer for the public bucket or another user', async () => {
    const prisma = makePrisma();
    const svc = makeSvc({ prisma });
    // Public bucket / foreign host
    await expect(
      svc.submitIdentity('u1', 'passport', 'https://cdn.example/users/u1/identity/doc.jpg'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Another user's identity folder
    await expect(
      svc.submitIdentity('u1', 'passport', 's3://nigerconnect-private/users/u2/identity/doc.jpg'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Path traversal out of the identity folder
    await expect(
      svc.submitIdentity('u1', 'passport', 's3://nigerconnect-private/users/u1/identity/../../u2/x'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.identityDocument.create).not.toHaveBeenCalled();
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
    const svc = makeSvc({ prisma });
    await expect(svc.login({ email: 'a@b.com', password: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // ── Google OAuth ────────────────────────────────────────────────────────────

  describe('signInWithGoogle', () => {
    const GOOGLE_PROFILE_BASE = {
      providerId: 'google-sub-123',
      email: 'alice@gmail.com',
      emailVerified: true,
      firstName: 'Alice',
      lastName: 'Dupont',
      avatarUrl: 'https://lh3.googleusercontent.com/photo.jpg',
    };

    it('creates a new user on first Google sign-in', async () => {
      const prisma = makePrisma();
      // findFirst (by provider+id) → null, findUnique (by email) → null → create
      const google = { verifyIdToken: jest.fn(async () => GOOGLE_PROFILE_BASE) };
      const tokens = makeTokens();
      const svc = makeSvc({ prisma, google, tokens });

      const result = await svc.signInWithGoogle('valid.google.idtoken');

      // Second arg is the optional anti-replay nonce — undefined when the client
      // didn't send one (backward-compatible).
      expect(google.verifyIdToken).toHaveBeenCalledWith('valid.google.idtoken', undefined);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'alice@gmail.com',
            oauthProvider: 'google',
            oauthProviderId: 'google-sub-123',
            firstName: 'Alice',
            lastName: 'Dupont',
            emailVerified: true,
          }),
        }),
      );
      expect(result.accessToken).toBe('access.jwt.token');
      expect(result.refreshToken).toBe('refresh.raw.token');
    });

    it('forwards the anti-replay nonce to the Google verifier when present', async () => {
      const prisma = makePrisma();
      const google = { verifyIdToken: jest.fn(async () => GOOGLE_PROFILE_BASE) };
      const svc = makeSvc({ prisma, google });

      await svc.signInWithGoogle('valid.google.idtoken', 'iPhone 15', 'nonce-abc');

      expect(google.verifyIdToken).toHaveBeenCalledWith('valid.google.idtoken', 'nonce-abc');
    });

    it('signs in an existing user matched by (provider, providerId)', async () => {
      const existingUser = {
        id: 'u-existing',
        email: 'alice@gmail.com',
        passwordHash: null,
        oauthProvider: 'google',
        oauthProviderId: 'google-sub-123',
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const prisma = makePrisma({
        user: {
          // findFirst by provider+id returns the linked user
          findFirst: jest.fn(async () => existingUser),
          findUnique: jest.fn(async () => null),
          create: jest.fn(),
          update: jest.fn(async () => ({})),
        },
      });
      const google = { verifyIdToken: jest.fn(async () => GOOGLE_PROFILE_BASE) };
      const tokens = makeTokens();
      const svc = makeSvc({ prisma, google, tokens });

      const result = await svc.signInWithGoogle('valid.google.idtoken', 'iPhone 15');

      // Should NOT create a new user
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(tokens.issueTokens).toHaveBeenCalledWith(
        'u-existing',
        existingUser.role,
        existingUser.identityStatus,
        'iPhone 15',
      );
      expect(result.accessToken).toBe('access.jwt.token');
    });

    it('links an OAuth-verified email to an existing stub account (no password, no other provider)', async () => {
      const stubUser = {
        id: 'u-stub',
        email: 'alice@gmail.com',
        passwordHash: null,
        oauthProvider: null,
        oauthProviderId: null,
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const updatedUser = { ...stubUser, oauthProvider: 'google', oauthProviderId: 'google-sub-123' };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null), // no existing link
          findUnique: jest.fn(async () => stubUser), // found by email
          create: jest.fn(),
          update: jest.fn(async () => updatedUser),
        },
      });
      const google = { verifyIdToken: jest.fn(async () => GOOGLE_PROFILE_BASE) };
      const tokens = makeTokens();
      const svc = makeSvc({ prisma, google, tokens });

      const result = await svc.signInWithGoogle('valid.google.idtoken');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-stub' },
          data: { oauthProvider: 'google', oauthProviderId: 'google-sub-123' },
        }),
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('access.jwt.token');
    });

    it('rejects Google sign-in when the email is not verified', async () => {
      const google = {
        verifyIdToken: jest.fn(async () => ({
          ...GOOGLE_PROFILE_BASE,
          emailVerified: false,
        })),
      };
      const svc = makeSvc({ google });

      await expect(svc.signInWithGoogle('token')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(svc.signInWithGoogle('token')).rejects.toThrow('not verified');
    });

    it('throws ConflictException when email belongs to a password account (anti-takeover)', async () => {
      const passwordUser = {
        id: 'u-pwd',
        email: 'alice@gmail.com',
        passwordHash: '$argon2id$hashed',
        oauthProvider: null,
        oauthProviderId: null,
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null), // no existing OAuth link
          findUnique: jest.fn(async () => passwordUser), // but email exists with password
          create: jest.fn(),
          update: jest.fn(),
        },
      });
      const google = { verifyIdToken: jest.fn(async () => GOOGLE_PROFILE_BASE) };
      const svc = makeSvc({ prisma, google });

      await expect(svc.signInWithGoogle('token')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when email already linked to a different OAuth provider (anti-takeover)', async () => {
      const appleUser = {
        id: 'u-apple',
        email: 'alice@gmail.com',
        passwordHash: null,
        oauthProvider: 'apple',
        oauthProviderId: 'apple-sub-456',
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => appleUser),
          create: jest.fn(),
          update: jest.fn(),
        },
      });
      const google = { verifyIdToken: jest.fn(async () => GOOGLE_PROFILE_BASE) };
      const svc = makeSvc({ prisma, google });

      await expect(svc.signInWithGoogle('token')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── Apple Sign In ───────────────────────────────────────────────────────────

  describe('signInWithApple', () => {
    const APPLE_VERIFIED_BASE = {
      sub: 'apple.user.001',
      email: 'alice@privaterelay.appleid.com',
      emailVerified: true,
      isPrivateEmail: true,
    };

    it('creates a new user on first Apple sign-in, using fullName from client payload', async () => {
      const prisma = makePrisma();
      const apple = {
        verify: jest.fn(async () => APPLE_VERIFIED_BASE),
        isConfigured: true,
      };
      const tokens = makeTokens();
      const svc = makeSvc({ prisma, apple, tokens });

      const result = await svc.signInWithApple({
        identityToken: 'valid.apple.token',
        fullName: { givenName: 'Alice', familyName: 'Dupont' },
        deviceName: 'iPhone 14',
      });

      // Second arg is the optional hashed nonce — undefined when the client
      // didn't send a rawNonce (backward-compatible).
      expect(apple.verify).toHaveBeenCalledWith('valid.apple.token', undefined);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            oauthProvider: 'apple',
            oauthProviderId: 'apple.user.001',
            firstName: 'Alice',
            lastName: 'Dupont',
            email: 'alice@privaterelay.appleid.com',
            emailVerified: true,
          }),
        }),
      );
      expect(result.accessToken).toBe('access.jwt.token');
      expect(result.refreshToken).toBe('refresh.raw.token');
    });

    it('passes sha256(rawNonce) to the Apple verifier when a rawNonce is sent', async () => {
      const prisma = makePrisma();
      const apple = { verify: jest.fn(async () => APPLE_VERIFIED_BASE), isConfigured: true };
      const svc = makeSvc({ prisma, apple });

      const rawNonce = 'raw-nonce-123';
      // sha256 hex of 'raw-nonce-123'
      const expectedHashed = createHash('sha256').update(rawNonce).digest('hex');

      await svc.signInWithApple({ identityToken: 'valid.apple.token', rawNonce });

      expect(apple.verify).toHaveBeenCalledWith('valid.apple.token', expectedHashed);
    });

    it('signs in an existing Apple user matched by (provider, providerId)', async () => {
      const existingUser = {
        id: 'u-apple-existing',
        email: 'alice@privaterelay.appleid.com',
        passwordHash: null,
        oauthProvider: 'apple',
        oauthProviderId: 'apple.user.001',
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => existingUser),
          findUnique: jest.fn(async () => null),
          create: jest.fn(),
          update: jest.fn(async () => ({})),
        },
      });
      const apple = {
        verify: jest.fn(async () => APPLE_VERIFIED_BASE),
        isConfigured: true,
      };
      const tokens = makeTokens();
      const svc = makeSvc({ prisma, apple, tokens });

      // On subsequent sign-ins, Apple does NOT resend fullName or email
      const result = await svc.signInWithApple({
        identityToken: 'valid.apple.token',
        deviceName: 'iPad Pro',
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(tokens.issueTokens).toHaveBeenCalledWith(
        'u-apple-existing',
        existingUser.role,
        existingUser.identityStatus,
        'iPad Pro',
      );
      expect(result.accessToken).toBe('access.jwt.token');
    });

    it('handles private relay email — treats it as verified (emailVerified true)', async () => {
      const prisma = makePrisma();
      const apple = {
        verify: jest.fn(async () => ({
          sub: 'apple.user.relay',
          email: 'abc123@privaterelay.appleid.com',
          emailVerified: true,
          isPrivateEmail: true,
        })),
        isConfigured: true,
      };
      const tokens = makeTokens();
      const svc = makeSvc({ prisma, apple, tokens });

      await svc.signInWithApple({ identityToken: 'token' });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'abc123@privaterelay.appleid.com',
            // emailVerified follows the verifier's explicit email_verified claim
            emailVerified: true,
          }),
        }),
      );
    });

    it('handles null email from Apple (token carries no email, no client fallback)', async () => {
      const prisma = makePrisma();
      const apple = {
        verify: jest.fn(async () => ({
          sub: 'apple.user.noemail',
          email: null,
          emailVerified: false,
          isPrivateEmail: false,
        })),
        isConfigured: true,
      };
      const svc = makeSvc({ prisma, apple });

      await svc.signInWithApple({ identityToken: 'token' });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: null,
            emailVerified: false,
          }),
        }),
      );
    });

    it('does NOT mark verified when Apple sends an email but no verified claim', async () => {
      const prisma = makePrisma();
      const apple = {
        verify: jest.fn(async () => ({
          sub: 'apple.user.unverified',
          email: 'mallory@example.com',
          // Verifier saw no explicit `email_verified` claim → false
          emailVerified: false,
          isPrivateEmail: false,
        })),
        isConfigured: true,
      };
      const svc = makeSvc({ prisma, apple });

      await svc.signInWithApple({ identityToken: 'token' });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'mallory@example.com',
            emailVerified: false,
          }),
        }),
      );
    });

    it('links Apple identity to an existing stub account (no password, no other provider)', async () => {
      const stubUser = {
        id: 'u-stub-apple',
        email: 'alice@privaterelay.appleid.com',
        passwordHash: null,
        oauthProvider: null,
        oauthProviderId: null,
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const updatedUser = { ...stubUser, oauthProvider: 'apple', oauthProviderId: 'apple.user.001' };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => stubUser),
          create: jest.fn(),
          update: jest.fn(async () => updatedUser),
        },
      });
      const apple = {
        verify: jest.fn(async () => APPLE_VERIFIED_BASE),
        isConfigured: true,
      };
      const svc = makeSvc({ prisma, apple });

      await svc.signInWithApple({ identityToken: 'token' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-stub-apple' },
          data: { oauthProvider: 'apple', oauthProviderId: 'apple.user.001' },
        }),
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when Apple email matches a password account (anti-takeover)', async () => {
      const passwordUser = {
        id: 'u-pwd-apple',
        email: 'alice@privaterelay.appleid.com',
        passwordHash: '$argon2id$hashed',
        oauthProvider: null,
        oauthProviderId: null,
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => passwordUser),
          create: jest.fn(),
          update: jest.fn(),
        },
      });
      const apple = {
        verify: jest.fn(async () => APPLE_VERIFIED_BASE),
        isConfigured: true,
      };
      const svc = makeSvc({ prisma, apple });

      await expect(svc.signInWithApple({ identityToken: 'token' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when Apple email already linked to Google (anti-takeover)', async () => {
      const googleUser = {
        id: 'u-google',
        email: 'alice@privaterelay.appleid.com',
        passwordHash: null,
        oauthProvider: 'google',
        oauthProviderId: 'google-sub-999',
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => googleUser),
          create: jest.fn(),
          update: jest.fn(),
        },
      });
      const apple = {
        verify: jest.fn(async () => APPLE_VERIFIED_BASE),
        isConfigured: true,
      };
      const svc = makeSvc({ prisma, apple });

      await expect(svc.signInWithApple({ identityToken: 'token' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('prefers token email over client-supplied email on first sign-in', async () => {
      const prisma = makePrisma();
      const apple = {
        verify: jest.fn(async () => ({
          sub: 'apple.user.002',
          email: 'token-email@privaterelay.appleid.com',
          emailVerified: true,
          isPrivateEmail: true,
        })),
        isConfigured: true,
      };
      const svc = makeSvc({ prisma, apple });

      await svc.signInWithApple({
        identityToken: 'token',
        email: 'client-sent-email@example.com', // should be ignored
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            // token email wins
            email: 'token-email@privaterelay.appleid.com',
          }),
        }),
      );
    });
  });
});
