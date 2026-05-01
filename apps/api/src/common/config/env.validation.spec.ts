import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const baseEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('accepts a minimal valid env', () => {
    const env = validateEnv(baseEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toContain('http://localhost:8081');
  });

  it('splits CORS_ORIGINS into array', () => {
    const env = validateEnv({ ...baseEnv, CORS_ORIGINS: 'https://a.com, https://b.com' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('coerces PORT to number', () => {
    const env = validateEnv({ ...baseEnv, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(typeof env.PORT).toBe('number');
  });

  it('throws on missing DATABASE_URL', () => {
    expect(() => validateEnv({ REDIS_URL: 'redis://localhost:6379' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('throws on invalid URL', () => {
    expect(() => validateEnv({ ...baseEnv, DATABASE_URL: 'not-a-url' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  describe('production', () => {
    const prodMin = {
      ...baseEnv,
      NODE_ENV: 'production',
      JWT_PRIVATE_KEY_PATH: '/keys/p.pem',
      JWT_PUBLIC_KEY_PATH: '/keys/u.pem',
      DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      APP_WEB_URL: 'https://example.com',
      CORS_ORIGINS: 'https://example.com',
    };

    it('accepts a complete prod env', () => {
      expect(() => validateEnv(prodMin)).not.toThrow();
    });

    it('rejects when APP_WEB_URL missing', () => {
      const { APP_WEB_URL: _omit, ...rest } = prodMin;
      expect(() => validateEnv(rest)).toThrow(/APP_WEB_URL is required/);
    });

    it('rejects localhost-only CORS in prod', () => {
      expect(() =>
        validateEnv({ ...prodMin, CORS_ORIGINS: 'http://localhost:8081,http://127.0.0.1:3000' }),
      ).toThrow(/CORS_ORIGINS must list at least one non-localhost/);
    });

    it('rejects partial SMTP config', () => {
      expect(() => validateEnv({ ...prodMin, SMTP_HOST: 'smtp.x', SMTP_USER: 'u' })).toThrow(
        /SMTP_HOST\/USER\/PASS must all be set/,
      );
    });

    it('rejects DATA_ENCRYPTION_KEY of wrong size', () => {
      expect(() =>
        validateEnv({ ...prodMin, DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
      ).toThrow(/DATA_ENCRYPTION_KEY must be exactly 32 bytes/);
    });
  });
});
