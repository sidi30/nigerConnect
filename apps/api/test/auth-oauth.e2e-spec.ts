import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { GoogleOAuthService } from '../src/auth/google-oauth.service';
import { AppleVerifierService } from '../src/auth/apple-verifier.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { NoopThrottlerStorage, cleanupTestData } from './helpers';
import type { GoogleProfile } from '../src/auth/google-oauth.service';
import type { AppleIdentity } from '../src/auth/apple-verifier.service';

/**
 * E2E tests for Google and Apple OAuth routes.
 *
 * We cannot generate real provider tokens without a device and live credentials.
 * Instead we:
 *   1. Override GoogleOAuthService and AppleVerifierService at the module level
 *      so that `verifyIdToken` / `verify` resolve to a controlled fake profile
 *      (success path) or throw UnauthorizedException (rejection path).
 *   2. Send real HTTP requests through supertest — the Zod validation pipe,
 *      the rate limiter (disabled via NoopThrottlerStorage), the controller
 *      wiring, and the Prisma write all execute for real.
 *   3. Clean up any users created in the DB in afterAll.
 *
 * What is NOT tested here (covered elsewhere or by unit tests):
 *   - Actual cryptographic verification against Google/Apple keys — that
 *     belongs to google-oauth.service.spec.ts / apple-verifier.service.spec.ts.
 *   - Token refresh and logout — covered by auth.e2e-spec.ts.
 */
describe('Auth — OAuth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // ── Fake profiles returned by the mocked services ──────────────────────────

  const GOOGLE_PROFILE: GoogleProfile = {
    providerId: 'google-sub-e2e-test-001',
    email: 'u_google_e2e@example.com',
    emailVerified: true,
    firstName: 'Moussa',
    lastName: 'GoogleTest',
    avatarUrl: null,
  };

  const APPLE_IDENTITY: AppleIdentity = {
    sub: 'apple-sub-e2e-test-001',
    email: 'u_apple_e2e@privaterelay.appleid.com',
    emailVerified: true,
    isPrivateEmail: true,
  };

  // ── Mock service implementations ───────────────────────────────────────────

  /**
   * Default mocks accept any token string. Tests that need rejection
   * temporarily replace these implementations via jest.spyOn.
   */
  const mockGoogleService = {
    isConfigured: () => true,
    verifyIdToken: jest.fn().mockResolvedValue(GOOGLE_PROFILE),
  };

  const mockAppleService = {
    isConfigured: true,
    verify: jest.fn().mockResolvedValue(APPLE_IDENTITY),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useClass(NoopThrottlerStorage)
      .overrideProvider(GoogleOAuthService)
      .useValue(mockGoogleService)
      .overrideProvider(AppleVerifierService)
      .useValue(mockAppleService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Remove User rows created by the OAuth sign-in tests.
    // The User model stores the link directly via oauthProvider + oauthProviderId.
    await prisma.user.deleteMany({
      where: {
        oauthProviderId: {
          in: [GOOGLE_PROFILE.providerId, APPLE_IDENTITY.sub, 'apple-sub-e2e-test-002'],
        },
      },
    });
    // Also clean up any email-based test users created incidentally.
    await cleanupTestData(prisma);
    await app.close();
  });

  beforeEach(() => {
    // Reset mock call counts between tests.
    mockGoogleService.verifyIdToken.mockClear();
    mockAppleService.verify.mockClear();
  });

  // ── Zod validation (400) ───────────────────────────────────────────────────

  describe('POST /api/auth/google — Zod validation', () => {
    it('returns 400 when body is empty', async () => {
      await request(app.getHttpServer()).post('/api/auth/google').send({}).expect(400);
    });

    it('returns 400 when idToken is an empty string', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({ idToken: '' })
        .expect(400);
    });

    it('returns 400 when idToken is not a string', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({ idToken: 12345 })
        .expect(400);
    });
  });

  describe('POST /api/auth/apple — Zod validation', () => {
    it('returns 400 when body is empty', async () => {
      await request(app.getHttpServer()).post('/api/auth/apple').send({}).expect(400);
    });

    it('returns 400 when identityToken is an empty string', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/apple')
        .send({ identityToken: '' })
        .expect(400);
    });
  });

  // ── Token rejection (401) ──────────────────────────────────────────────────

  describe('POST /api/auth/google — token rejection', () => {
    it('returns 401 when GoogleOAuthService throws UnauthorizedException', async () => {
      const { UnauthorizedException } = await import('@nestjs/common');
      mockGoogleService.verifyIdToken.mockRejectedValueOnce(
        new UnauthorizedException('Invalid Google ID token'),
      );

      await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({ idToken: 'invalid.token.value' })
        .expect(401);
    });
  });

  describe('POST /api/auth/apple — token rejection', () => {
    it('returns 401 when AppleVerifierService throws UnauthorizedException', async () => {
      const { UnauthorizedException } = await import('@nestjs/common');
      mockAppleService.verify.mockRejectedValueOnce(
        new UnauthorizedException('Invalid Apple identity token'),
      );

      await request(app.getHttpServer())
        .post('/api/auth/apple')
        .send({ identityToken: 'invalid.apple.token' })
        .expect(401);
    });
  });

  // ── Successful sign-in (200 + user + tokens) ───────────────────────────────

  describe('POST /api/auth/google — successful sign-in', () => {
    it('creates a new user and returns tokens on first sign-in', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({ idToken: 'valid-stub-token', deviceName: 'Test Device' })
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(GOOGLE_PROFILE.email);
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.tokens.accessToken).toBeDefined();
      expect(res.body.tokens.refreshToken).toBeDefined();
      // verifyIdToken(idToken, expectedNonce?) — no nonce sent in this request.
      expect(mockGoogleService.verifyIdToken).toHaveBeenCalledWith('valid-stub-token', undefined);
    });

    it('returns the same user on second sign-in (idempotent upsert)', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({ idToken: 'valid-stub-token' })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({ idToken: 'valid-stub-token' })
        .expect(200);

      expect(second.body.user.id).toBe(first.body.user.id);
      expect(second.body.tokens.accessToken).toBeDefined();
    });
  });

  describe('POST /api/auth/apple — successful sign-in', () => {
    it('creates a new user and returns tokens on first sign-in', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/apple')
        .send({
          identityToken: 'valid-apple-stub-token',
          fullName: { givenName: 'Ibrahim', familyName: 'AppleTest' },
          email: 'u_apple_e2e@privaterelay.appleid.com',
          deviceName: 'iPhone Test',
        })
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.tokens.accessToken).toBeDefined();
      expect(res.body.tokens.refreshToken).toBeDefined();
      // verify(identityToken, expectedNonce?) — no nonce sent in this request.
      expect(mockAppleService.verify).toHaveBeenCalledWith('valid-apple-stub-token', undefined);
    });

    it('returns the same user on second sign-in (idempotent upsert)', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/auth/apple')
        .send({ identityToken: 'valid-apple-stub-token' })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post('/api/auth/apple')
        .send({ identityToken: 'valid-apple-stub-token' })
        .expect(200);

      expect(second.body.user.id).toBe(first.body.user.id);
    });

    it('succeeds without optional fields (fullName, email, deviceName)', async () => {
      // Apple only provides fullName/email on first sign-in — subsequent calls omit them.
      // We use a different sub to simulate a fresh user missing those fields.
      mockAppleService.verify.mockResolvedValueOnce({
        sub: 'apple-sub-e2e-test-002',
        email: null,
        emailVerified: false,
        isPrivateEmail: false,
      } satisfies AppleIdentity);

      const res = await request(app.getHttpServer())
        .post('/api/auth/apple')
        .send({ identityToken: 'valid-apple-stub-token-no-email' })
        .expect(200);

      expect(res.body.tokens.accessToken).toBeDefined();

      // afterAll handles cleanup for 'apple-sub-e2e-test-002' via the providerIds list above.
    });
  });
});
