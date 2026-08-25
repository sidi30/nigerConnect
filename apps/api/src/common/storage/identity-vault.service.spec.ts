import { createDecipheriv, generateKeyPairSync, privateDecrypt, constants } from 'crypto';
import { IdentityVaultService, type VaultEnvelopeMeta } from './identity-vault.service';

const MAGIC = Buffer.from('NCVAULT1', 'utf8');

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  // 2048 suffit pour un test — la prod génère du 4096 via scripts/vault-keygen.
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function makeConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    S3_VAULT_BUCKET: 'vault',
    S3_VAULT_ACCESS_KEY: 'ak',
    S3_VAULT_SECRET_KEY: 'sk',
    IDENTITY_VAULT_PUBLIC_KEY: Buffer.from(publicKey, 'utf8').toString('base64'),
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://minio:9000',
    S3_FORCE_PATH_STYLE: true,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as never;
}

const meta: VaultEnvelopeMeta = {
  userId: 'u1',
  outcome: 'approved',
  documentType: 'passport',
  holder: { firstName: 'A', lastName: 'B', email: 'a@b.c', dateOfBirth: '1990-01-02' },
  submittedAt: '2026-01-01T00:00:00.000Z',
  reviewedAt: '2026-01-02T00:00:00.000Z',
  originalKey: 'users/u1/identity/a.jpg',
  contentType: 'image/jpeg',
};

/** Rejoue le déchiffrement du CLI break-glass sur une enveloppe scellée. */
function unseal(envelope: Buffer, userId: string) {
  expect(envelope.subarray(0, 8)).toEqual(MAGIC);
  let offset = 8;
  const wrappedLen = envelope.readUInt16BE(offset);
  offset += 2;
  const wrappedKey = envelope.subarray(offset, offset + wrappedLen);
  offset += wrappedLen;
  const iv = envelope.subarray(offset, offset + 12);
  offset += 12;
  const tag = envelope.subarray(offset, offset + 16);
  offset += 16;
  const ciphertext = envelope.subarray(offset);

  const dataKey = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    wrappedKey,
  );
  const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
  decipher.setAAD(Buffer.concat([MAGIC, Buffer.from(userId, 'utf8')]));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const metaLen = plaintext.readUInt32BE(0);
  return {
    meta: JSON.parse(plaintext.subarray(4, 4 + metaLen).toString('utf8')) as VaultEnvelopeMeta,
    file: plaintext.subarray(4 + metaLen),
  };
}

/** Lit un argument d'appel d'un mock sans se battre avec les tuples vides. */
function callArg<T>(fn: unknown, call = 0, arg = 0): T {
  return ((fn as jest.Mock).mock.calls[call] as unknown[])[arg] as T;
}

describe('IdentityVaultService', () => {
  it('is disabled when the public key or the bucket is missing', () => {
    expect(new IdentityVaultService(makeConfig({ S3_VAULT_BUCKET: undefined })).isEnabled).toBe(false);
    expect(
      new IdentityVaultService(makeConfig({ IDENTITY_VAULT_PUBLIC_KEY: undefined })).isEnabled,
    ).toBe(false);
    expect(new IdentityVaultService(makeConfig()).isEnabled).toBe(true);
  });

  it('seals a document so only the offline private key can read it back', async () => {
    const vault = new IdentityVaultService(makeConfig());
    const send = jest.fn(async () => ({}));
    (vault as unknown as { client: { send: unknown } }).client = { send };

    const body = Buffer.from('PIECE-DIDENTITE-BYTES');
    const retainUntil = new Date('2031-01-01T00:00:00.000Z');
    const sealed = await vault.seal({ archiveId: 'arch1', meta, body, retainUntil });

    expect(sealed.vaultKey).toBe('identity/u1/arch1.enc');
    expect(sealed.sizeBytes).toBe(body.length);

    const input = callArg<{ input: Record<string, unknown> }>(send).input;
    // Le verrou WORM est posé À L'ÉCRITURE : sans lui, une purge anticipée
    // resterait possible et la durée de conservation ne serait que déclarative.
    expect(input.ObjectLockMode).toBe('GOVERNANCE');
    expect(input.ObjectLockRetainUntilDate).toEqual(retainUntil);

    // Rien de lisible en clair dans ce qui part au stockage.
    const envelope = input.Body as Buffer;
    expect(envelope.includes(body)).toBe(false);
    expect(envelope.toString('utf8')).not.toContain('a@b.c');

    const opened = unseal(envelope, 'u1');
    expect(opened.file.equals(body)).toBe(true);
    expect(opened.meta.holder.email).toBe('a@b.c');
    expect(opened.meta.documentType).toBe('passport');
  });

  it('binds the envelope to its owner — another userId as AAD fails to open', async () => {
    const vault = new IdentityVaultService(makeConfig());
    const send = jest.fn(async () => ({}));
    (vault as unknown as { client: { send: unknown } }).client = { send };
    await vault.seal({
      archiveId: 'arch1',
      meta,
      body: Buffer.from('x'),
      retainUntil: new Date('2031-01-01T00:00:00.000Z'),
    });
    const envelope = callArg<{ input: { Body: Buffer } }>(send).input.Body;
    expect(() => unseal(envelope, 'someone-else')).toThrow();
  });

  it('refuses to seal when it is not configured', async () => {
    const vault = new IdentityVaultService(makeConfig({ S3_VAULT_BUCKET: undefined }));
    await expect(
      vault.seal({
        archiveId: 'a',
        meta,
        body: Buffer.from('x'),
        retainUntil: new Date('2031-01-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('not configured');
  });
});
