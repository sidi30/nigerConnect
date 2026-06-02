import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

export const STRONG_PASSWORD = 'Str0ng!Password';

/**
 * Some e2e specs round-trip real bytes through object storage
 * (presign -> client PUT -> server HEAD). That needs a reachable MinIO/S3.
 * The local dev stack and a full docker-compose CI provide it; the lean
 * `quality-api` CI job (postgres + redis only) does not, so those specs would
 * fail on connection-refused. Gate them on S3 credentials being present:
 * skip where storage is absent, run everywhere it exists. Validation-only
 * upload tests (foreign host, missing object -> 400) don't need a live bucket
 * and keep running unconditionally.
 */
export const S3_LIVE = Boolean(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
export const itUpload = S3_LIVE ? it : it.skip;

/**
 * In-memory ThrottlerStorage replacement that always reports zero hits, so the
 * global rate limiter never trips during e2e runs.
 *
 * Why the storage and not the guard: the limiter is wired through
 * ThrottlerModule.forRoot, and neither `.overrideGuard(ThrottlerGuard)` nor
 * `.overrideProvider(APP_GUARD)` actually suppresses it (verified: registration
 * still 429s after exactly 3 hits — the @Throttle({short:{limit:3}}) on
 * /auth/register). Swapping the ThrottlerStorage provider DOES disable it
 * cleanly (verified: 14/14 registrations return 201). Rate limiting itself is a
 * real prod control and stays exercised by unit tests; in e2e every request
 * comes from 127.0.0.1 in one process, so the shared per-IP counter is a
 * harness artefact, not behaviour under test.
 */
export class NoopThrottlerStorage implements ThrottlerStorage {
  async increment(): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
  }
}

export function uniqueEmail(): string {
  return `u_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

/**
 * Boot the full Nest app like the existing auth/health e2e specs, with the
 * global rate limiter neutralised. Rate limits are a real production control,
 * but they use one in-memory store keyed by client IP; every e2e spec hits the
 * API from 127.0.0.1 in one process, so a full-suite run bursts past
 * `short: 10/s` and 429s — a harness artefact, not behaviour under test.
 */
export async function bootApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ThrottlerStorage)
    .useClass(NoopThrottlerStorage)
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health'] });
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma };
}

export interface RegisteredUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export async function register(
  app: INestApplication,
  overrides: Partial<{ firstName: string; lastName: string }> = {},
): Promise<RegisteredUser> {
  const email = uniqueEmail();
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      email,
      password: STRONG_PASSWORD,
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? 'User',
    })
    .expect(201);

  // The email-activation gate (EmailVerifiedGuard) returns 403 on most write
  // routes until the account is verified, reading `emailVerified` live from the
  // DB. These specs exercise authenticated behaviour, not the activation flow
  // itself (covered by the dedicated gate spec in auth.e2e-spec.ts), so mark
  // the freshly-created user verified directly. The already-issued access token
  // then passes the guard on the next request.
  const prisma = app.get(PrismaService);
  await prisma.user.update({
    where: { id: res.body.user.id },
    data: { emailVerified: true },
  });

  return {
    id: res.body.user.id,
    email,
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
  };
}

/** A minimal valid 1x1 transparent PNG. */
export function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
}

/**
 * Full real upload round-trip against MinIO:
 *   presign -> PUT bytes (with Content-Type, + SSE header only if required) ->
 *   return the canonical publicUrl the server will accept at attach time.
 * Throws if the PUT fails so callers see the MinIO error directly.
 */
export async function uploadImage(
  app: INestApplication,
  accessToken: string,
  kind: 'avatar' | 'cover' | 'photo' = 'photo',
): Promise<string> {
  const presign = await request(app.getHttpServer())
    .post('/api/profile/me/photos/presign')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ contentType: 'image/png', kind })
    .expect(201);

  const { uploadUrl, publicUrl, sseRequired } = presign.body as {
    uploadUrl: string;
    publicUrl: string;
    sseRequired: boolean;
  };

  // The presigned PUT signs content-type;host, so the Content-Type header is
  // required and must match. SSE header only when the deployment pins it
  // (false on MinIO).
  const headers: Record<string, string> = { 'Content-Type': 'image/png' };
  if (sseRequired) headers['x-amz-server-side-encryption'] = 'AES256';

  const put = await fetch(uploadUrl, { method: 'PUT', headers, body: tinyPng() });
  if (!put.ok) {
    throw new Error(`MinIO PUT failed: ${put.status} ${await put.text()}`);
  }
  return publicUrl;
}

/**
 * Delete every row created by e2e users (email prefix `u_`) in FK-safe order.
 *
 * Most child rows cascade from User (onDelete: Cascade in schema.prisma), but a
 * few relations are intentionally nullable WITHOUT a cascade — notably
 * `notifications.actor_id` (NotificationActor). A friend request / message from
 * an e2e user writes a notification row on the *recipient* with that user as
 * actor; deleting the actor then trips `notifications_actor_id_fkey`. So we
 * clear notifications where the actor is a u_ user first, then delete users
 * (which cascades each user's own received notifications, posts, messages, etc.).
 */
export async function cleanupTestData(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'u_' } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    // Non-cascading back-references to a user that block user deletion.
    await prisma.notification.deleteMany({ where: { actorId: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: 'u_' } } });
}

/** Presign only (no PUT) — used to craft a valid-host URL whose object never existed. */
export async function presignOnly(
  app: INestApplication,
  accessToken: string,
  kind: 'avatar' | 'cover' | 'photo' | 'identity' = 'photo',
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/profile/me/photos/presign')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ contentType: 'image/png', kind })
    .expect(201);
  return res.body;
}
