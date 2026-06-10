import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { bootApp, register, presignOnly, cleanupTestData, type RegisteredUser } from './helpers';

describe('Profile verification / identity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let user: RegisteredUser;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    user = await register(app, { firstName: 'Ver', lastName: 'Ify' });
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('cannot self-grant identityStatus/role via PATCH /profile/me (fields ignored)', async () => {
    await request(app.getHttpServer())
      .patch('/api/profile/me')
      .set(auth(user.accessToken))
      .send({ identityStatus: 'approved', role: 'admin', bio: 'legit field' })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/api/profile/me')
      .set(auth(user.accessToken))
      .expect(200);
    expect(me.body.user.identityStatus).toBe('not_submitted');
    expect(me.body.user.role).toBe('user');
    expect(me.body.user.bio).toBe('legit field');
  });

  it('identity submit with a valid private pointer -> 202 and identityStatus pending', async () => {
    // identity presign returns an s3://<privateBucket>/users/<id>/identity/<file> pointer.
    const { publicUrl } = await presignOnly(app, user.accessToken, 'identity');
    expect(publicUrl).toMatch(/^s3:\/\/nigerconnect-private\/users\//);

    await request(app.getHttpServer())
      .post('/api/auth/identity/submit')
      .set(auth(user.accessToken))
      .send({ documentType: 'passport', fileUrl: publicUrl })
      .expect(202);

    const status = await request(app.getHttpServer())
      .get('/api/auth/identity/status')
      .set(auth(user.accessToken))
      .expect(200);
    expect(status.body.status).toBe('pending');
  });

  it('REGRESSION (SSRF): identity submit with disallowed pointers -> 400', async () => {
    const cases = [
      'https://evil.tld/passport.png', // foreign host
      'http://localhost:9000/nigerconnect/users/x/identity/a.png', // public bucket
      's3://nigerconnect/users/x/identity/a.png', // public bucket via s3://
      `s3://nigerconnect-private/users/${'00000000-0000-0000-0000-000000000000'}/identity/a.png`, // another user's folder
      's3://nigerconnect-private/users/../identity/a.png', // path traversal
    ];
    for (const fileUrl of cases) {
      await request(app.getHttpServer())
        .post('/api/auth/identity/submit')
        .set(auth(user.accessToken))
        .send({ documentType: 'passport', fileUrl })
        .expect(400);
    }
  });

  it('admin can review/approve; non-admin reviewing -> 403', async () => {
    const target = await register(app, { firstName: 'Tar', lastName: 'Get' });
    const { publicUrl } = await presignOnly(app, target.accessToken, 'identity');
    await request(app.getHttpServer())
      .post('/api/auth/identity/submit')
      .set(auth(target.accessToken))
      .send({ documentType: 'passport', fileUrl: publicUrl })
      .expect(202);

    // Non-admin attempt -> 403
    await request(app.getHttpServer())
      .patch('/api/auth/identity/review')
      .set(auth(user.accessToken))
      .send({ userId: target.id, decision: 'approved' })
      .expect(403);

    // Promote a separate user to admin via prisma, then re-login to get a token
    // carrying the admin role claim.
    const admin = await register(app, { firstName: 'Ad', lastName: 'Min' });
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'Str0ng!Password' })
      .expect(200);
    const adminToken = login.body.tokens.accessToken;

    await request(app.getHttpServer())
      .patch('/api/auth/identity/review')
      .set(auth(adminToken))
      .send({ userId: target.id, decision: 'approved' })
      .expect(200);

    const status = await request(app.getHttpServer())
      .get('/api/auth/identity/status')
      .set(auth(target.accessToken))
      .expect(200);
    expect(status.body.status).toBe('approved');
  });
});
