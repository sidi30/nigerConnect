import {
  APPROVED_RETENTION_MS,
  IdentityArchiverService,
  REJECTED_RETENTION_MS,
} from './identity-archiver.service';

interface ArchiveRow {
  purgeAt: Date;
  retainUntil: Date;
  archivedAt: Date;
}

const DOC = {
  id: 'd1',
  userId: 'u1',
  documentType: 'passport',
  fileUrl: 's3://nigerconnect-private/users/u1/identity/a.jpg',
  status: 'approved',
  dateOfBirth: new Date('1990-01-02T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  reviewedAt: new Date('2026-01-02T00:00:00.000Z'),
};

function makeArchiver(overrides: { doc?: Record<string, unknown> | null; object?: unknown } = {}) {
  const doc = overrides.doc === undefined ? DOC : overrides.doc;
  const create = jest.fn(async () => ({}));
  const prisma = {
    identityDocument: { findUnique: jest.fn(async () => doc) },
    user: {
      findUnique: jest.fn(async () => ({ firstName: 'A', lastName: 'B', email: 'a@b.c' })),
    },
    identityArchive: {
      create,
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
  };
  const s3 = {
    getPrivateObject: jest.fn(async () =>
      overrides.object === undefined
        ? { body: Buffer.from('bytes'), contentType: 'image/jpeg' }
        : overrides.object,
    ),
    deletePrivateObject: jest.fn(async () => undefined),
  };
  const vault = {
    isEnabled: true,
    seal: jest.fn(async ({ vaultKey }: never) => ({
      vaultKey: 'identity/u1/arch1.enc',
      contentSha256: 'a'.repeat(64),
      sizeBytes: 5,
      retainUntil: new Date(),
      ...(vaultKey ? {} : {}),
    })),
    extendRetention: jest.fn(async () => undefined),
    purge: jest.fn(async () => undefined),
  };
  return {
    svc: new IdentityArchiverService(prisma as never, s3 as never, vault as never),
    prisma,
    s3,
    vault,
    create,
  };
}

/** Lit un argument d'appel d'un mock sans se battre avec les tuples vides. */
function callArg<T>(fn: unknown, call = 0, arg = 0): T {
  return ((fn as jest.Mock).mock.calls[call] as unknown[])[arg] as T;
}

describe('IdentityArchiverService', () => {
  it('seals first, then removes the active copy — never the reverse', async () => {
    const { svc, s3, vault, create } = makeArchiver();
    const ok = await svc.archiveDocument('d1');
    expect(ok).toBe(true);
    expect(vault.seal).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
    expect(s3.deletePrivateObject).toHaveBeenCalledWith('users/u1/identity/a.jpg');
    const sealOrder = (vault.seal as jest.Mock).mock.invocationCallOrder[0]!;
    const deleteOrder = (s3.deletePrivateObject as jest.Mock).mock.invocationCallOrder[0]!;
    expect(sealOrder).toBeLessThan(deleteOrder);
  });

  it('does not delete the active copy when sealing fails', async () => {
    const { svc, s3, vault } = makeArchiver();
    vault.seal.mockRejectedValueOnce(new Error('vault down'));
    await expect(svc.archiveDocument('d1')).rejects.toThrow('vault down');
    expect(s3.deletePrivateObject).not.toHaveBeenCalled();
  });

  it('an approved document keeps 5 years, counted from the account deletion', async () => {
    const { svc, create } = makeArchiver();
    const deletedAt = new Date('2026-06-01T00:00:00.000Z');
    await svc.archiveDocument('d1', deletedAt);
    const data = callArg<{ data: ArchiveRow }>(create).data;
    expect(data.purgeAt.getTime()).toBe(deletedAt.getTime() + APPROVED_RETENTION_MS);
    // Le verrou WORM colle à l'échéance : pas de purge anticipée possible.
    expect(data.retainUntil).toEqual(data.purgeAt);
  });

  it('a rejected document keeps 1 year, and the account deletion does not extend it', async () => {
    const { svc, create } = makeArchiver({ doc: { ...DOC, status: 'rejected' } });
    const deletedAt = new Date('2026-06-01T00:00:00.000Z');
    await svc.archiveDocument('d1', deletedAt);
    const data = callArg<{ data: ArchiveRow }>(create).data;
    expect(data.purgeAt.getTime()).toBe(
      new Date(data.archivedAt).getTime() + REJECTED_RETENTION_MS,
    );
  });

  it('never seals a pending document', async () => {
    const { svc, vault } = makeArchiver({ doc: { ...DOC, status: 'pending' } });
    expect(await svc.archiveDocument('d1')).toBe(false);
    expect(vault.seal).not.toHaveBeenCalled();
  });

  it('never seals a manual verification (no file)', async () => {
    const { svc, vault } = makeArchiver({ doc: { ...DOC, fileUrl: null } });
    expect(await svc.archiveDocument('d1')).toBe(false);
    expect(vault.seal).not.toHaveBeenCalled();
  });

  it('does not fabricate an empty archive when the object is already gone', async () => {
    const { svc, vault, create } = makeArchiver({ object: null });
    expect(await svc.archiveDocument('d1')).toBe(false);
    expect(vault.seal).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('account deletion pushes an approved archive to deletion + 5 years', async () => {
    const { svc, prisma, vault } = makeArchiver();
    const deletedAt = new Date('2027-01-01T00:00:00.000Z');
    prisma.identityArchive.findMany.mockResolvedValueOnce([
      {
        id: 'a1',
        outcome: 'approved',
        vaultKey: 'identity/u1/a1.enc',
        purgeAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    ] as never);
    await svc.onAccountDeleted('u1', deletedAt);
    const target = new Date(deletedAt.getTime() + APPROVED_RETENTION_MS);
    expect(vault.extendRetention).toHaveBeenCalledWith('identity/u1/a1.enc', target);
    expect(prisma.identityArchive.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { accountDeletedAt: deletedAt, purgeAt: target, retainUntil: target },
    });
  });

  it('never shortens an existing lock (object-lock would refuse it anyway)', async () => {
    const { svc, prisma, vault } = makeArchiver();
    prisma.identityArchive.findMany.mockResolvedValueOnce([
      {
        id: 'a1',
        outcome: 'rejected',
        vaultKey: 'identity/u1/a1.enc',
        purgeAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    ] as never);
    await svc.onAccountDeleted('u1', new Date('2027-01-01T00:00:00.000Z'));
    expect(vault.extendRetention).not.toHaveBeenCalled();
  });

  it('purges only archives whose retention AND lock have both elapsed', async () => {
    const { svc, prisma, vault } = makeArchiver();
    const now = new Date('2030-01-01T00:00:00.000Z');
    prisma.identityArchive.findMany.mockResolvedValueOnce([
      { id: 'a1', vaultKey: 'identity/u1/a1.enc' },
    ] as never);
    expect(await svc.purgeExpired(now)).toBe(1);
    const where = callArg<{ where: { purgeAt: unknown; retainUntil: unknown } }>(
      prisma.identityArchive.findMany,
    ).where;
    expect(where.purgeAt).toEqual({ lt: now });
    expect(where.retainUntil).toEqual({ lt: now });
    expect(vault.purge).toHaveBeenCalledWith('identity/u1/a1.enc');
  });

  it('keeps the row when the storage refuses the purge, so it is retried', async () => {
    const { svc, prisma, vault } = makeArchiver();
    prisma.identityArchive.findMany.mockResolvedValueOnce([
      { id: 'a1', vaultKey: 'identity/u1/a1.enc' },
    ] as never);
    vault.purge.mockRejectedValueOnce(new Error('object is WORM protected'));
    expect(await svc.purgeExpired(new Date('2030-01-01T00:00:00.000Z'))).toBe(0);
    expect(prisma.identityArchive.update).not.toHaveBeenCalled();
  });
});
