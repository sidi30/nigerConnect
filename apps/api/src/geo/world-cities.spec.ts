import { WorldCitiesService } from './world-cities';

/**
 * Country fallback: a member who gave us a country but no resolvable city must
 * still land on the map. Before this existed, COUNTRY_CENTERS held 16 entries
 * and everyone else simply vanished — a real member in Russia was off-map.
 */
describe('WorldCitiesService.largestCityOf', () => {
  let svc: WorldCitiesService;

  beforeAll(async () => {
    svc = new WorldCitiesService();
    await svc.onModuleInit();
  });

  it.each(['RU', 'IN', 'BE', 'DZ', 'CH', 'FR', 'NE'])(
    'places %s, including countries absent from the hardcoded table',
    (code) => {
      const hit = svc.largestCityOf(code);
      expect(hit).not.toBeNull();
      expect(hit!.countryCode).toBe(code);
      expect(Math.abs(hit!.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(hit!.lng)).toBeLessThanOrEqual(180);
    },
  );

  it('returns the MOST populated city, not just any city of the country', () => {
    const fr = svc.largestCityOf('FR')!;
    // Paris dwarfs every other French city; whatever the dataset's exact
    // figures, the winner must be the largest it knows about.
    const anyOther = svc.search('Lyon', 'FR', 1)[0];
    if (anyOther) expect(fr.population).toBeGreaterThanOrEqual(anyOther.population);
  });

  it('is case-insensitive and returns null for an unknown code', () => {
    expect(svc.largestCityOf('fr')).not.toBeNull();
    expect(svc.largestCityOf('ZZ')).toBeNull();
  });
});
