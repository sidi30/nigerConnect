import { IdentityCleanupCron } from './identity-cleanup.cron';

/**
 * GDPR: an expired identity document must disappear from BOTH the database and
 * object storage. Identity documents live in the PRIVATE bucket, so the delete
 * has to target it explicitly — `deleteObject` defaults to the public bucket
 * and swallows its own failure, which left every expired document on disk.
 */
function makeCron(docs: Array<{ id: string; fileUrl: string | null }>) {
  const deleteMany = jest.fn(async () => ({ count: docs.length }));
  const prisma = {
    identityDocument: { findMany: jest.fn(async () => docs), deleteMany },
  };
  const s3 = {
    deleteObject: jest.fn(async () => undefined),
    deletePrivateObject: jest.fn(async () => undefined),
  };
  return { cron: new IdentityCleanupCron(prisma as never, s3 as never), s3, deleteMany };
}

describe('IdentityCleanupCron', () => {
  it('deletes the expired document from the PRIVATE bucket, not the public one', async () => {
    const { cron, s3 } = makeCron([
      { id: 'd1', fileUrl: 's3://nigerconnect-private/users/u1/identity/a.jpg' },
    ]);
    await cron.run();
    expect(s3.deletePrivateObject).toHaveBeenCalledWith('users/u1/identity/a.jpg');
    expect(s3.deleteObject).not.toHaveBeenCalled();
  });

  it('hard-deletes the DB rows once the objects are gone', async () => {
    const { cron, deleteMany } = makeCron([
      { id: 'd1', fileUrl: 's3://nigerconnect-private/users/u1/identity/a.jpg' },
    ]);
    await cron.run();
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['d1'] } } });
  });

  it('manual verifications (no file) delete the row without touching storage', async () => {
    const { cron, s3, deleteMany } = makeCron([{ id: 'd1', fileUrl: null }]);
    await cron.run();
    expect(s3.deletePrivateObject).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalled();
  });

  it('no expired document → no storage call, no delete', async () => {
    const { cron, s3, deleteMany } = makeCron([]);
    await cron.run();
    expect(s3.deletePrivateObject).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
