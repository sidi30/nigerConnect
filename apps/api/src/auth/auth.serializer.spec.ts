import { serializeUser } from './auth.serializer';

describe('serializeUser', () => {
  it('strips sensitive fields', () => {
    const result = serializeUser({
      id: 'u1',
      email: 'a@b.com',
      passwordHash: 'secret',
      mfaSecret: 'mfa',
      failedLoginCount: 3,
      lockedUntil: new Date(),
      lastLoginIp: '1.2.3.4',
      latitude: null,
      longitude: null,
    } as never);
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('mfaSecret');
    expect(result).not.toHaveProperty('failedLoginCount');
    expect(result).not.toHaveProperty('lockedUntil');
    expect(result).not.toHaveProperty('lastLoginIp');
    expect(result.email).toBe('a@b.com');
  });

  it('converts Decimal lat/lon to number', () => {
    const result = serializeUser({
      id: 'u1',
      passwordHash: null,
      latitude: { toString: () => '13.51' } as never,
      longitude: { toString: () => '2.12' } as never,
    } as never);
    expect(typeof result.latitude).toBe('number');
    expect(result.latitude).toBeCloseTo(13.51);
  });
});
