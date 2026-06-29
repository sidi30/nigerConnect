import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * Security-focused unit tests for the admin user-management guards:
 * self-protection, staff-protection, and session revocation on block.
 */
function makeService(overrides: {
  targetRole?: string | null; // null => user not found
  profile?: { deleteAccount: jest.Mock };
} = {}) {
  const userUpdate = jest.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 't-1' }));
  const refreshUpdateMany = jest.fn(async () => ({ count: 2 }));
  const transaction = jest.fn(async (ops: unknown[]) => ops);
  const findUnique = jest.fn(async () =>
    overrides.targetRole === null ? null : { id: 't-1', role: overrides.targetRole ?? 'user' },
  );
  const prisma = {
    user: { update: userUpdate, findUnique },
    refreshToken: { updateMany: refreshUpdateMany },
    $transaction: transaction,
  };
  const profile = overrides.profile ?? { deleteAccount: jest.fn(async () => undefined) };
  const admin = new AdminService(
    prisma as never,
    {} as never,
    {} as never,
    profile as never,
    { log: jest.fn(), recent: jest.fn(async () => []) } as never, // audit
    { get: jest.fn(() => 'private-bucket') } as never,
  );
  return { admin, userUpdate, refreshUpdateMany, transaction, findUnique, profile };
}

describe('AdminService — user management guards', () => {
  // ── setUserStatus ──────────────────────────────────────────────────────────
  it('refuses to change your OWN status', async () => {
    const { admin, findUnique } = makeService();
    await expect(
      admin.setUserStatus({ id: 'me', role: 'admin' }, 'me', 'banned'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('refuses a MODERATOR acting on a staff (admin) target', async () => {
    const { admin } = makeService({ targetRole: 'admin' });
    await expect(
      admin.setUserStatus({ id: 'mod', role: 'moderator' }, 't-1', 'suspended'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 when the target does not exist', async () => {
    const { admin } = makeService({ targetRole: null });
    await expect(
      admin.setUserStatus({ id: 'admin', role: 'admin' }, 't-1', 'banned'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('banning REVOKES refresh tokens (force-logout) in one transaction', async () => {
    const { admin, refreshUpdateMany, transaction } = makeService({ targetRole: 'user' });
    const res = await admin.setUserStatus({ id: 'admin', role: 'admin' }, 't-1', 'banned');
    expect(res).toEqual({ id: 't-1', status: 'banned' });
    expect(refreshUpdateMany).toHaveBeenCalledWith({
      where: { userId: 't-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('reactivating (active) does NOT revoke tokens', async () => {
    const { admin, refreshUpdateMany } = makeService({ targetRole: 'user' });
    await admin.setUserStatus({ id: 'admin', role: 'admin' }, 't-1', 'active');
    expect(refreshUpdateMany).not.toHaveBeenCalled();
  });

  // ── deleteUser ───────────────────────────────────────────────────────────────
  it('refuses to delete your OWN account here', async () => {
    const profile = { deleteAccount: jest.fn(async () => undefined) };
    const { admin } = makeService({ profile });
    await expect(admin.deleteUser({ id: 'me' }, 'me')).rejects.toBeInstanceOf(ForbiddenException);
    expect(profile.deleteAccount).not.toHaveBeenCalled();
  });

  it('delete reuses ProfileService.deleteAccount (cascade + S3)', async () => {
    const profile = { deleteAccount: jest.fn(async () => undefined) };
    const { admin } = makeService({ targetRole: 'user', profile });
    await admin.deleteUser({ id: 'admin' }, 't-1');
    expect(profile.deleteAccount).toHaveBeenCalledWith('t-1');
  });

  // ── updateUser ───────────────────────────────────────────────────────────────
  it('refuses to change your OWN role (anti-lockout)', async () => {
    const { admin } = makeService({ targetRole: 'admin' });
    await expect(
      admin.updateUser({ id: 'me', role: 'admin' }, 'me', { role: 'user' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes only the provided fields', async () => {
    const { admin, userUpdate } = makeService({ targetRole: 'user' });
    await admin.updateUser({ id: 'admin', role: 'admin' }, 't-1', { displayName: 'New Name' });
    const arg = userUpdate.mock.calls[0]![0];
    expect(arg.data).toEqual({ displayName: 'New Name' });
  });
});
