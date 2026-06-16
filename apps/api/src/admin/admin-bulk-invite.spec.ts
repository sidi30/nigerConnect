/**
 * Security regression — AdminService.setBulkInviteRight (parrainage v2 réseau).
 *
 * Withdrawing canBulkInvite must ALSO revoke the user's still-active reusable
 * links. Otherwise the right is removed on paper while every previously-issued
 * mass-invite link keeps onboarding accounts indefinitely (A01/A04 — the abuse
 * vector survives the de-privilege). Granting the right must NOT touch any link.
 */

import { AdminService } from './admin.service';

function makeService(): {
  admin: AdminService;
  userUpdate: jest.Mock;
  invitationUpdateMany: jest.Mock;
  transaction: jest.Mock;
} {
  const userUpdate = jest.fn(async () => ({ id: 'u-1', canBulkInvite: false }));
  const invitationUpdateMany = jest.fn(async () => ({ count: 2 }));
  // $transaction([...]) resolves each promise and returns the array, mirroring
  // Prisma's array-form transaction.
  const transaction = jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));

  const prisma = {
    user: { update: userUpdate },
    invitation: { updateMany: invitationUpdateMany },
    $transaction: transaction,
  };

  const admin = new AdminService(
    prisma as never,
    {} as never,
    {} as never,
    { get: jest.fn(() => 'private-bucket') } as never,
  );
  return { admin, userUpdate, invitationUpdateMany, transaction };
}

describe('AdminService — setBulkInviteRight', () => {
  it('GRANT: flips the flag and never revokes any invitation', async () => {
    const { admin, userUpdate, invitationUpdateMany } = makeService();
    userUpdate.mockResolvedValueOnce({ id: 'u-1', canBulkInvite: true });

    const res = await admin.setBulkInviteRight('u-1', true);

    expect(res).toEqual({ id: 'u-1', canBulkInvite: true });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canBulkInvite: true } }),
    );
    expect(invitationUpdateMany).not.toHaveBeenCalled();
  });

  it('REVOKE: flips the flag AND revokes the user active reusable links', async () => {
    const { admin, userUpdate, invitationUpdateMany, transaction } = makeService();

    const res = await admin.setBulkInviteRight('u-1', false);

    expect(res).toEqual({ id: 'u-1', canBulkInvite: false });
    // Atomic: user flip + link revoke must run in a single transaction.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canBulkInvite: false } }),
    );
    // Only this user's pending reusable links — single_use is never touched.
    expect(invitationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inviterId: 'u-1', kind: 'reusable', status: 'pending' },
        data: expect.objectContaining({ status: 'revoked', targetEmail: null }),
      }),
    );
  });
});
