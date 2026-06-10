import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { bootApp, register, cleanupTestData, type RegisteredUser } from './helpers';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: RegisteredUser; // actor
  let bob: RegisteredUser; // recipient
  let carol: RegisteredUser; // unrelated

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    alice = await register(app, { firstName: 'Alice', lastName: 'Notify' });
    bob = await register(app, { firstName: 'Bob', lastName: 'Notify' });
    carol = await register(app, { firstName: 'Carol', lastName: 'Notify' });
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('a friend request to B produces a notification row for B', async () => {
    // Alice sends Bob a friend request -> friend_request notification for Bob.
    await request(app.getHttpServer())
      .post(`/api/friends/request/${bob.id}`)
      .set(auth(alice.accessToken))
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(auth(bob.accessToken))
      .expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    const notif = list.body.items[0];
    expect(notif.type).toBe('friend_request');

    const count = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set(auth(bob.accessToken))
      .expect(200);
    expect(count.body.count).toBeGreaterThan(0);
  });

  it('B can mark a notification read, then read-all zeroes the count', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(auth(bob.accessToken))
      .expect(200);
    const id = list.body.items[0].id;

    // markRead is an updateMany scoped to (id, userId) -> returns a Prisma
    // batch payload { count }. One row matched for the owner.
    const marked = await request(app.getHttpServer())
      .patch(`/api/notifications/${id}/read`)
      .set(auth(bob.accessToken))
      .expect(200);
    expect(marked.body.count).toBe(1);

    await request(app.getHttpServer())
      .patch('/api/notifications/read-all')
      .set(auth(bob.accessToken))
      .expect(200);

    const count = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set(auth(bob.accessToken))
      .expect(200);
    expect(count.body.count).toBe(0);
  });

  it("SCOPING: user C marking B's notification has no effect (0 rows updated; stays unread for B)", async () => {
    // Create a fresh unread notification for Bob.
    await request(app.getHttpServer())
      .post(`/api/friends/request/${bob.id}`)
      .set(auth(carol.accessToken))
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(auth(bob.accessToken))
      .expect(200);
    const bobNotif = list.body.items.find((n: { read: boolean }) => n.read === false);
    expect(bobNotif).toBeDefined();
    const bobNotifId = bobNotif.id;

    // Carol attempts to mark Bob's notification read. The route is an
    // updateMany scoped to (id, userId=carol), so it matches 0 rows: the call
    // returns 200 with { count: 0 } and Bob's notification is untouched.
    const res = await request(app.getHttpServer())
      .patch(`/api/notifications/${bobNotifId}/read`)
      .set(auth(carol.accessToken))
      .expect(200);
    expect(res.body.count).toBe(0);

    // Confirm it is still unread for Bob.
    const after = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(auth(bob.accessToken))
      .expect(200);
    const still = after.body.items.find((n: { id: string }) => n.id === bobNotifId);
    expect(still.read).toBe(false);
  });
});
