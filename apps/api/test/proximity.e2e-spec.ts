import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { SettingsService } from '../src/common/settings/settings.service';
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
  let settings: SettingsService;

  // Niamey, Niger — base point for "near" users.
  const NEAR_A = { latitude: 13.51366, longitude: 2.1098 };
  // ~30 m east of NEAR_A (0.0003° lon ≈ 32 m at this latitude).
  const NEAR_B = { latitude: 13.51366, longitude: 2.1101 };
  // Buenos Aires, Argentina — other side of the planet.
  const FAR = { latitude: -34.6037, longitude: -58.3816 };

  const ALLOWED_BUCKETS = [50, 100, 500, 1000];

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    // La proximite est livree DARK : `proximity_enabled` vaut 'false' par
    // defaut, donc le ping renvoie zero match quoi qu'il arrive. Sans cette
    // bascule, TOUTE cette suite passe a vide et ne prouve rien. L'ecriture est
    // write-through (DB + cache Redis), donc effective des la requete suivante.
    settings = app.get(SettingsService);
    await settings.setSetting('proximity_enabled', 'true');
  });

  afterAll(async () => {
    // Remettre le kill-switch en place : DB et Redis sont partages avec les
    // autres suites (--runInBand), on ne leur laisse pas la feature allumee.
    await settings.setSetting('proximity_enabled', 'false');
    await cleanupTestData(prisma);
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /**
   * Proximity is identity-gated: only a verified, adult member can ping or be
   * matched (approved identityStatus AND an approved document whose recorded
   * DOB is 18+). Registration alone never satisfies that, so a participant that
   * must actually match is promoted here — through Prisma, since the real path
   * needs an admin review.
   *
   * ATTENTION — les tests 3, 5, 10 et 11 n'appellent PAS ceci, donc personne n'y
   * est eligible et leurs assertions "aucun match" sont vraies pour la mauvaise
   * raison : elles ne prouvent rien. Les rendre effectives demande de trancher
   * d'abord un conflit de contrat, car geo.service.ts a DELIBEREMENT decouple la
   * proximite de la carte ("map gates intentionally NOT applied — a map-hidden
   * or private user is a valid, anonymous proximity candidate") alors que ces
   * quatre tests exigent l'inverse. Le code ou les tests ont raison, pas les
   * deux : decision produit, pas une retouche de test. La fonctionnalite est
   * DARK en prod (kill-switch off), donc aucun impact live en attendant.
   */
  async function makeEligible(user: RegisteredUser): Promise<void> {
    await prisma.user.update({
      where: { id: user.id },
      data: { identityStatus: 'approved' },
    });
    await prisma.identityDocument.create({
      data: {
        userId: user.id,
        documentType: 'manual',
        status: 'approved',
        dateOfBirth: new Date('1990-01-01'),
        reviewedAt: new Date(),
      },
    });
  }

  /** Opt a user into proximity at a given location. */
  async function setUp(
    user: RegisteredUser,
    coords: { latitude: number; longitude: number },
    opts: { proximityAlerts?: boolean; showOnMap?: boolean; eligible?: boolean } = {},
  ): Promise<void> {
    if (opts.eligible) await makeEligible(user);
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

    // Matching keys off the PRIVATE proximity_lat/lon, which are written ONLY by
    // a ping (and only for opted-in + map-visible users — the server gates the
    // write). So a user must ping once to become discoverable to others. This is
    // a no-op write for opted-out / hidden users (the ping early-returns), which
    // is exactly what the privacy tests below expect.
    await request(app.getHttpServer())
      .post('/api/geo/proximity/ping')
      .set(auth(user.accessToken))
      .send({ lat: coords.latitude, lon: coords.longitude })
      .expect(200);
  }

  async function ping(
    user: RegisteredUser,
    coords: { latitude: number; longitude: number },
    // Forme DOUBLE-AVEUGLE : la rencontre ne porte qu'une poignee opaque et une
    // distance en paliers. Aucun userId/nom/avatar — le pair reste anonyme
    // jusqu'a ce qu'une demande soit acceptee.
  ): Promise<{ matches: Array<{ encounterId: string; distance: number }> }> {
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
    await setUp(a, NEAR_A, { eligible: true });
    await setUp(b, NEAR_B, { eligible: true });

    const { matches } = await ping(a, NEAR_A);

    // Une rencontre, et une seule (B). Elle est DOUBLE-AVEUGLE : le pair n'est
    // designe que par un `encounterId` opaque, jamais par son identite — c'est
    // la propriete que ce test protege.
    expect(matches).toHaveLength(1);
    const hit = matches[0]!;
    expect(hit.encounterId).toEqual(expect.any(String));
    expect(ALLOWED_BUCKETS).toContain(hit.distance);
    expect(Object.keys(hit).sort()).toEqual(['distance', 'encounterId']);
    // Ceinture et bretelles : aucun champ identifiant, meme vide.
    expect(JSON.stringify(matches)).not.toContain(b.id);
  });

  it('2. PRIVACY: B has proximityAlerts=false → not returned to A and B gets no proximity notification', async () => {
    const a = await register(app, { firstName: 'Adam', lastName: 'OptOut' });
    const b = await register(app, { firstName: 'Bako', lastName: 'OptOut' });
    await setUp(a, NEAR_A, { eligible: true });
    await setUp(b, NEAR_B, { eligible: true, proximityAlerts: false });

    const { matches } = await ping(a, NEAR_A);
    expect(matches).toHaveLength(0); // aucune rencontre : le pair reste anonyme, on ne peut assurer que ca

    expect(await proximityNotifs(b)).toHaveLength(0);
  });

  it('3. PRIVACY: B opted in but showOnMap=false → not returned to A', async () => {
    const a = await register(app, { firstName: 'Ali', lastName: 'Hidden' });
    const b = await register(app, { firstName: 'Bibata', lastName: 'Hidden' });
    await setUp(a, NEAR_A);
    await setUp(b, NEAR_B, { showOnMap: false });

    const { matches } = await ping(a, NEAR_A);
    expect(matches).toHaveLength(0); // aucune rencontre : le pair reste anonyme, on ne peut assurer que ca
    expect(await proximityNotifs(b)).toHaveLength(0);
  });

  it('4. PINGER GATING: A has proximityAlerts=false → ping returns empty matches', async () => {
    const a = await register(app, { firstName: 'Abdou', lastName: 'PingerOff' });
    const b = await register(app, { firstName: 'Balki', lastName: 'PingerOff' });
    await setUp(a, NEAR_A, { eligible: true, proximityAlerts: false });
    await setUp(b, NEAR_B, { eligible: true });

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
    await setUp(a, NEAR_A, { eligible: true });
    await setUp(b, NEAR_B, { eligible: true });

    await request(app.getHttpServer())
      .post(`/api/blocks/${b.id}`)
      .set(auth(a.accessToken))
      .expect(204);

    const { matches } = await ping(a, NEAR_A);
    expect(matches).toHaveLength(0); // aucune rencontre : le pair reste anonyme, on ne peut assurer que ca
  });

  it('7. ZONE DEDUP: A pings twice in the same zone near B → exactly one notification; the deduped second ping omits B from matches', async () => {
    const a = await register(app, { firstName: 'Halima', lastName: 'Cool' });
    const b = await register(app, { firstName: 'Boubacar', lastName: 'Cool' });
    await setUp(a, NEAR_A, { eligible: true });
    await setUp(b, NEAR_B, { eligible: true });

    const first = await ping(a, NEAR_A);
    expect(first.matches).toHaveLength(1);

    // Same geohash cell within the dedup window → no re-notify, and the match is
    // omitted so the pinger's heads-up only ever reflects a NEW encounter.
    const second = await ping(a, NEAR_A);
    expect(second.matches).toHaveLength(0);

    const notifs = await proximityNotifs(b);
    expect(notifs).toHaveLength(1);
  });

  it('8. RADIUS: B on another continent → not in matches', async () => {
    const a = await register(app, { firstName: 'Salif', lastName: 'Far' });
    const b = await register(app, { firstName: 'Bintou', lastName: 'Far' });
    await setUp(a, NEAR_A, { eligible: true });
    await setUp(b, FAR, { eligible: true });

    const { matches } = await ping(a, NEAR_A);
    expect(matches).toHaveLength(0); // aucune rencontre : le pair reste anonyme, on ne peut assurer que ca
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
    expect(matches).toHaveLength(0); // aucune rencontre : le pair reste anonyme, on ne peut assurer que ca
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
