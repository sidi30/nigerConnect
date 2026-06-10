import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { bootApp, register, uploadImage, presignOnly, cleanupTestData, itUpload, type RegisteredUser } from './helpers';

describe('Publication / feed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  const createdAssociationIds: string[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    alice = await register(app, { firstName: 'Alice', lastName: 'Publisher' });
    bob = await register(app, { firstName: 'Bob', lastName: 'Reader' });
  });

  afterAll(async () => {
    if (createdAssociationIds.length) {
      await prisma.association.deleteMany({ where: { id: { in: createdAssociationIds } } });
    }
    await cleanupTestData(prisma);
    await app.close();
  });

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it('HAPPY: create public post (no media) -> appears in author feed', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'Hello public world', visibility: 'public' })
      .expect(201);
    expect(created.body.id).toBeDefined();
    expect(created.body.visibility).toBe('public');

    const feed = await request(app.getHttpServer())
      .get('/api/feed')
      .set(auth(alice.accessToken))
      .expect(200);
    expect(feed.body.items.some((p: { id: string }) => p.id === created.body.id)).toBe(true);
  });

  // Real upload round-trips through MinIO: presign -> PUT bytes -> attach the
  // returned URL, which assertOwnedPublicImage HEAD-validates server-side.
  itUpload('HAPPY: create post WITH uploaded image -> media URL is canonical', async () => {
    const publicUrl = await uploadImage(app, alice.accessToken, 'photo');
    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({
        content: 'with media',
        visibility: 'public',
        media: [{ mediaUrl: publicUrl, mediaType: 'image' }],
      })
      .expect(201);
    expect(created.body.media).toHaveLength(1);
    expect(created.body.media[0].mediaUrl).toBe(publicUrl);
    expect(created.body.media[0].mediaUrl).toContain('http://localhost:9000/nigerconnect/');
  });

  it('REGRESSION (fixed bug): post with a media url whose object was never uploaded -> 400', async () => {
    // assertOwnedPublicImage HEADs the object; no bytes exist -> 400.
    const { publicUrl } = await presignOnly(app, alice.accessToken, 'photo');
    await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({
        content: 'with media',
        visibility: 'public',
        media: [{ mediaUrl: publicUrl, mediaType: 'image' }],
      })
      .expect(400);
  });

  it('REGRESSION (fixed bug): post with a FOREIGN media url -> 400', async () => {
    await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({
        content: 'evil',
        visibility: 'public',
        media: [{ mediaUrl: 'https://evil.tld/x.png', mediaType: 'image' }],
      })
      .expect(400);
  });

  it('REGRESSION (CRITICAL): association post for an association you are NOT an approved member of -> 403', async () => {
    const assoc = await prisma.association.create({
      data: { name: `u_assoc_${randomUUID()}`, category: 'generaliste' },
    });
    createdAssociationIds.push(assoc.id);

    // Alice is not a member at all.
    await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'secret', visibility: 'association', associationId: assoc.id })
      .expect(403);

    // Pending (not approved) membership is still rejected.
    await prisma.associationMember.create({
      data: { associationId: assoc.id, userId: alice.id, status: 'pending', role: 'member' },
    });
    await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'secret2', visibility: 'association', associationId: assoc.id })
      .expect(403);
  });

  it('REGRESSION: a random/foreign associationId -> 403', async () => {
    await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'x', visibility: 'association', associationId: randomUUID() })
      .expect(403);
  });

  it('REGRESSION: association post with NO associationId -> 400', async () => {
    await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'x', visibility: 'association' })
      .expect(400);
  });

  it('HAPPY: approved member CAN create an association post', async () => {
    const assoc = await prisma.association.create({
      data: { name: `u_assoc_${randomUUID()}`, category: 'generaliste' },
    });
    createdAssociationIds.push(assoc.id);
    await prisma.associationMember.create({
      data: { associationId: assoc.id, userId: alice.id, status: 'approved', role: 'member' },
    });
    await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'members only', visibility: 'association', associationId: assoc.id })
      .expect(201);
  });

  it('REGRESSION: sharing a non-public (friends-only) post -> 403', async () => {
    const friendsPost = await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'friends only', visibility: 'friends' })
      .expect(201);

    // Author shares their own friends-only post — only public posts can be shared.
    await request(app.getHttpServer())
      .post(`/api/posts/${friendsPost.body.id}/share`)
      .set(auth(alice.accessToken))
      .send({ content: 'reshare' })
      .expect(403);
  });

  it('HAPPY: sharing a public post works', async () => {
    const publicPost = await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'shareable', visibility: 'public' })
      .expect(201);
    const shared = await request(app.getHttpServer())
      .post(`/api/posts/${publicPost.body.id}/share`)
      .set(auth(alice.accessToken))
      .send({ content: 'reshare' })
      .expect(201);
    expect(shared.body.sharedPostId).toBe(publicPost.body.id);
  });

  it('AUTHZ: user B cannot edit user A post -> 403', async () => {
    const post = await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'mine', visibility: 'public' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/posts/${post.body.id}`)
      .set(auth(bob.accessToken))
      .send({ content: 'hijacked' })
      .expect(403);
  });

  it('AUTHZ: user B cannot delete user A post -> 403', async () => {
    const post = await request(app.getHttpServer())
      .post('/api/posts')
      .set(auth(alice.accessToken))
      .send({ content: 'mine too', visibility: 'public' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/posts/${post.body.id}`)
      .set(auth(bob.accessToken))
      .expect(403);
  });
});
