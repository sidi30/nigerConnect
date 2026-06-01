import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import {
  bootApp,
  register,
  uploadImage,
  presignOnly,
  cleanupTestData,
  type RegisteredUser,
} from './helpers';

describe('Upload media (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let user: RegisteredUser;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    user = await register(app);
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  // Real uploads round-trip through MinIO: presign -> client PUTs bytes ->
  // attach the returned publicUrl, which the server verifies with a HEAD.

  it(
    'HAPPY: presign -> PUT bytes -> attach avatar',
    async () => {
      const publicUrl = await uploadImage(app, user.accessToken, 'avatar');
      const patch = await request(app.getHttpServer())
        .patch('/api/profile/me/avatar')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ avatarUrl: publicUrl })
        .expect(200);
      expect(patch.body.user.avatarUrl).toBe(publicUrl);
      expect(patch.body.user.avatarUrl).toContain('http://localhost:9000/nigerconnect/');
    },
  );

  it(
    'HAPPY: a fully uploaded cover attaches',
    async () => {
      const coverUrl = await uploadImage(app, user.accessToken, 'cover');
      const patch = await request(app.getHttpServer())
        .patch('/api/profile/me/cover')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ coverUrl })
        .expect(200);
      expect(patch.body.user.coverUrl).toBe(coverUrl);
    },
  );

  it('a really-uploaded object attaches successfully (200)', async () => {
    const publicUrl = await uploadImage(app, user.accessToken, 'avatar');
    const patch = await request(app.getHttpServer())
      .patch('/api/profile/me/avatar')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ avatarUrl: publicUrl })
      .expect(200);
    expect(patch.body.user.avatarUrl).toBe(publicUrl);
  });

  it('REGRESSION (fixed bug): attaching a FOREIGN url is rejected (400)', async () => {
    await request(app.getHttpServer())
      .patch('/api/profile/me/avatar')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ avatarUrl: 'https://evil.tld/x.png' })
      .expect(400);
  });

  it('REGRESSION (fixed bug): valid-host url whose object was never uploaded -> 400', async () => {
    const { publicUrl } = await presignOnly(app, user.accessToken, 'avatar');
    await request(app.getHttpServer())
      .patch('/api/profile/me/avatar')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ avatarUrl: publicUrl })
      .expect(400);
  });

  it("REGRESSION (fixed bug): cannot attach another user's object (ownerId scope, 400)", async () => {
    // The ownerId guard runs before the existence HEAD, so no bytes are needed:
    // a presigned URL whose key lives under users/<other.id>/ proves the scope.
    const other = await register(app);
    const { publicUrl: othersUrl } = await presignOnly(app, other.accessToken, 'avatar');
    expect(othersUrl).toContain(`users/${other.id}/`);
    await request(app.getHttpServer())
      .patch('/api/profile/me/avatar')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ avatarUrl: othersUrl })
      .expect(400);
  });
});
