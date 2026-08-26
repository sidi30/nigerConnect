import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

describe('AuthService', () => {
  const password = new PasswordService();

  type PrismaMock = {
    user: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    identityDocument: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    invitation: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makePrisma(overrides: { user?: any; identityDocument?: any; invitation?: any } = {}): PrismaMock {
    const base: PrismaMock = {
      user: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
          id: 'u1',
          email: args.data['email'],
          passwordHash: args.data['passwordHash'] ?? null,
          role: 'user',
          identityStatus: 'not_submitted',
          status: 'active',
          failedLoginCount: 0,
          lockedUntil: null,
          ...args.data,
        })),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      identityDocument: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      invitation: {
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(),
    };
    if (overrides.user) Object.assign(base.user, overrides.user);
    if (overrides.identityDocument) Object.assign(base.identityDocument, overrides.identityDocument);
    if (overrides.invitation) Object.assign(base.invitation, overrides.invitation);

    // $transaction supports both the interactive callback API (fn) and the array API
    base['$transaction'] = jest.fn(
      async (fnOrOps: ((tx: PrismaMock) => Promise<unknown>) | Promise<unknown>[]) => {
        if (typeof fnOrOps === 'function') {
          return fnOrOps(base);
        }
        return Promise.all(fnOrOps);
      },
    );
    return base;
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

  function makeSettings(mode: 'open' | 'invite_only' | 'closed' = 'open') {
    return {
      getRegistrationMode: jest.fn(async () => mode),
      getSetting: jest.fn(async () => 'open'),
      setSetting: jest.fn(),
      getDefaultInviteQuota: jest.fn(async () => 3),
      getInviteExpiryDays: jest.fn(async () => 30),
    };
  }

  function makeInvitationsService(opts: {
    resolveCodeForRegistration?: jest.Mock;
    atomicallyConsumeSingleUse?: jest.Mock;
    notifyInviter?: jest.Mock;
    preValidateEmail?: jest.Mock;
    atomicallyConsumeByEmail?: jest.Mock;
  } = {}) {
    return {
      resolveCodeForRegistration:
        opts.resolveCodeForRegistration ??
        jest.fn(async () => ({ inviterId: 'inviter-id', invitationId: 'inv-1', kind: 'single_use' })),
      atomicallyConsumeSingleUse: opts.atomicallyConsumeSingleUse ?? jest.fn(async () => 1),
      notifyInviter: opts.notifyInviter ?? jest.fn(),
      // Email-match path — default: no matching invite (soft null, open mode tests won't call it)
      preValidateEmail: opts.preValidateEmail ?? jest.fn(async () => null),
      atomicallyConsumeByEmail:
        opts.atomicallyConsumeByEmail ??
        jest.fn(async () => ({ count: 1, inviterId: 'inviter-id', invitationId: 'inv-1' })),
    };
  }

  /** Builds a fully wired AuthService with injectable mock overrides. */
  function makeSvc({
    prisma = makePrisma(),
    tokens = makeTokens(),
    redis = makeRedis(),
    google = { verifyIdToken: jest.fn() },
    apple = { verify: jest.fn(), isConfigured: false as boolean | undefined },
    config = makeConfig(),
    settings = makeSettings(),
    invitations = makeInvitationsService(),
    mfa = { verifyForUser: jest.fn(async () => true) },
    mailer = { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn(), sendWelcome: jest.fn() },
  }: {
    prisma?: ReturnType<typeof makePrisma>;
    tokens?: ReturnType<typeof makeTokens>;
    redis?: ReturnType<typeof makeRedis>;
    google?: { verifyIdToken: jest.Mock };
    apple?: { verify: jest.Mock; isConfigured?: boolean };
    config?: ReturnType<typeof makeConfig>;
    settings?: ReturnType<typeof makeSettings>;
    invitations?: ReturnType<typeof makeInvitationsService>;
    mfa?: { verifyForUser: jest.Mock };
    mailer?: { sendPasswordReset: jest.Mock; sendEmailVerification: jest.Mock; sendWelcome: jest.Mock };
  } = {}) {
    return new AuthService(
      prisma as never,
      password,
      tokens as never,
      redis as never,
      mailer as never,
      { create: jest.fn(), consume: jest.fn() } as never,
      google as never,
      apple as never,
      config as never,
      settings as never,
      invitations as never,
      mfa as never,
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
    // No mfaEnabled on the mock → tokens are issued (not an MFA challenge).
    expect('accessToken' in result && result.accessToken).toBeDefined();
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
        mfaEnabled: false,
        emailVerified: true,
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

      // Linking only happens for an OAuth-verified email → the linked stub is
      // marked verified in the same update (otherwise it'd stay gated/off-map).
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-stub' },
          data: { oauthProvider: 'google', oauthProviderId: 'google-sub-123', emailVerified: true },
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

    it('links a Google-verified email to an existing password account without MFA (both methods coexist)', async () => {
      const passwordUser = {
        id: 'u-pwd',
        email: 'alice@gmail.com',
        passwordHash: '$argon2id$hashed',
        oauthProvider: null,
        oauthProviderId: null,
        mfaEnabled: false,
        emailVerified: true, // mailbox ownership already proven via the verify link
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const updatedUser = { ...passwordUser, oauthProvider: 'google', oauthProviderId: 'google-sub-123' };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null), // no existing OAuth link
          findUnique: jest.fn(async () => passwordUser), // email exists with password
          create: jest.fn(),
          update: jest.fn(async () => updatedUser),
        },
      });
      const google = { verifyIdToken: jest.fn(async () => GOOGLE_PROFILE_BASE) };
      const tokens = makeTokens();
      const mailer = { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn(), sendWelcome: jest.fn() };
      const svc = makeSvc({ prisma, google, tokens, mailer });

      const result = await svc.signInWithGoogle('token');

      // Google verified the email → same trust anchor as a password reset, so
      // linking is safe. passwordHash is NOT touched: password login keeps working.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-pwd' },
          data: { oauthProvider: 'google', oauthProviderId: 'google-sub-123', emailVerified: true },
        }),
      );
      // Verified local account → its existing sessions are legitimate, keep them.
      expect(tokens.revokeAllUserTokens).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('access.jwt.token');
      // Already verified → welcome email was owed by the verify flow, not here.
      await new Promise(process.nextTick);
      expect(mailer.sendWelcome).not.toHaveBeenCalled();
    });

    it('drops the password when linking to an UNVERIFIED local account (pre-hijacking guard)', async () => {
      // Attack: the attacker pre-registers the victim's email with a password and
      // never clicks the verify link. When the victim signs in with Google, the
      // link must neutralize that password or the attacker keeps a backdoor.
      const preHijackedUser = {
        id: 'u-prehijack',
        email: 'alice@gmail.com',
        passwordHash: '$argon2id$attacker',
        oauthProvider: null,
        oauthProviderId: null,
        mfaEnabled: false,
        emailVerified: false, // mailbox ownership never proven by the local creator
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const updatedUser = {
        ...preHijackedUser,
        passwordHash: null,
        oauthProvider: 'google',
        oauthProviderId: 'google-sub-123',
        emailVerified: true,
      };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => preHijackedUser),
          create: jest.fn(),
          update: jest.fn(async () => updatedUser),
        },
      });
      const google = { verifyIdToken: jest.fn(async () => GOOGLE_PROFILE_BASE) };
      const tokens = makeTokens();
      const mailer = { sendPasswordReset: jest.fn(), sendEmailVerification: jest.fn(), sendWelcome: jest.fn() };
      const svc = makeSvc({ prisma, google, tokens, mailer });

      await svc.signInWithGoogle('token');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-prehijack' },
          data: {
            oauthProvider: 'google',
            oauthProviderId: 'google-sub-123',
            emailVerified: true,
            passwordHash: null,
          },
        }),
      );
      // The pre-registering attacker also holds refresh tokens from register()
      // — every outstanding session must die with the password.
      expect(tokens.revokeAllUserTokens).toHaveBeenCalledWith('u-prehijack');
      expect(prisma.user.create).not.toHaveBeenCalled();
      // emailVerified just transitioned false → true outside the verify flow —
      // the welcome email is owed here (fire & forget → flush microtasks).
      await new Promise(process.nextTick);
      expect(mailer.sendWelcome).toHaveBeenCalledWith('alice@gmail.com', undefined);
    });

    it('throws ConflictException when the email account has MFA enabled (no second-factor bypass)', async () => {
      const mfaUser = {
        id: 'u-mfa',
        email: 'alice@gmail.com',
        passwordHash: '$argon2id$hashed',
        oauthProvider: null,
        oauthProviderId: null,
        mfaEnabled: true,
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => mfaUser),
          create: jest.fn(),
          update: jest.fn(),
        },
      });
      const google = { verifyIdToken: jest.fn(async () => GOOGLE_PROFILE_BASE) };
      const svc = makeSvc({ prisma, google });

      // The password login answers with a TOTP challenge; loginWithOAuth mints
      // tokens directly — linking here would skip the second factor entirely.
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
        mfaEnabled: false,
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

    it('marks a fresh Apple account verified even when the token carries no email', async () => {
      // App Store Guideline 4 / Apple HIG: a Sign-in-with-Apple identity is a
      // complete, verified authentication. Apple omits the email claim on
      // re-authorization — the new account must STILL be verified so the user is
      // never bounced to the verify-email screen (the prior App Store rejection).
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
            emailVerified: true,
          }),
        }),
      );
    });

    it('marks a fresh Apple account verified on the create path (provider-authenticated)', async () => {
      // The create branch is only reached when NO existing account owns this email
      // (the auto-link takeover guard — tested separately — already ran and stays
      // strict). So trusting Apple here cannot take over or squat a real owner's
      // account, and it keeps the user off the verify-email dead-end.
      const prisma = makePrisma();
      const apple = {
        verify: jest.fn(async () => ({
          sub: 'apple.user.unverified',
          email: 'newcomer@example.com',
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
            email: 'newcomer@example.com',
            emailVerified: true,
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
        mfaEnabled: false,
        emailVerified: true,
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

      // Linking only happens for an OAuth-verified email → mark the stub verified.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-stub-apple' },
          data: { oauthProvider: 'apple', oauthProviderId: 'apple.user.001', emailVerified: true },
        }),
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('links an Apple-verified email to an existing password account without MFA (both methods coexist)', async () => {
      const passwordUser = {
        id: 'u-pwd-apple',
        email: 'alice@privaterelay.appleid.com',
        passwordHash: '$argon2id$hashed',
        oauthProvider: null,
        oauthProviderId: null,
        mfaEnabled: false,
        emailVerified: true, // mailbox ownership already proven via the verify link
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const updatedUser = { ...passwordUser, oauthProvider: 'apple', oauthProviderId: 'apple.user.001' };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => passwordUser),
          create: jest.fn(),
          update: jest.fn(async () => updatedUser),
        },
      });
      const apple = {
        verify: jest.fn(async () => APPLE_VERIFIED_BASE),
        isConfigured: true,
      };
      const tokens = makeTokens();
      const svc = makeSvc({ prisma, apple, tokens });

      await svc.signInWithApple({ identityToken: 'token' });

      // passwordHash is NOT touched: password login keeps working alongside Apple.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-pwd-apple' },
          data: { oauthProvider: 'apple', oauthProviderId: 'apple.user.001', emailVerified: true },
        }),
      );
      // Verified local account → its existing sessions are legitimate, keep them.
      expect(tokens.revokeAllUserTokens).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('drops the password when linking Apple to an UNVERIFIED local account (pre-hijacking guard)', async () => {
      // Same shared loginWithOAuth path as Google — the attacker's never-verified
      // password must not survive the link.
      const preHijackedUser = {
        id: 'u-prehijack-apple',
        email: 'alice@privaterelay.appleid.com',
        passwordHash: '$argon2id$attacker',
        oauthProvider: null,
        oauthProviderId: null,
        mfaEnabled: false,
        emailVerified: false,
        role: 'user',
        identityStatus: 'not_submitted',
      };
      const updatedUser = {
        ...preHijackedUser,
        passwordHash: null,
        oauthProvider: 'apple',
        oauthProviderId: 'apple.user.001',
        emailVerified: true,
      };
      const prisma = makePrisma({
        user: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => preHijackedUser),
          create: jest.fn(),
          update: jest.fn(async () => updatedUser),
        },
      });
      const apple = {
        verify: jest.fn(async () => APPLE_VERIFIED_BASE),
        isConfigured: true,
      };
      const tokens = makeTokens();
      const svc = makeSvc({ prisma, apple, tokens });

      await svc.signInWithApple({ identityToken: 'token' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-prehijack-apple' },
          data: {
            oauthProvider: 'apple',
            oauthProviderId: 'apple.user.001',
            emailVerified: true,
            passwordHash: null,
          },
        }),
      );
      expect(tokens.revokeAllUserTokens).toHaveBeenCalledWith('u-prehijack-apple');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when Apple email already linked to Google (anti-takeover)', async () => {
      const googleUser = {
        id: 'u-google',
        email: 'alice@privaterelay.appleid.com',
        passwordHash: null,
        oauthProvider: 'google',
        oauthProviderId: 'google-sub-999',
        mfaEnabled: false,
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

  // ── Manual identity verification (admin, no document) ───────────────────────

  describe('manualApproveIdentity', () => {
    // A safely-past adult DOB (well over 18) used across the happy-path tests.
    const ADULT_DOB = '1990-06-15';

    it('UPSERTs a manual approved doc and flips the user to approved (no prior doc)', async () => {
      const prisma = makePrisma({
        user: {
          findUnique: jest.fn(async () => ({ id: 'u1' })),
          update: jest.fn(async () => ({})),
        },
        identityDocument: {
          findFirst: jest.fn(async () => null), // no existing manual doc → create
          create: jest.fn(async () => ({ id: 'doc-new' })),
          update: jest.fn(),
        },
      });
      const svc = makeSvc({ prisma });

      await svc.manualApproveIdentity('admin-1', 'u1', ADULT_DOB, 'Vérifié en personne');

      expect(prisma.identityDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            documentType: 'manual',
            fileUrl: null,
            status: 'approved',
            reviewedById: 'admin-1',
            reason: 'Vérifié en personne',
            dateOfBirth: new Date('1990-06-15T00:00:00.000Z'),
          }),
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          // La date atterrit AUSSI sur le compte : le document manuel est purgé
          // 30 jours après, le contrôle 18+ doit lui survivre.
          data: { identityStatus: 'approved', dateOfBirth: new Date('1990-06-15T00:00:00.000Z') },
        }),
      );
    });

    it('rewrites the existing manual doc when re-approving (idempotent)', async () => {
      const prisma = makePrisma({
        user: {
          findUnique: jest.fn(async () => ({ id: 'u1' })),
          update: jest.fn(async () => ({})),
        },
        identityDocument: {
          findFirst: jest.fn(async () => ({ id: 'doc-existing' })),
          create: jest.fn(),
          update: jest.fn(async () => ({})),
        },
      });
      const svc = makeSvc({ prisma });

      await svc.manualApproveIdentity('admin-2', 'u1', ADULT_DOB, 'Re-validé');

      expect(prisma.identityDocument.create).not.toHaveBeenCalled();
      expect(prisma.identityDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-existing' },
          data: expect.objectContaining({
            status: 'approved',
            fileUrl: null,
            reviewedById: 'admin-2',
            reason: 'Re-validé',
          }),
        }),
      );
    });

    it('rejects a missing date of birth', async () => {
      const prisma = makePrisma();
      const svc = makeSvc({ prisma });
      await expect(
        svc.manualApproveIdentity('admin-1', 'u1', '', 'reason'),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Bails out before any write.
      expect(prisma.identityDocument.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an under-18 date of birth (18+ gate)', async () => {
      const prisma = makePrisma();
      const svc = makeSvc({ prisma });
      // Someone who turns "old enough" only next year — 10 years old today.
      const tenYearsAgo = new Date();
      tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);
      const minorDob = tenYearsAgo.toISOString().slice(0, 10);
      await expect(
        svc.manualApproveIdentity('admin-1', 'u1', minorDob, 'reason'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.identityDocument.create).not.toHaveBeenCalled();
    });

    it('rejects a future date of birth', async () => {
      const prisma = makePrisma();
      const svc = makeSvc({ prisma });
      const nextYear = new Date();
      nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
      const futureDob = nextYear.toISOString().slice(0, 10);
      await expect(
        svc.manualApproveIdentity('admin-1', 'u1', futureDob, 'reason'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when the target user does not exist', async () => {
      const prisma = makePrisma({
        user: { findUnique: jest.fn(async () => null) },
      });
      const svc = makeSvc({ prisma });
      await expect(
        svc.manualApproveIdentity('admin-1', 'ghost', ADULT_DOB, 'reason'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('revokeIdentity', () => {
    it('marks the latest doc rejected and flips the user to rejected', async () => {
      const prisma = makePrisma({
        user: {
          findUnique: jest.fn(async () => ({ id: 'u1' })),
          update: jest.fn(async () => ({})),
        },
        identityDocument: {
          findFirst: jest.fn(async () => ({ id: 'doc-1' })),
          update: jest.fn(async () => ({})),
          create: jest.fn(),
        },
      });
      const svc = makeSvc({ prisma });

      await svc.revokeIdentity('admin-1', 'u1', 'Fraude constatée');

      expect(prisma.identityDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: expect.objectContaining({
            status: 'rejected',
            reviewedById: 'admin-1',
            rejectionReason: 'Fraude constatée',
            reason: 'Fraude constatée',
          }),
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { identityStatus: 'rejected' },
        }),
      );
    });

    it('falls back to not_submitted when the user never submitted a doc', async () => {
      const prisma = makePrisma({
        user: {
          findUnique: jest.fn(async () => ({ id: 'u1' })),
          update: jest.fn(async () => ({})),
        },
        identityDocument: {
          findFirst: jest.fn(async () => null),
          update: jest.fn(),
          create: jest.fn(),
        },
      });
      const svc = makeSvc({ prisma });

      await svc.revokeIdentity('admin-1', 'u1', 'Compte nettoyé');

      expect(prisma.identityDocument.update).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { identityStatus: 'not_submitted' },
        }),
      );
    });

    it('404s when the target user does not exist', async () => {
      const prisma = makePrisma({
        user: { findUnique: jest.fn(async () => null) },
      });
      const svc = makeSvc({ prisma });
      await expect(
        svc.revokeIdentity('admin-1', 'ghost', 'reason'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
