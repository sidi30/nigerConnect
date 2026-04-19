import { createHash, generateKeyPairSync } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenService } from './token.service';

function setupKeys() {
  const dir = mkdtempSync(join(tmpdir(), 'jwt-keys-'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const priv = join(dir, 'priv.pem');
  const pub = join(dir, 'pub.pem');
  writeFileSync(priv, privateKey);
  writeFileSync(pub, publicKey);
  return { priv, pub };
}

describe('TokenService', () => {
  let service: TokenService;
  let prisma: {
    refreshToken: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  };

  beforeAll(() => {
    const { priv, pub } = setupKeys();
    const config = {
      get: (key: string) => {
        if (key === 'JWT_PRIVATE_KEY_PATH') return priv;
        if (key === 'JWT_PUBLIC_KEY_PATH') return pub;
        if (key === 'JWT_ACCESS_EXPIRES') return '15m';
        if (key === 'JWT_REFRESH_EXPIRES') return '30d';
        return undefined;
      },
    } as unknown as ConfigService;
    prisma = {
      refreshToken: {
        create: jest.fn(async () => ({})),
        findUnique: jest.fn(),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    service = new TokenService(config as never, new JwtService({}), prisma as never);
  });

  it('issues access and refresh tokens and persists hashed refresh', async () => {
    const { accessToken, refreshToken } = await service.issueTokens('u1', 'user', 'not_submitted');
    expect(accessToken.split('.').length).toBe(3);
    expect(refreshToken.length).toBeGreaterThan(32);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        }),
      }),
    );
  });

  it('detects refresh reuse and revokes all tokens', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      usedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1_000_000),
      user: { role: 'user', identityStatus: 'not_submitted' },
    });
    const result = await service.rotateRefreshToken('some-token');
    expect(result).toBeNull();
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('returns null on unknown refresh token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    expect(await service.rotateRefreshToken('nope')).toBeNull();
  });

  it('returns null on expired refresh token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      user: { role: 'user', identityStatus: 'approved' },
    });
    expect(await service.rotateRefreshToken('expired')).toBeNull();
  });
});
