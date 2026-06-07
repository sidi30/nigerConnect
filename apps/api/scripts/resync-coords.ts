/**
 * One-off maintenance: re-sync map coordinates with the user's stated city.
 *
 * Background: the mobile map used to persist a live GPS fix into users.latitude/
 * longitude on every open, overwriting the city-centroid coordinates set at
 * registration. Result: a user who declared "Barcelona, ES" but opened the app
 * from France got plotted in France, and the country cluster for ES was placed
 * there too. The client guard (persistMyPosition skips when a city is set) stops
 * NEW drift; this script repairs EXISTING rows.
 *
 * What it does: for every user who has BOTH a city and a country_code, recompute
 * the city centroid and, IF the stored point sits more than THRESHOLD_KM away
 * (i.e. it was GPS-polluted) or is missing, reset lat/lon to the centroid (with
 * the standard privacy jitter). Users already near their city are left untouched.
 *
 * Standalone (no Nest context) so it can run against any database via DATABASE_URL
 * — e.g. through an SSH tunnel to prod:
 *   ssh -L 15432:nigerconnect-postgres:5432 root@<vps>      # in another shell
 *   DATABASE_URL=postgresql://USER:PASS@localhost:15432/nigerconnect \
 *     npx ts-node --transpile-only scripts/resync-coords.ts
 * Idempotent — safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import { WorldCitiesService } from '../src/geo/world-cities';
import {
  geocode,
  haversineKm,
  jitterCoord,
  setWorldCitiesLookup,
} from '../src/common/geo/city-coords';

const THRESHOLD_KM = 50;

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  // Wire the world-cities lookup into the geocoder exactly as GeoService does at
  // module init, so geocode() resolves worldwide cities (not just the curated
  // diaspora centroids).
  const worldCities = new WorldCitiesService();
  worldCities.onModuleInit();
  setWorldCitiesLookup((city, countryCode) => {
    const hit = worldCities.findOne(city, countryCode);
    return hit ? { lat: hit.lat, lon: hit.lng } : null;
  });

  try {
    const users = await prisma.user.findMany({
      where: { city: { not: null }, countryCode: { not: null } },
      select: { id: true, city: true, countryCode: true, latitude: true, longitude: true },
    });

    let fixed = 0;
    let skipped = 0;
    for (const u of users) {
      const centroid = geocode(u.city, u.countryCode);
      if (!centroid) {
        skipped++;
        continue;
      }
      const hasCoords = u.latitude !== null && u.longitude !== null;
      const distance = hasCoords
        ? haversineKm({ lat: Number(u.latitude), lon: Number(u.longitude) }, centroid)
        : Infinity;
      if (hasCoords && distance <= THRESHOLD_KM) {
        skipped++;
        continue; // already near their declared city — leave as-is
      }
      const jit = jitterCoord(centroid);
      await prisma.user.update({
        where: { id: u.id },
        data: { latitude: jit.lat, longitude: jit.lon },
      });
      fixed++;
      // eslint-disable-next-line no-console
      console.log(
        `fixed ${u.id} (${u.city}, ${u.countryCode}) — was ${
          hasCoords ? `${distance.toFixed(0)}km off` : 'no coords'
        }`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`\nresync complete: ${fixed} fixed, ${skipped} already correct/skipped`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
