import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * Rattrapage 18+. La date de naissance appartient au COMPTE : le document est
 * détruit ou archivé 30 jours après examen, et tant qu'elle ne vivait que sur
 * lui, un membre validé perdait la proximité le jour de la purge — avec son
 * badge vérifié toujours affiché. L'outil de rattrapage doit donc fonctionner
 * précisément quand il n'y a PLUS de document.
 */
function makeService(opts: {
  user?: { identityStatus: string } | null;
  doc?: { id: string } | null;
}) {
  const userUpdate = jest.fn(async () => ({}));
  const docUpdate = jest.fn(async () => ({}));
  const findFirst = jest.fn(async () => opts.doc ?? null);
  const prisma = {
    user: {
      findUnique: jest.fn(async () => (opts.user === undefined ? { identityStatus: 'approved' } : opts.user)),
      update: userUpdate,
    },
    identityDocument: { findFirst, update: docUpdate },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const admin = new AdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never, // notifications
    {} as never, // mailer
    { get: jest.fn(() => 'private-bucket') } as never,
  );
  return { admin, findFirst, userUpdate, docUpdate };
}

function dobOf(mock: jest.Mock, call = 0): string {
  const arg = (mock.mock.calls[call] as unknown[])[0] as { data: { dateOfBirth: Date } };
  return arg.data.dateOfBirth.toISOString();
}

describe('AdminService — DOB backfill', () => {
  it('records the DOB on the account at UTC midnight', async () => {
    const { admin, userUpdate } = makeService({ doc: { id: 'doc-1' } });
    await admin.setApprovedDob('user-1', '1990-03-12');
    // Minuit UTC : sans ça, @db.Date décale d'un jour selon le fuseau.
    expect(dobOf(userUpdate)).toBe('1990-03-12T00:00:00.000Z');
  });

  it('mirrors it onto the surviving approved document', async () => {
    const { admin, findFirst, docUpdate } = makeService({ doc: { id: 'doc-1' } });
    await admin.setApprovedDob('user-1', '1990-03-12');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: 'approved' } }),
    );
    expect(dobOf(docUpdate)).toBe('1990-03-12T00:00:00.000Z');
  });

  it('still works once the document has been purged — the case that was broken', async () => {
    const { admin, userUpdate, docUpdate } = makeService({ doc: null });
    await admin.setApprovedDob('user-1', '1990-03-12');
    expect(dobOf(userUpdate)).toBe('1990-03-12T00:00:00.000Z');
    expect(docUpdate).not.toHaveBeenCalled();
  });

  it('refuses a member who is not identity-verified', async () => {
    const { admin, userUpdate } = makeService({ user: { identityStatus: 'pending' } });
    await expect(admin.setApprovedDob('user-1', '1990-03-12')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('throws 404 for an unknown user', async () => {
    const { admin, userUpdate } = makeService({ user: null });
    await expect(admin.setApprovedDob('nobody', '1990-03-12')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
