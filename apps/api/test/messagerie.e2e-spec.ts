import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { bootApp, register, cleanupTestData, type RegisteredUser } from './helpers';

describe('Messagerie (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let carol: RegisteredUser;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    alice = await register(app, { firstName: 'Alice', lastName: 'Chat' });
    bob = await register(app, { firstName: 'Bob', lastName: 'Chat' });
    carol = await register(app, { firstName: 'Carol', lastName: 'Chat' });
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createConv(token: string, participantIds: string[]): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/conversations')
      .set(auth(token))
      .send({ participantIds })
      .expect(201);
    return res.body.id;
  }

  it('HAPPY: A creates conv, sends message, B reads it and marks read', async () => {
    const convId = await createConv(alice.accessToken, [bob.id]);

    const sent = await request(app.getHttpServer())
      .post(`/api/conversations/${convId}/messages`)
      .set(auth(alice.accessToken))
      .send({ content: 'hi bob' })
      .expect(201);
    expect(sent.body.id).toBeDefined();
    expect(sent.body.content).toBe('hi bob');

    const list = await request(app.getHttpServer())
      .get(`/api/conversations/${convId}/messages`)
      .set(auth(bob.accessToken))
      .expect(200);
    expect(list.body.items.some((m: { id: string }) => m.id === sent.body.id)).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/conversations/${convId}/read`)
      .set(auth(bob.accessToken))
      .expect(204);
  });

  it('REGRESSION: replyToId pointing at a message in a DIFFERENT conversation -> 400', async () => {
    const conv1 = await createConv(alice.accessToken, [bob.id]);
    const m1 = await request(app.getHttpServer())
      .post(`/api/conversations/${conv1}/messages`)
      .set(auth(alice.accessToken))
      .send({ content: 'message one' })
      .expect(201);

    const conv2 = await createConv(alice.accessToken, [carol.id]);
    await request(app.getHttpServer())
      .post(`/api/conversations/${conv2}/messages`)
      .set(auth(alice.accessToken))
      .send({ content: 'cross-thread reply', replyToId: m1.body.id })
      .expect(400);
  });

  it('AUTHZ: a non-participant cannot list messages -> 403', async () => {
    const convId = await createConv(alice.accessToken, [bob.id]);
    await request(app.getHttpServer())
      .get(`/api/conversations/${convId}/messages`)
      .set(auth(carol.accessToken))
      .expect(403);
  });

  it('AUTHZ: a non-participant cannot send a message -> 403', async () => {
    const convId = await createConv(alice.accessToken, [bob.id]);
    await request(app.getHttpServer())
      .post(`/api/conversations/${convId}/messages`)
      .set(auth(carol.accessToken))
      .send({ content: 'intruder' })
      .expect(403);
  });

  it('BLOCK: if A blocks B, B cannot create a NEW conversation with A -> 403', async () => {
    // fresh pair so other tests are unaffected
    const a2 = await register(app, { firstName: 'Ann', lastName: 'Block' });
    const b2 = await register(app, { firstName: 'Ben', lastName: 'Block' });

    // POST /blocks/:id is @HttpCode(204).
    await request(app.getHttpServer())
      .post(`/api/blocks/${b2.id}`)
      .set(auth(a2.accessToken))
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/conversations')
      .set(auth(b2.accessToken))
      .send({ participantIds: [a2.id] })
      .expect(403);
  });

  it('BLOCK: an EXISTING direct conversation cannot continue across a block -> 403', async () => {
    const a3 = await register(app, { firstName: 'Amy', lastName: 'Block' });
    const b3 = await register(app, { firstName: 'Bo', lastName: 'Block' });

    const convId = await createConv(a3.accessToken, [b3.id]);
    // both can talk before the block
    await request(app.getHttpServer())
      .post(`/api/conversations/${convId}/messages`)
      .set(auth(b3.accessToken))
      .send({ content: 'before block' })
      .expect(201);

    // a3 blocks b3 (POST /blocks/:id is @HttpCode(204))
    await request(app.getHttpServer())
      .post(`/api/blocks/${b3.id}`)
      .set(auth(a3.accessToken))
      .expect(204);

    // b3 can no longer message a3 in the pre-existing conversation
    await request(app.getHttpServer())
      .post(`/api/conversations/${convId}/messages`)
      .set(auth(b3.accessToken))
      .send({ content: 'after block' })
      .expect(403);
  });
});
