import { SettingsService } from './settings.service';

/**
 * The "admin full visibility" override auto-expires. These tests pin the
 * security-critical gate: an enabled-but-expired (or expiry-less) override must
 * read as OFF, and only an admin role gets it.
 */
function makeService(values: Record<string, string>) {
  const svc = new SettingsService({} as never, {} as never);
  jest
    .spyOn(svc, 'getSetting')
    .mockImplementation(async (key: string, def: string) => values[key] ?? def);
  return svc;
}

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

describe('SettingsService — admin full-visibility expiry gate', () => {
  it('ON + future expiry → active', async () => {
    const svc = makeService({ admin_full_visibility: 'true', admin_full_visibility_until: future });
    expect(await svc.isFullVisibilityActive()).toBe(true);
    expect(await svc.isAdminFullVisibility('admin')).toBe(true);
  });

  it('ON + PAST expiry → inactive (auto-expired)', async () => {
    const svc = makeService({ admin_full_visibility: 'true', admin_full_visibility_until: past });
    expect(await svc.isFullVisibilityActive()).toBe(false);
    expect(await svc.isAdminFullVisibility('admin')).toBe(false);
  });

  it('ON but NO expiry → inactive (fail-closed)', async () => {
    const svc = makeService({ admin_full_visibility: 'true' });
    expect(await svc.isFullVisibilityActive()).toBe(false);
  });

  it('OFF → inactive regardless of expiry', async () => {
    const svc = makeService({ admin_full_visibility: 'false', admin_full_visibility_until: future });
    expect(await svc.isFullVisibilityActive()).toBe(false);
  });

  it('non-admin never gets the override even when active', async () => {
    const svc = makeService({ admin_full_visibility: 'true', admin_full_visibility_until: future });
    expect(await svc.isAdminFullVisibility('moderator')).toBe(false);
    expect(await svc.isAdminFullVisibility('user')).toBe(false);
    expect(await svc.isAdminFullVisibility(undefined)).toBe(false);
  });

  it('fullVisibilityUntil returns the timestamp only when active', async () => {
    expect(
      await makeService({
        admin_full_visibility: 'true',
        admin_full_visibility_until: future,
      }).fullVisibilityUntil(),
    ).toBe(future);
    expect(
      await makeService({
        admin_full_visibility: 'true',
        admin_full_visibility_until: past,
      }).fullVisibilityUntil(),
    ).toBeNull();
  });
});

describe('SettingsService — proximity kill-switch + city allowlist', () => {
  it('proximity disabled by default (fail-closed, ships DARK)', async () => {
    expect(await makeService({}).isProximityEnabled()).toBe(false);
    expect(await makeService({ proximity_enabled: 'false' }).isProximityEnabled()).toBe(false);
  });

  it('proximity enabled only when explicitly true', async () => {
    expect(await makeService({ proximity_enabled: 'true' }).isProximityEnabled()).toBe(true);
  });

  it('no allowlist (city or country) → everyone allowed', async () => {
    const svc = makeService({});
    expect(await svc.isProximityRegionAllowed('Niamey', 'NE')).toBe(true);
    expect(await svc.isProximityRegionAllowed(null, null)).toBe(true);
  });

  it('city allowlist filters case-insensitively', async () => {
    const svc = makeService({ proximity_cities: 'Niamey' });
    expect(await svc.isProximityRegionAllowed('niamey', 'NE')).toBe(true);
    expect(await svc.isProximityRegionAllowed('Agadez', 'NE')).toBe(false);
  });

  it('country allowlist matches by countryCode (e.g. all of France)', async () => {
    const svc = makeService({ proximity_countries: 'FR' });
    expect(await svc.isProximityRegionAllowed('Paris', 'fr')).toBe(true);
    expect(await svc.isProximityRegionAllowed('Lyon', 'FR')).toBe(true);
    expect(await svc.isProximityRegionAllowed('Niamey', 'NE')).toBe(false);
  });

  it('city OR country: Niamey city + all of FR', async () => {
    const svc = makeService({ proximity_cities: 'Niamey', proximity_countries: 'FR' });
    expect(await svc.isProximityRegionAllowed('Niamey', 'NE')).toBe(true); // city match
    expect(await svc.isProximityRegionAllowed('Marseille', 'FR')).toBe(true); // country match
    expect(await svc.isProximityRegionAllowed('Agadez', 'NE')).toBe(false); // neither
  });

  it('allowlist set but user has no city/country → not allowed (fail-closed)', async () => {
    const svc = makeService({ proximity_cities: 'Niamey' });
    expect(await svc.isProximityRegionAllowed(null, null)).toBe(false);
  });
});
