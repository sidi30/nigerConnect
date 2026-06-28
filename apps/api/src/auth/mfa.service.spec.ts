import { createHash } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { authenticator } from 'otplib';
import { MfaService } from './mfa.service';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const norm = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

describe('MfaService', () => {
  it('verifyForUser accepts a valid TOTP code and rejects a wrong one', async () => {
    const secret = authenticator.generateSecret();
    const prisma = { mfaRecoveryCode: { findFirst: jest.fn(async () => null) } };
    const secrets = { get: jest.fn(async () => secret) };
    const mfa = new MfaService(prisma as never, secrets as never);

    const good = authenticator.generate(secret);
    expect(await mfa.verifyForUser('u1', good)).toBe(true);
    expect(await mfa.verifyForUser('u1', '000000')).toBe(false);
  });

  it('consumes a single-use recovery code exactly once', async () => {
    const code = 'ABCDE-FGHJK';
    const row = { id: 'rc1' };
    const findFirst = jest
      .fn()
      .mockImplementationOnce(async () => row) // first use → found
      .mockImplementationOnce(async () => null); // already used → not found
    const update = jest.fn(async () => ({}));
    const prisma = { mfaRecoveryCode: { findFirst, update } };
    const secrets = { get: jest.fn(async () => null) }; // no TOTP secret → recovery path only
    const mfa = new MfaService(prisma as never, secrets as never);

    expect(await mfa.verifyForUser('u1', code)).toBe(true);
    // queried by the normalized hash, and marked used
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ codeHash: sha(norm(code)), usedAt: null }) }),
    );
    expect(update).toHaveBeenCalledWith({ where: { id: 'rc1' }, data: { usedAt: expect.any(Date) } });

    expect(await mfa.verifyForUser('u1', code)).toBe(false); // second time → rejected
  });

  it('beginEnrollment refuses when MFA already enabled', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => ({ mfaEnabled: true, email: 'a@b.com' })) } };
    const secrets = { set: jest.fn() };
    const mfa = new MfaService(prisma as never, secrets as never);
    await expect(mfa.beginEnrollment('u1')).rejects.toBeInstanceOf(ConflictException);
    expect(secrets.set).not.toHaveBeenCalled();
  });

  it('confirmEnrollment enables MFA + returns 10 recovery codes on a valid code', async () => {
    const secret = authenticator.generateSecret();
    const tx = jest.fn(async (ops: unknown[]) => ops);
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ mfaEnabled: false })), update: jest.fn() },
      mfaRecoveryCode: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: tx,
    };
    const secrets = { get: jest.fn(async () => secret) };
    const mfa = new MfaService(prisma as never, secrets as never);

    const { recoveryCodes } = await mfa.confirmEnrollment('u1', authenticator.generate(secret));
    expect(recoveryCodes).toHaveLength(10);
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it('confirmEnrollment rejects a bad code', async () => {
    const secret = authenticator.generateSecret();
    const prisma = { user: { findUnique: jest.fn(async () => ({ mfaEnabled: false })) } };
    const secrets = { get: jest.fn(async () => secret) };
    const mfa = new MfaService(prisma as never, secrets as never);
    await expect(mfa.confirmEnrollment('u1', '000000')).rejects.toBeInstanceOf(BadRequestException);
  });
});
