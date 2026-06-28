import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { bootApp, register, cleanupTestData, type RegisteredUser } from './helpers';

/**
 * Real-HTTP e2e for the proximity-alerts feature.
 *
 * Each test uses a FRESH pair of users so the per-(direction, zone) Redis dedup
 * key (`prox:seen:<pinger>:<candidate>:<geohash>`, 8 h TTL) from one test never
 * bleeds into another. Coordinates: "near" users sit a few metres apart; "far"
 * users sit on different continents. proximityRadius is pinned to 1000 m for
 * near tests so GPS-scale spacing always falls inside the radius.
 */
describe('Proximity alerts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Niamey, Niger — base point for "near" users.
  const NEAR_A = { latitude: 13.51366, longitude: 2.1098 };
  // ~30 m east of NEAR_A (0.0003° lon ≈ 32 m at this latitude).
  const NEAR_B = { latitude: 13.51366, longitude: 2.1101 };
  // Buenos Aires, Argentina — other side of the planet.
  const FAR = { latitude: -34.6037, longitude: -58.3816 };

  const ALLOWED_BUCKETS = [50, 100, 500, 1000];

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Opt a user into proximity at a given location. */
  async function setUp(
    user: RegisteredUser,
    coords: { latitude: number; longitude: number },
    opts: { proximityAlerts?: boolean; showOnMap?: boolean } = {},
  ): Promise<void> {
    await request(app.getHttpServer())
      .patch('/api/profile/me')
      .set(auth(user.accessToken))
      .send({
        latitude: coords.latitude,
        longitude: coords.longitude,
        proximityAlerts: opts.proximityAlerts ?? true,
        proximityRadius: 1000,
        showOnMap: opts.showOnMap ?? true,
      })
      .expect(200);
  }

  async function ping(
    user: RegisteredUser,
    coords: { latitude: number; longitude: number },
  ): Promise<{ matches: Array<{ userId: string; name: string | null; avatarUrl: string | null; distance: number }> }> {
    const res = await request(app.getHttpServer())
      .post('/api/geo/proximity/ping')
      .set(auth(user.accessToken))
      .send({ lat: coords.latitude, lon: coords.longitude })
      // Ping is an action returning matches → 200 (endpoint sets @HttpCode(200)).
      .expect(200);
    return res.body;
  }

  async function proximityNotifs(user: RegisteredUser) {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(auth(user.accessToken))
      .expect(200);
    return (res.body.items as Array<{ type: string }>).filter((n) => n.type === 'proximity');
  }

  it('1. HAPPY: A and B both opted in + map-visible and near → A ping returns B with a bucketed distance', async () => {
    const a = await register(app, { firstName: 'Amadou', lastName: 'Near' });
    const b = await register(app, { firstName: 'Binta', lastName: 'Near' });
    await setUp(a, NEAR_A);
    await setUp(b, NEAR_B);

    const { matches } = await ping(a, NEAR_A);

    const hit = matches.find((m) => m.userId === b.id);
    expect(hit).toBeDefined();
    expect(ALLOWED_BUCKETS).toContain(hit!.distance);
  });

  it('2. PRIVACY: B has proximityAlerts=false → not returned to A and B gets no proximity notification', async () => {
    const a = await register(app, { firstName: 'Adam', lastName: 'OptOut' });
    const b = await register(app, { firstName: 'Bako', lastName: 'OptOut' });
    await setUp(a, NEAR_A);
    await setUp(b, NEAR_B, { proximityAlerts: false });

    const { matches } = await ping(a, NEAR_A);
    expect(matches.find((m) => m.userId === b.id)).toBeUndefined();

    expect(await proximityNotifs(b)).toHaveLength(0);
  });

  it('3. PRIVACY: B opted in but showOnMap=false → not returned to A', async () => {
    const a = await register(app, { firstName: 'Ali', lastName: 'Hidden' });
    const b = await register(app, { firstName: 'Bibata', lastName: 'Hidden' });
    await setUp(a, NEAR_A);
    await setUp(b, NEAR_B, { showOnMap: false });

    const { matches } = await ping(a, NEAR_A);
    expect(matches.find((m) => m.userId === b.id)).toBeUndefined();
    expect(await proximityNotifs(b)).toHaveLength(0);
  });

  it('4. PINGER GATING: A has proximityAlerts=false → ping returns empty matches', async () => {
    const a = await register(app, { firstName: 'Abdou', lastName: 'PingerOff' });
    const b = await register(app, { firstName: 'Balki', lastName: 'PingerOff' });
    await setUp(a, NEAR_A, { proximityAlerts: false });
    await setUp(b, NEAR_B);

    const { matches } = await ping(a, NEAR_A);
    expect(matches).toEqual([]);
  });

  it('5. PINGER GATING: A opted in but showOnMap=false → ping returns empty matches', async () => {
    const a = await register(app, { firstName: 'Issa', lastName: 'PingerHidden' });
    const b = await register(app, { firstName: 'Bori', lastName: 'PingerHidden' });
    await setUp(a, NEAR_A, { showOnMap: false });
    await setUp(b, NEAR_B);

    const { matches } = await ping(a, NEAR_A);
    expect(matches).toEqual([]);
  });

  it('6. BLOCK: A blocked B → A ping does not return B', async () => {
    const a = await register(app, { firstName: 'Moussa', lastName: 'Block' });
    const b = await register(app, { firstName: 'Bana', lastName: 'Block' });
    await setUp(a, NEAR_A);
    await setUp(b, NEAR_B);

    await request(app.getHttpServer())
      .post(`/api/blocks/${b.id}`)
      .set(auth(a.accessToken))
      .expect(204);

    const { matches } = await ping(a, NEAR_A);
    expect(matches.find((m) => m.userId === b.id)).toBeUndefined();
  });

  it('7. ZONE DEDUP: A pings twice in the same zone near B → exactly one notification; the deduped second ping omits B from matches', async () => {
    const a = await register(app, { firstName: 'Halima', lastName: 'Cool' });
    const b = await register(app, { firstName: 'Boubacar', lastName: 'Cool' });
    await setUp(a, NEAR_A);
    await setUp(b, NEAR_B);

    const first = await ping(a, NEAR_A);
    expect(first.matches.find((m) => m.userId === b.id)).toBeDefined();

    // Same geohash cell within the dedup window → no re-notify, and the match is
    // omitted so the pinger's heads-up only ever reflects a NEW encounter.
    const second = await ping(a, NEAR_A);
    expect(second.matches.find((m) => m.userId === b.id)).toBeUndefined();

    const notifs = await proximityNotifs(b);
    expect(notifs).toHaveLength(1);
  });

  it('8. RADIUS: B on another continent → not in matches', async () => {
    const a = await register(app, { firstName: 'Salif', lastName: 'Far' });
    const b = await register(app, { firstName: 'Bintou', lastName: 'Far' });
    await setUp(a, NEAR_A);
    await setUp(b, FAR);

    const { matches } = await ping(a, NEAR_A);
    expect(matches.find((m) => m.userId === b.id)).toBeUndefined();
  });

  it('9. PROFILE LEAK: GET /profile/:bId as A exposes no latitude/longitude', async () => {
    const a = await register(app, { firstName: 'Oumar', lastName: 'Leak' });
    const b = await register(app, { firstName: 'Bibi', lastName: 'Leak' });
    await setUp(a, NEAR_A);
    await setUp(b, NEAR_B);

    const res = await request(app.getHttpServer())
      .get(`/api/profile/${b.id}`)
      .set(auth(a.accessToken))
      .expect(200);

    expect(res.body.user.latitude).toBeUndefined();
    expect(res.body.user.longitude).toBeUndefined();
  });

  it('10. PRIVACY: B is private → excluded from A matches and gets no notification, even map-visible + opted in', async () => {
    const a = await register(app, { firstName: 'Karim', lastName: 'Priv' });
    const b = await register(app, { firstName: 'Bina', lastName: 'Priv' });
    await setUp(a, NEAR_A);
    await setUp(b, NEAR_B);
    // B keeps proximityAlerts + showOnMap on but flips the profile to private:
    // discovery must hide them everywhere, proximity included.
    await request(app.getHttpServer())
      .patch('/api/profile/me')
      .set(auth(b.accessToken))
      .send({ privacyLevel: 'private' })
      .expect(200);

    const { matches } = await ping(a, NEAR_A);
    expect(matches.find((m) => m.userId === b.id)).toBeUndefined();
    expect(await proximityNotifs(b)).toHaveLength(0);
  });

  it('11. PRIVACY: a private PINGER neither broadcasts nor reveals itself', async () => {
    const a = await register(app, { firstName: 'Laila', lastName: 'PrivPing' });
    const b = await register(app, { firstName: 'Boss', lastName: 'PrivPing' });
    await setUp(a, NEAR_A);
    await setUp(b, NEAR_B);
    await request(app.getHttpServer())
      .patch('/api/profile/me')
      .set(auth(a.accessToken))
      .send({ privacyLevel: 'private' })
      .expect(200);

    const { matches } = await ping(a, NEAR_A);
    expect(matches).toEqual([]);
    expect(await proximityNotifs(b)).toHaveLength(0);
  });
});
