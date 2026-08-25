import { IdentityCleanupCron } from './identity-cleanup.cron';

/**
 * Cycle de vie d'une pièce d'identité. Deux exigences opposées se tiennent ici :
 *
 *  - la pièce ne doit JAMAIS rester dans la base active au-delà de 30 jours ;
 *  - une pièce examinée ne doit PAS être détruite, mais scellée dans le coffre.
 *
 * Le piège historique : `expiresAt` restait NULL sur un rejet, donc le filtre
 * `expiresAt < now()` ne matchait jamais et les pièces rejetées vivaient
 * indéfiniment. D'où le second critère sur `reviewedAt`.
 */
function makeCron(
  docs: Array<{ id: string; fileUrl: string | null }>,
  opts: { archives?: boolean; pending?: Array<{ id: string; userId: string; fileUrl: string }> } = {},
) {
  const del = jest.fn(async () => undefined);
  const prisma = {
    identityDocument: {
      findMany: jest.fn(async ({ where }: { where: { status?: unknown } }) =>
        where.status === 'pending' ? (opts.pending ?? []) : docs,
      ),
      delete: del,
    },
    user: { updateMany: jest.fn(async () => ({ count: 1 })) },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const s3 = {
    deleteObject: jest.fn(async () => undefined),
    deletePrivateObject: jest.fn(async () => undefined),
  };
  const archiver = {
    // `false` = rien à sceller → l'appelant détruit (coffre éteint, ou pièce
    // sans fichier). `true` = scellée, le fichier actif est déjà parti.
    archiveDocument: jest.fn(async () => opts.archives ?? false),
    purgeExpired: jest.fn(async () => 0),
  };
  return { cron: new IdentityCleanupCron(prisma as never, s3 as never, archiver as never), s3, del, archiver, prisma };
}

/** Lit un argument d'appel d'un mock sans se battre avec les tuples vides. */
function callArg<T>(fn: unknown, call = 0, arg = 0): T {
  return ((fn as jest.Mock).mock.calls[call] as unknown[])[arg] as T;
}

describe('IdentityCleanupCron', () => {
  it('seals a reviewed document into the vault instead of destroying it', async () => {
    const { cron, s3, del, archiver } = makeCron(
      [{ id: 'd1', fileUrl: 's3://nigerconnect-private/users/u1/identity/a.jpg' }],
      { archives: true },
    );
    await cron.run();
    expect(archiver.archiveDocument).toHaveBeenCalledWith('d1');
    // L'archiveur a déjà retiré la copie active — le cron ne double pas le delete.
    expect(s3.deletePrivateObject).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('falls back to destruction (PRIVATE bucket) when the vault is off', async () => {
    const { cron, s3, del } = makeCron([
      { id: 'd1', fileUrl: 's3://nigerconnect-private/users/u1/identity/a.jpg' },
    ]);
    await cron.run();
    expect(s3.deletePrivateObject).toHaveBeenCalledWith('users/u1/identity/a.jpg');
    expect(s3.deleteObject).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('keeps the row when sealing throws, so the next run retries', async () => {
    const { cron, del, archiver, s3 } = makeCron([
      { id: 'd1', fileUrl: 's3://nigerconnect-private/users/u1/identity/a.jpg' },
    ]);
    archiver.archiveDocument.mockRejectedValueOnce(new Error('vault down'));
    await cron.run();
    expect(del).not.toHaveBeenCalled();
    expect(s3.deletePrivateObject).not.toHaveBeenCalled();
  });

  it('selects reviewed documents by expiresAt OR a 30-day-old reviewedAt', async () => {
    const { cron, prisma } = makeCron([]);
    await cron.run();
    const where = callArg<{
      where: { status: unknown; OR: Array<Record<string, unknown>> };
    }>(prisma.identityDocument.findMany).where;
    expect(where.status).toEqual({ in: ['approved', 'rejected'] });
    // Sans la branche reviewedAt, une pièce rejetée (expiresAt NULL) resterait.
    expect(where.OR).toHaveLength(2);
    expect(where.OR[1]).toHaveProperty('reviewedAt');
  });

  it('manual verifications (no file) delete the row without touching storage', async () => {
    const { cron, s3, del } = makeCron([{ id: 'd1', fileUrl: null }]);
    await cron.run();
    expect(s3.deletePrivateObject).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('destroys never-reviewed submissions after 90 days and resets the status', async () => {
    const { cron, s3, prisma } = makeCron([], {
      pending: [{ id: 'p1', userId: 'u9', fileUrl: 's3://nigerconnect-private/users/u9/identity/p.jpg' }],
    });
    await cron.run();
    expect(s3.deletePrivateObject).toHaveBeenCalledWith('users/u9/identity/p.jpg');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u9', identityStatus: 'pending' },
      data: { identityStatus: 'not_submitted' },
    });
  });

  it('no expired document → no storage call, no delete', async () => {
    const { cron, s3, del } = makeCron([]);
    await cron.run();
    expect(s3.deletePrivateObject).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
