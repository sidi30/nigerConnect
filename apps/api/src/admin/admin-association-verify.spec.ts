import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * A5 — association certification traceability. `Association.isVerified`
 * existed with no endpoint ever setting it; these lock in that granting AND
 * revoking are traced (verifiedAt/verifiedById/verificationNote on the row +
 * an admin audit log entry) and 404 on an unknown/soft-deleted association.
 */
function makeService() {
  const associationUpdate = jest.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'a1',
    ...args.data,
  }));
  const associationFindFirst = jest.fn(async () => ({ id: 'a1', name: 'Asso Test' }));
  const auditCreate = jest.fn(async () => ({ id: 'audit-1' }));
  const prisma = {
    association: { findFirst: associationFindFirst, update: associationUpdate },
    adminAuditLog: { create: auditCreate },
  };
  const admin = new AdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never, // profile
    {} as never, // audit
    {} as never, // notifications
    {} as never, // mailer
    { get: jest.fn(() => 'private-bucket') } as never,
  );
  return { admin, associationUpdate, associationFindFirst, auditCreate };
}

describe('AdminService — association certification (A5)', () => {
  it('verifyAssociation sets verifiedAt/verifiedById/verificationNote and audits it', async () => {
    const { admin, associationUpdate, auditCreate } = makeService();
    const result = await admin.verifyAssociation({ id: 'staff-1' }, 'a1', 'Papiers vérifiés');
    expect(associationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({
          isVerified: true,
          verifiedById: 'staff-1',
          verificationNote: 'Papiers vérifiés',
          verifiedAt: expect.any(Date),
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 'staff-1', action: 'association.verified' }),
      }),
    );
    expect(result).toMatchObject({ isVerified: true });
  });

  it('unverifyAssociation clears the badge and audits the revocation', async () => {
    const { admin, associationUpdate, auditCreate } = makeService();
    await admin.unverifyAssociation({ id: 'staff-1' }, 'a1', 'Plainte reçue');
    expect(associationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({
          isVerified: false,
          verifiedById: null,
          verifiedAt: null,
          verificationNote: 'Plainte reçue',
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 'staff-1', action: 'association.unverified' }),
      }),
    );
  });

  it('404s on an unknown (or soft-deleted) association', async () => {
    const { admin, associationFindFirst } = makeService();
    associationFindFirst.mockResolvedValueOnce(null as never);
    await expect(admin.verifyAssociation({ id: 'staff-1' }, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
