import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

function makeService(doc: { id: string } | null) {
  const update = jest.fn(async () => ({}));
  const findFirst = jest.fn(async () => doc);
  const prisma = { identityDocument: { findFirst, update } };
  const admin = new AdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { get: jest.fn(() => 'private-bucket') } as never,
  );
  return { admin, findFirst, update };
}

describe('AdminService — DOB backfill', () => {
  it('sets the DOB on the latest approved document (UTC midnight)', async () => {
    const { admin, findFirst, update } = makeService({ id: 'doc-1' });

    await admin.setApprovedDob('user-1', '1990-03-12');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: 'approved' } }),
    );
    const arg = update.mock.calls[0]![0] as { data: { dateOfBirth: Date } };
    expect(arg.data.dateOfBirth.toISOString()).toBe('1990-03-12T00:00:00.000Z');
  });

  it('throws 404 when the user has no approved document', async () => {
    const { admin, update } = makeService(null);
    await expect(admin.setApprovedDob('user-1', '1990-03-12')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
