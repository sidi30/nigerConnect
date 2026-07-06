import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * Security-focused unit tests for the admin user-management guards:
 * self-protection, staff-protection, sanction (motive/expiry), session revocation,
 * expiry auto-lift, list filters, force-logout and MFA reset.
 */
function makeService(overrides: {
  targetRole?: string | null; // null => user not found
  profile?: { deleteAccount: jest.Mock };
} = {}) {
  const detailUser = {
    id: 't-1',
    role: overrides.targetRole ?? 'user',
    email: 'u@example.com',
    status: 'active',
    statusReason: null,
    statusExpiresAt: null,
    invitedBy: null,
  };
  const userUpdate = jest.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 't-1' }));
  const userUpdateMany = jest.fn(async () => ({ count: 0 }));
  const userCount = jest.fn(async () => 3);
  const refreshUpdateMany = jest.fn(async () => ({ count: 2 }));
  const refreshFindMany = jest.fn(async () => []);
  const mfaDeleteMany = jest.fn(async () => ({ count: 4 }));
  const postCount = jest.fn(async () => 10);
  const commentCount = jest.fn(async () => 7);
  const reportCount = jest.fn(async () => 1);
  const invitationCount = jest.fn(async () => 2);
  const auditCreate = jest.fn(async () => ({ id: 'a-1' }));
  const auditFindMany = jest.fn(async () => []);
  const transaction = jest.fn(async (ops: unknown[]) => ops);
  const findUnique = jest.fn(async () => (overrides.targetRole === null ? null : detailUser));
  const findMany = jest.fn(async (_args: { where?: Record<string, unknown> }) => [] as unknown[]);
  const prisma = {
    user: {
      update: userUpdate,
      updateMany: userUpdateMany,
      count: userCount,
      findUnique,
      findMany,
    },
    refreshToken: { updateMany: refreshUpdateMany, findMany: refreshFindMany },
    mfaRecoveryCode: { deleteMany: mfaDeleteMany },
    post: { count: postCount },
    comment: { count: commentCount },
    report: { count: reportCount },
    invitation: { count: invitationCount },
    adminAuditLog: { create: auditCreate, findMany: auditFindMany },
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
  return {
    admin,
    userUpdate,
    userUpdateMany,
    userCount,
    refreshUpdateMany,
    refreshFindMany,
    mfaDeleteMany,
    auditCreate,
    auditFindMany,
    transaction,
    findUnique,
    findMany,
    profile,
  };
}

describe('AdminService — user management guards', () => {
  // ── setUserStatus ──────────────────────────────────────────────────────────
  it('refuses to change your OWN status', async () => {
    const { admin, findUnique } = makeService();
    await expect(
      admin.setUserStatus({ id: 'me', role: 'admin' }, 'me', { status: 'banned', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('refuses a MODERATOR acting on a staff (admin) target', async () => {
    const { admin } = makeService({ targetRole: 'admin' });
    await expect(
      admin.setUserStatus({ id: 'mod', role: 'moderator' }, 't-1', { status: 'suspended', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 when the target does not exist', async () => {
    const { admin } = makeService({ targetRole: null });
    await expect(
      admin.setUserStatus({ id: 'admin', role: 'admin' }, 't-1', { status: 'banned', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('banning persists motive + revokes tokens + writes audit in one transaction', async () => {
    const { admin, userUpdate, refreshUpdateMany, auditCreate, transaction } = makeService({
      targetRole: 'user',
    });
    const res = await admin.setUserStatus({ id: 'admin', role: 'admin' }, 't-1', {
      status: 'banned',
      reason: 'Spam répété',
    });
    expect(res).toEqual({
      id: 't-1',
      status: 'banned',
      statusReason: 'Spam répété',
      statusExpiresAt: null,
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { status: 'banned', statusReason: 'Spam répété', statusExpiresAt: null },
      select: { id: true },
    });
    expect(refreshUpdateMany).toHaveBeenCalledWith({
      where: { userId: 't-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin',
        action: 'user.status.banned',
        targetUserId: 't-1',
        meta: { reason: 'Spam répété', expiresAt: null },
      }),
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('suspending with an expiry stores statusExpiresAt', async () => {
    const { admin, userUpdate } = makeService({ targetRole: 'user' });
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    const res = await admin.setUserStatus({ id: 'admin', role: 'admin' }, 't-1', {
      status: 'suspended',
      reason: '7 jours',
      expiresAt,
    });
    expect(res.statusExpiresAt).toEqual(expiresAt);
    expect(userUpdate.mock.calls[0]![0].data).toEqual({
      status: 'suspended',
      statusReason: '7 jours',
      statusExpiresAt: expiresAt,
    });
  });

  it('reactivating (active) clears motive/expiry and does NOT revoke tokens', async () => {
    const { admin, userUpdate, refreshUpdateMany } = makeService({ targetRole: 'user' });
    const res = await admin.setUserStatus({ id: 'admin', role: 'admin' }, 't-1', { status: 'active' });
    expect(res).toEqual({ id: 't-1', status: 'active', statusReason: null, statusExpiresAt: null });
    expect(userUpdate.mock.calls[0]![0].data).toEqual({
      status: 'active',
      statusReason: null,
      statusExpiresAt: null,
    });
    expect(refreshUpdateMany).not.toHaveBeenCalled();
  });

  // ── auto-lift of expired suspensions ────────────────────────────────────────
  it('listUsers sweeps expired suspensions back to active before reading', async () => {
    const { admin, userUpdateMany } = makeService({ targetRole: 'user' });
    await admin.listUsers({ limit: 30 });
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { status: 'suspended', statusExpiresAt: { not: null, lt: expect.any(Date) } },
      data: { status: 'active', statusReason: null, statusExpiresAt: null },
    });
  });

  it('getUserDetail scopes the expiry sweep to the single user', async () => {
    const { admin, userUpdateMany } = makeService({ targetRole: 'user' });
    const detail = await admin.getUserDetail('t-1');
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 't-1', status: 'suspended', statusExpiresAt: { not: null, lt: expect.any(Date) } },
      data: { status: 'active', statusReason: null, statusExpiresAt: null },
    });
    expect(detail.counts).toEqual({ posts: 10, comments: 7, reportsReceived: 1, reportsMade: 1 });
    expect(detail.invitations).toEqual({ sent: 2, accepted: 3 });
    // Never leaks a secret.
    expect(detail).not.toHaveProperty('passwordHash');
    expect(detail).not.toHaveProperty('mfaSecret');
  });

  it('getUserDetail 404s on a missing user', async () => {
    const { admin } = makeService({ targetRole: null });
    await expect(admin.getUserDetail('t-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── list filters ─────────────────────────────────────────────────────────────
  it('listUsers builds a where from advanced filters', async () => {
    const { admin, findMany } = makeService({ targetRole: 'user' });
    const after = new Date('2026-01-01T00:00:00Z');
    await admin.listUsers({
      limit: 30,
      role: 'moderator',
      emailVerified: true,
      countryCode: 'NE',
      identityStatus: 'approved',
      ambassador: false,
      createdAfter: after,
    });
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      role: 'moderator',
      emailVerified: true,
      countryCode: 'NE',
      identityStatus: 'approved',
      isAmbassador: false,
      createdAt: { gte: after },
    });
  });

  // ── force-logout ─────────────────────────────────────────────────────────────
  it('forceLogout revokes tokens + audits and returns the revoked count', async () => {
    const { admin, refreshUpdateMany, auditCreate } = makeService({ targetRole: 'user' });
    const res = await admin.forceLogout({ id: 'admin' }, 't-1');
    expect(res).toEqual({ revoked: 2 });
    expect(refreshUpdateMany).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'user.force_logout', targetUserId: 't-1' }),
    });
  });

  it('forceLogout 404s on a missing user', async () => {
    const { admin } = makeService({ targetRole: null });
    await expect(admin.forceLogout({ id: 'admin' }, 't-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── reset-mfa ────────────────────────────────────────────────────────────────
  it('resetMfa clears TOTP + recovery codes + audits in one transaction', async () => {
    const { admin, transaction } = makeService({ targetRole: 'user' });
    const res = await admin.resetMfa({ id: 'admin' }, 't-1');
    expect(res).toEqual({ id: 't-1', mfaEnabled: false });
    expect(transaction).toHaveBeenCalledTimes(1);
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
