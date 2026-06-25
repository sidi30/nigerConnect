import { createHash } from 'crypto';
import { EmailTokenService } from './email-token.service';
import type { PrismaService } from '../common/prisma/prisma.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('EmailTokenService', () => {
  let service: EmailTokenService;
  let createMany: jest.Mock;
  let updateMany: jest.Mock;
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let prisma: PrismaService;

  beforeEach(() => {
    createMany = jest.fn(async () => ({ count: 2 }));
    updateMany = jest.fn(async () => ({ count: 0 }));
    findUnique = jest.fn();
    update = jest.fn(async () => ({}));
    prisma = {
      emailToken: { createMany, updateMany, findUnique, update },
    } as unknown as PrismaService;
    service = new EmailTokenService(prisma);
  });

  describe('createWithCode (decoupling)', () => {
    it('mints the code and the link in TWO separate rows', async () => {
      await service.createWithCode('user-1', 'verify_email');

      expect(createMany).toHaveBeenCalledTimes(1);
      const rows = createMany.mock.calls[0][0].data as Array<{
        tokenHash: string;
        codeHash?: string;
      }>;
      expect(rows).toHaveLength(2);

      const linkRows = rows.filter((r) => !r.codeHash);
      const codeRows = rows.filter((r) => r.codeHash);
      expect(linkRows).toHaveLength(1);
      expect(codeRows).toHaveLength(1);
      // The two rows carry DISTINCT token hashes — so a link prefetch (matched
      // by tokenHash) can never select the code row.
      expect(linkRows[0]!.tokenHash).not.toEqual(codeRows[0]!.tokenHash);
    });

    it('returns a link token that hashes to the LINK row, not the code row', async () => {
      const { token, code } = await service.createWithCode('user-1', 'verify_email');
      const rows = createMany.mock.calls[0][0].data as Array<{
        tokenHash: string;
        codeHash?: string;
      }>;
      const linkRow = rows.find((r) => !r.codeHash)!;
      const codeRow = rows.find((r) => r.codeHash)!;

      // The emailed link token resolves to the link row only.
      expect(sha256(token)).toEqual(linkRow.tokenHash);
      expect(sha256(token)).not.toEqual(codeRow.tokenHash);
      // The emailed code resolves to the code row only.
      expect(sha256(code)).toEqual(codeRow.codeHash);
    });

    it('sets a 15-minute expiry on the verify_email rows', async () => {
      const before = Date.now();
      await service.createWithCode('user-1', 'verify_email');
      const after = Date.now();

      const rows = createMany.mock.calls[0][0].data as Array<{ expiresAt: Date }>;
      for (const r of rows) {
        const ttl = r.expiresAt.getTime();
        expect(ttl).toBeGreaterThanOrEqual(before + 15 * 60_000);
        expect(ttl).toBeLessThanOrEqual(after + 15 * 60_000);
      }
    });

    it('invalidates prior unused rows (both shapes) before issuing a fresh pair', async () => {
      await service.createWithCode('user-1', 'verify_email');
      expect(updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: 'verify_email', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
    });
  });

  describe('consume (link) does not burn the code row', () => {
    it('only updates the row matched by the link tokenHash', async () => {
      // Simulate the link row found by its unique tokenHash. The code row is a
      // different record entirely and is never looked up here.
      findUnique.mockResolvedValue({
        id: 'link-row',
        type: 'verify_email',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });

      const userId = await service.consume('raw-link-token', 'verify_email');

      expect(userId).toBe('user-1');
      // The only row mutated is the link row — the code row is untouched, so the
      // user can still type their 6-digit code after a scanner prefetch.
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({
        where: { id: 'link-row' },
        data: { usedAt: expect.any(Date) },
      });
    });
  });
});
