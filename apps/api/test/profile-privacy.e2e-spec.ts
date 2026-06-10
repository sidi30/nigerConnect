import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { bootApp, register, cleanupTestData, type RegisteredUser } from './helpers';

describe('Profile privacy & search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: RegisteredUser; // private
  let carol: RegisteredUser; // stranger
  let pub: RegisteredUser; // public, searchable by name

  const uniqueName = `Zk${Date.now()}`;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    alice = await register(app, { firstName: 'Alice', lastName: 'Private' });
    carol = await register(app, { firstName: 'Carol', lastName: 'Stranger' });
    pub = await register(app, { firstName: uniqueName, lastName: 'Public' });

    await request(app.getHttpServer())
      .patch('/api/profile/me')
      .set({ Authorization: `Bearer ${alice.accessToken}` })
      .send({ privacyLevel: 'private' })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/profile/me')
      .set({ Authorization: `Bearer ${pub.accessToken}` })
      .send({ privacyLevel: 'public' })
      .expect(200);
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('stranger GET /profile/:privateUser -> 404', async () => {
    await request(app.getHttpServer())
      .get(`/api/profile/${alice.id}`)
      .set(auth(carol.accessToken))
      .expect(404);
  });

  it('REGRESSION: stranger cannot see a private user friends list (404)', async () => {
    await request(app.getHttpServer())
      .get(`/api/profile/${alice.id}/friends`)
      .set(auth(carol.accessToken))
      .expect(404);
  });

  it('REGRESSION: search by email does NOT return the user (email search removed)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/profile/search')
      .query({ q: pub.email })
      .set(auth(carol.accessToken))
      .expect(200);
    expect(res.body.items.some((u: { id: string }) => u.id === pub.id)).toBe(false);
  });

  it('search by name still returns public users', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/profile/search')
      .query({ q: uniqueName })
      .set(auth(carol.accessToken))
      .expect(200);
    expect(res.body.items.some((u: { id: string }) => u.id === pub.id)).toBe(true);
  });

  it('search never returns a private user (even by name)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/profile/search')
      .query({ q: 'Alice' })
      .set(auth(carol.accessToken))
      .expect(200);
    expect(res.body.items.some((u: { id: string }) => u.id === alice.id)).toBe(false);
  });
});
