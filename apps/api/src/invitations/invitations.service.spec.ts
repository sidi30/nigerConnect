/**
 * Unit tests — Parrainage & Invitations (§12)
 *
 * Tests:
 *  1. Quota math (mix pending/accepted/expired/revoked + refund on revocation/expiration)
 *  2. Email-verified gate → 403 if not verified
 *  3. Abuse-flag freeze (≥3 flags → 403)
 *  4. Atomic consumption (2 concurrent same code → 1 ok / 1 fail)
 *  5. SettingsService write-through invalidation
 *  6. Gating: 3 modes × 3 portes (email + Google + Apple, creation vs existing login)
 *  7. 'closed' blocks creation, allows existing-account login
 *  8. Email invite: targetEmail stored + mailer called
 *  9. Email-match registration: passes invite_only without code
 * 10. Code takes precedence over email-match
 * 11. targetEmail purged on accept / revoke / expiry
 * 12. atomicallyConsumeByEmail race (2 concurrent → 1 win)
 * 13. No-match email + no code → 403
 */

import { BadRequestException, ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { SettingsService } from '../common/settings/settings.service';
import { AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type InvitationRow = {
  id: string;
  code: string;
  inviterId: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: Date | null;
  acceptedById: string | null;
  targetEmail: string | null;
  createdAt: Date;
};

function makeInvitationRow(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: 'inv-1',
    code: 'TESTCODE10',
    inviterId: 'inviter-id',
    status: 'pending',
    expiresAt: new Date(Date.now() + 86_400_000),
    acceptedById: null,
    targetEmail: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeUserRow(overrides: Partial<{
  id: string;
  emailVerified: boolean;
  inviteQuota: number;
  inviteAbuseFlags: number;
  displayName: string | null;
  firstName: string | null;
}> = {}) {
  return {
    id: 'inviter-id',
    emailVerified: true,
    inviteQuota: 3,
    inviteAbuseFlags: 0,
    displayName: 'Test User',
    firstName: 'Test',
    ...overrides,
  };
}

function makePrisma(opts: {
  userRow?: ReturnType<typeof makeUserRow> | null;
  countResult?: number;
  invitationRow?: InvitationRow | null;
  updateManyCount?: number;
  inviterRow?: { displayName: string | null; firstName: string | null } | null;
  findFirstResult?: InvitationRow | null;
} = {}) {
  const prisma: Record<string, unknown> = {
    user: {
      findUniqueOrThrow: jest.fn(async () => opts.userRow ?? makeUserRow()),
    },
    invitation: {
      count: jest.fn(async () => opts.countResult ?? 0),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'inv-new',
        code: args.data['code'] ?? 'ABCDEFGHIJ',
        inviterId: args.data['inviterId'],
        status: 'pending',
        expiresAt: args.data['expiresAt'],
        targetEmail: args.data['targetEmail'] ?? null,
        createdAt: new Date(),
        acceptedById: null,
        revokedAt: null,
        acceptedAt: null,
      })),
      findUnique: jest.fn(async () => opts.invitationRow ?? makeInvitationRow()),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => opts.findFirstResult ?? null),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: opts.updateManyCount ?? 1 })),
    },
  };
  // createInvitation now re-checks quota + creates inside a Serializable tx.
  // The mock tx delegates to the same invitation.* jest mocks so existing
  // assertions on count/create still hold.
  prisma['$transaction'] = jest.fn(
    async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );
  return prisma as typeof prisma & {
    user: { findUniqueOrThrow: jest.Mock };
    invitation: {
      count: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
}

function makeSettingsSvc(mode: 'open' | 'invite_only' | 'closed' = 'open') {
  return {
    getRegistrationMode: jest.fn(async () => mode),
    getSetting: jest.fn(async (_key: string, def: string) => def),
    setSetting: jest.fn(async () => undefined),
    getDefaultInviteQuota: jest.fn(async () => 3),
    getInviteExpiryDays: jest.fn(async () => 30),
  };
}

function makeNotifications() {
  return { create: jest.fn(async () => null) };
}

function makeMailer() {
  return {
    sendInvitationEmail: jest.fn(async () => undefined),
    sendEmailVerification: jest.fn(async () => undefined),
    sendWelcome: jest.fn(async () => undefined),
  };
}

function makeSvc(
  prisma: ReturnType<typeof makePrisma>,
  settings = makeSettingsSvc(),
  mailer = makeMailer(),
) {
  return new InvitationsService(
    prisma as never,
    settings as never,
    makeNotifications() as never,
    mailer as never,
  );
}

// ─── 1. Quota math ────────────────────────────────────────────────────────────

describe('InvitationsService — quota math', () => {
  it('uses 0 slots when no invitations exist', async () => {
    const prisma = makePrisma({ countResult: 0 });
    const svc = makeSvc(prisma);
    const used = await svc.computeUsedSlots('inviter-id');
    expect(used).toBe(0);
  });

  it('counts pending (non-expired) and accepted as used slots', async () => {
    const prisma = makePrisma({ countResult: 2 });
    const svc = makeSvc(prisma);
    const used = await svc.computeUsedSlots('inviter-id');
    expect(used).toBe(2);
    // Verify the WHERE clause includes accepted + non-expired pending
    expect(prisma.invitation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          inviterId: 'inviter-id',
          OR: expect.arrayContaining([
            { status: 'accepted' },
            expect.objectContaining({ status: 'pending' }),
          ]),
        }),
      }),
    );
  });

  it('does NOT count revoked invitations as used slots (slot refunded)', async () => {
    // Revoked rows are excluded by the WHERE clause — count returns 0
    const prisma = makePrisma({ countResult: 0 });
    const svc = makeSvc(prisma);
    const used = await svc.computeUsedSlots('inviter-id');
    expect(used).toBe(0);
  });

  it('does NOT count expired invitations as used slots (slot refunded)', async () => {
    // Expired-by-date rows are excluded (status=pending AND expiresAt<=now) — count returns 0
    const prisma = makePrisma({ countResult: 0 });
    const svc = makeSvc(prisma);
    const used = await svc.computeUsedSlots('inviter-id');
    expect(used).toBe(0);
  });

  it('returns available=max(0, quota-used) in listInvitations', async () => {
    const prisma = makePrisma({ countResult: 2 });
    prisma.user.findUniqueOrThrow = jest.fn(async () => makeUserRow({ inviteQuota: 3 }));
    const svc = makeSvc(prisma);
    const result = await svc.listInvitations('inviter-id');
    expect(result.quota).toBe(3);
    expect(result.used).toBe(2);
    expect(result.available).toBe(1);
  });

  it('available is 0 when used >= quota (never negative)', async () => {
    const prisma = makePrisma({ countResult: 5 });
    prisma.user.findUniqueOrThrow = jest.fn(async () => makeUserRow({ inviteQuota: 3 }));
    const svc = makeSvc(prisma);
    const result = await svc.listInvitations('inviter-id');
    expect(result.available).toBe(0);
  });
});

// ─── 2. Email-verified gate ───────────────────────────────────────────────────

describe('InvitationsService — email-verified gate', () => {
  it('throws ForbiddenException (EMAIL_NOT_VERIFIED) when inviter email not verified', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: false }) });
    const svc = makeSvc(prisma);
    await expect(svc.createInvitation('inviter-id')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.createInvitation('inviter-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }),
    });
  });

  it('allows invitation creation when email is verified', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ emailVerified: true, inviteQuota: 3, inviteAbuseFlags: 0 }),
      countResult: 0,
    });
    const svc = makeSvc(prisma);
    const result = await svc.createInvitation('inviter-id');
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('url');
  });
});

// ─── 3. Abuse-flag freeze ─────────────────────────────────────────────────────

describe('InvitationsService — abuse-flag freeze', () => {
  it('throws ForbiddenException (INVITE_QUOTA_FROZEN) when inviteAbuseFlags >= 3', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true, inviteAbuseFlags: 3 }) });
    const svc = makeSvc(prisma);
    await expect(svc.createInvitation('inviter-id')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.createInvitation('inviter-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVITE_QUOTA_FROZEN' }),
    });
  });

  it('throws when inviteAbuseFlags > 3 (well above threshold)', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true, inviteAbuseFlags: 10 }) });
    const svc = makeSvc(prisma);
    await expect(svc.createInvitation('inviter-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows creation when inviteAbuseFlags = 2 (below threshold)', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ emailVerified: true, inviteAbuseFlags: 2, inviteQuota: 3 }),
      countResult: 0,
    });
    const svc = makeSvc(prisma);
    const result = await svc.createInvitation('inviter-id');
    expect(result).toHaveProperty('code');
  });
});

// ─── 4. Quota exceeded ───────────────────────────────────────────────────────

describe('InvitationsService — quota exceeded', () => {
  it('throws ForbiddenException (INVITE_QUOTA_EXCEEDED) when quota is full', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ emailVerified: true, inviteQuota: 3, inviteAbuseFlags: 0 }),
      countResult: 3, // used = quota
    });
    const svc = makeSvc(prisma);
    await expect(svc.createInvitation('inviter-id')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.createInvitation('inviter-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVITE_QUOTA_EXCEEDED' }),
    });
  });

  // ── Regression: TOCTOU quota race (point 4) ────────────────────────────────
  it('rejects creation when the in-transaction re-count hits quota (concurrent insert)', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ emailVerified: true, inviteQuota: 3, inviteAbuseFlags: 0 }),
    });
    prisma.invitation.count
      .mockResolvedValueOnce(2) // step-4 pre-check
      .mockResolvedValueOnce(3); // in-transaction authoritative re-count
    const svc = makeSvc(prisma);
    await expect(svc.createInvitation('inviter-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVITE_QUOTA_EXCEEDED' }),
    });
    expect(prisma.invitation.create).not.toHaveBeenCalled();
  });

  it('creates inside the Serializable transaction on the happy path', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ emailVerified: true, inviteQuota: 3, inviteAbuseFlags: 0 }),
      countResult: 1,
    });
    const svc = makeSvc(prisma);
    const result = await svc.createInvitation('inviter-id');
    expect(result).toHaveProperty('code');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.invitation.create).toHaveBeenCalled();
  });
});

// ─── 5. Revoke ───────────────────────────────────────────────────────────────

describe('InvitationsService — revoke', () => {
  it('revokes a pending invitation owned by the current user', async () => {
    const prisma = makePrisma({ invitationRow: makeInvitationRow({ status: 'pending', inviterId: 'inviter-id' }) });
    const svc = makeSvc(prisma);
    await expect(svc.revokeInvitation('inviter-id', 'inv-1')).resolves.toBeUndefined();
    expect(prisma.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ status: 'revoked' }),
      }),
    );
  });

  it('purges targetEmail on revoke (data-minimization)', async () => {
    const prisma = makePrisma({
      invitationRow: makeInvitationRow({ status: 'pending', inviterId: 'inviter-id', targetEmail: 'bob@example.com' }),
    });
    const svc = makeSvc(prisma);
    await svc.revokeInvitation('inviter-id', 'inv-1');
    expect(prisma.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetEmail: null }),
      }),
    );
  });

  it('throws NotFoundException when invitation does not belong to caller', async () => {
    const prisma = makePrisma({
      invitationRow: makeInvitationRow({ inviterId: 'someone-else' }),
    });
    const svc = makeSvc(prisma);
    await expect(svc.revokeInvitation('inviter-id', 'inv-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when invitation is not found (null)', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => null) as any;
    const svc = makeSvc(prisma);
    await expect(svc.revokeInvitation('inviter-id', 'inv-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException (INVITATION_NOT_REVOCABLE) for an accepted invitation', async () => {
    const prisma = makePrisma({
      invitationRow: makeInvitationRow({ status: 'accepted', inviterId: 'inviter-id' }),
    });
    const svc = makeSvc(prisma);
    await expect(svc.revokeInvitation('inviter-id', 'inv-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

// ─── 6. checkInvitation (public endpoint) ────────────────────────────────────

describe('InvitationsService — checkInvitation', () => {
  it('returns { valid: true, inviterName } for a valid pending code', async () => {
    const prisma = makePrisma();
    prisma.invitation.findUnique = jest.fn(async () => ({
      ...makeInvitationRow({ status: 'pending' }),
      inviter: { displayName: 'Aïcha Maïga', firstName: 'Aïcha' },
    }));
    const svc = makeSvc(prisma);
    const result = await svc.checkInvitation('TESTCODE10');
    expect(result).toEqual({ valid: true, inviterName: 'Aïcha Maïga' });
  });

  it('returns { valid: false } for an expired code', async () => {
    const prisma = makePrisma();
    prisma.invitation.findUnique = jest.fn(async () => ({
      ...makeInvitationRow({ status: 'pending', expiresAt: new Date(Date.now() - 1000) }),
      inviter: { displayName: 'Aïcha', firstName: null },
    }));
    const svc = makeSvc(prisma);
    const result = await svc.checkInvitation('TESTCODE10');
    expect(result).toEqual({ valid: false });
  });

  it('returns { valid: false } for an accepted code', async () => {
    const prisma = makePrisma();
    prisma.invitation.findUnique = jest.fn(async () => ({
      ...makeInvitationRow({ status: 'accepted' }),
      inviter: null,
    }));
    const svc = makeSvc(prisma);
    const result = await svc.checkInvitation('BADCODE');
    expect(result).toEqual({ valid: false });
  });

  it('returns { valid: false } for a non-existent code', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => null) as any;
    const svc = makeSvc(prisma);
    const result = await svc.checkInvitation('NONEXIST');
    expect(result).toEqual({ valid: false });
  });
});

// ─── 6b. preValidateCode HTTP-status discrimination (BUG-001) ────────────────

describe('InvitationsService — preValidateCode status codes', () => {
  it('throws 400 INVITE_CODE_CONSUMED for an already-accepted code (spec §4.1.6.b)', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => makeInvitationRow({ status: 'accepted' })) as any;
    const svc = makeSvc(prisma);
    await expect(svc.preValidateCode('USEDCODE10')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.preValidateCode('USEDCODE10')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVITE_CODE_CONSUMED' }),
    });
  });

  it('throws 403 INVALID_INVITE_CODE for a non-existent code', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => null) as any;
    const svc = makeSvc(prisma);
    await expect(svc.preValidateCode('NONEXIST10')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.preValidateCode('NONEXIST10')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_INVITE_CODE' }),
    });
  });

  it('throws 403 for a revoked code (not 400 — only accepted is "consumed")', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => makeInvitationRow({ status: 'revoked' })) as any;
    const svc = makeSvc(prisma);
    await expect(svc.preValidateCode('REVOKED100')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns inviterId for a valid pending code', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => makeInvitationRow({ status: 'pending', inviterId: 'inv-9' })) as any;
    const svc = makeSvc(prisma);
    await expect(svc.preValidateCode('PENDING100')).resolves.toEqual({ inviterId: 'inv-9' });
  });
});

// ─── 7. Atomic consumption (§4.1.6.b) ───────────────────────────────────────

describe('InvitationsService — atomicallyConsumeCode', () => {
  it('returns 1 when the code is consumed successfully', async () => {
    const prisma = makePrisma({ updateManyCount: 1 });
    const svc = makeSvc(prisma);
    const count = await svc.atomicallyConsumeCode('TESTCODE10', 'new-user-id', prisma as never);
    expect(count).toBe(1);
  });

  it('returns 0 when the code was already consumed (race lost)', async () => {
    const prisma = makePrisma({ updateManyCount: 0 });
    const svc = makeSvc(prisma);
    const count = await svc.atomicallyConsumeCode('TESTCODE10', 'new-user-id', prisma as never);
    expect(count).toBe(0);
  });

  it('simulates 2 concurrent consumption — only 1 succeeds', async () => {
    // First call returns count=1, second returns count=0 (race)
    const updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const prisma = makePrisma();
    prisma.invitation.updateMany = updateMany;
    const svc = makeSvc(prisma);

    const [r1, r2] = await Promise.all([
      svc.atomicallyConsumeCode('TESTCODE10', 'user-A', prisma as never),
      svc.atomicallyConsumeCode('TESTCODE10', 'user-B', prisma as never),
    ]);

    const successes = [r1, r2].filter((c) => c === 1).length;
    const failures = [r1, r2].filter((c) => c === 0).length;
    expect(successes).toBe(1);
    expect(failures).toBe(1);
  });

  it('purges targetEmail on consume (data-minimization)', async () => {
    const prisma = makePrisma({ updateManyCount: 1 });
    const svc = makeSvc(prisma);
    await svc.atomicallyConsumeCode('TESTCODE10', 'new-user-id', prisma as never);
    expect(prisma.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetEmail: null }),
      }),
    );
  });
});

// ─── 8. SettingsService write-through ────────────────────────────────────────

describe('SettingsService — write-through cache', () => {
  it('writes to Redis immediately after DB upsert (write-through)', async () => {
    const prismaSet = jest.fn(async () => ({}));
    const redisMock = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => undefined),
    };
    const prismaMock = {
      appSetting: {
        findUnique: jest.fn(async () => null),
        upsert: prismaSet,
      },
    };

    const { SettingsService: SS } = await import('../common/settings/settings.service');
    const svc = new SS(prismaMock as never, redisMock as never);

    await svc.setSetting('registration_mode', 'invite_only', 'admin-id');

    // DB upsert called
    expect(prismaSet).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'registration_mode' },
        update: expect.objectContaining({ value: 'invite_only' }),
      }),
    );
    // Redis set called immediately (write-through)
    expect(redisMock.set).toHaveBeenCalledWith('setting:registration_mode', 'invite_only', 300);
  });

  it('returns cached value from Redis without hitting the DB', async () => {
    const redisMock = {
      get: jest.fn(async () => 'invite_only'),
      set: jest.fn(async () => undefined),
    };
    const prismaMock = {
      appSetting: { findUnique: jest.fn(async () => null) },
    };

    const { SettingsService: SS } = await import('../common/settings/settings.service');
    const svc = new SS(prismaMock as never, redisMock as never);

    const mode = await svc.getRegistrationMode();
    expect(mode).toBe('invite_only');
    expect(prismaMock.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to "open" when both Redis and DB miss', async () => {
    const redisMock = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
    };
    const prismaMock = {
      appSetting: { findUnique: jest.fn(async () => null) },
    };

    const { SettingsService: SS } = await import('../common/settings/settings.service');
    const svc = new SS(prismaMock as never, redisMock as never);

    const mode = await svc.getRegistrationMode();
    expect(mode).toBe('open');
  });
});

// ─── 9. Auth gating — 3 modes × 3 portes ────────────────────────────────────

describe('AuthService — registration mode gating', () => {
  const password = new PasswordService();

  type PrismaMock = {
    user: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    identityDocument: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    invitation: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };

  function makePrismaAuth(opts: { userRow?: object | null; existingUser?: object | null } = {}): PrismaMock {
    const base: PrismaMock = {
      user: {
        findFirst: jest.fn(async () => opts.existingUser ?? null),
        findUnique: jest.fn(async () => null),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
          id: 'new-u',
          firstName: null,
          ...args.data,
          role: 'user',
          identityStatus: 'not_submitted',
        })),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      identityDocument: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      invitation: { updateMany: jest.fn(async () => ({ count: 1 })) },
      $transaction: jest.fn(),
    };
    base['$transaction'] = jest.fn(async (fn: (tx: PrismaMock) => Promise<unknown>) => fn(base));
    return base;
  }

  function makeTokensSvc() {
    return {
      issueTokens: jest.fn(async () => ({
        accessToken: 'access',
        refreshToken: 'refresh',
        accessExpiresIn: 900,
        refreshExpiresAt: new Date(),
      })),
      rotateRefreshToken: jest.fn(),
      revokeRefreshToken: jest.fn(),
    };
  }

  function makeSettingsAuth(mode: 'open' | 'invite_only' | 'closed') {
    return { getRegistrationMode: jest.fn(async () => mode) };
  }

  function makeInvitesSvc(opts: {
    preValidateResult?: { inviterId: string | null };
    consumeCount?: number;
    preValidateEmailResult?: { inviterId: string | null } | null;
    consumeByEmailResult?: { count: number; inviterId: string | null };
  } = {}) {
    return {
      preValidateCode: jest.fn(async () => opts.preValidateResult ?? { inviterId: 'inv-id' }),
      atomicallyConsumeCode: jest.fn(async () => opts.consumeCount ?? 1),
      notifyInviter: jest.fn(),
      preValidateEmail: jest.fn(async () => opts.preValidateEmailResult ?? null),
      atomicallyConsumeByEmail: jest.fn(async () =>
        opts.consumeByEmailResult ?? { count: 1, inviterId: 'inv-id' },
      ),
    };
  }

  function makeAuthSvc(
    mode: 'open' | 'invite_only' | 'closed',
    prisma: PrismaMock,
    invites = makeInvitesSvc(),
  ) {
    return new AuthService(
      prisma as never,
      password,
      makeTokensSvc() as never,
      { incrementCounter: jest.fn(async () => 1), blacklistJwt: jest.fn() } as never,
      { sendEmailVerification: jest.fn(), sendPasswordReset: jest.fn(), sendWelcome: jest.fn() } as never,
      { createWithCode: jest.fn(async () => ({ token: 'tok', code: '123456' })), consume: jest.fn(), consumeCode: jest.fn() } as never,
      { verifyIdToken: jest.fn() } as never,
      { verify: jest.fn() } as never,
      { get: jest.fn(() => 'nigerconnect-private') } as never,
      makeSettingsAuth(mode) as never,
      invites as never,
    );
  }

  // ── 'closed' mode ──────────────────────────────────────────────────────────

  describe("mode 'closed'", () => {
    it('blocks register (email) with 403', async () => {
      const svc = makeAuthSvc('closed', makePrismaAuth());
      await expect(
        svc.register({ email: 'x@y.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks new Google account creation with 403', async () => {
      const prisma = makePrismaAuth();
      const svc = makeAuthSvc('closed', prisma);
      // No existing user → creation branch hit → 403
      await expect(
        svc.loginWithOAuth('google', 'google-sub', { email: 'x@y.com', emailVerified: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('allows login for existing Google account (creation branch NOT hit)', async () => {
      const existingUser = {
        id: 'u-exist',
        role: 'user',
        identityStatus: 'not_submitted',
        firstName: null,
      };
      // findFirst returns the existing user → goes straight to issueTokens
      const prisma = makePrismaAuth({ existingUser });
      const svc = makeAuthSvc('closed', prisma);
      const result = await svc.loginWithOAuth('google', 'google-sub', { email: 'x@y.com', emailVerified: true });
      expect(result.accessToken).toBe('access');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  // ── 'invite_only' mode ─────────────────────────────────────────────────────

  describe("mode 'invite_only'", () => {
    it('blocks register without inviteCode and no email-match → 403', async () => {
      const svc = makeAuthSvc(
        'invite_only',
        makePrismaAuth(),
        makeInvitesSvc({ preValidateEmailResult: null }),
      );
      await expect(
        svc.register({ email: 'x@y.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Threat 1 regression: no self-authorization. An email with no PENDING
    // targeted invite must 403 BEFORE any user row is created — the attacker
    // cannot bootstrap an account by simply supplying an email.
    it('does NOT create a user when email-match misses and no code (no bypass)', async () => {
      const prisma = makePrismaAuth();
      const svc = makeAuthSvc(
        'invite_only',
        prisma,
        makeInvitesSvc({ preValidateEmailResult: null }),
      );
      await expect(
        svc.register({ email: 'attacker@evil.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B' }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITE_CODE_REQUIRED' }) });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('allows register with valid inviteCode → 201', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({ preValidateResult: { inviterId: 'inv-id' }, consumeCount: 1 });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.register({
        email: 'x@y.com',
        password: 'Str0ng!Pass1',
        firstName: 'A',
        lastName: 'B',
        inviteCode: 'VALIDCODE10',
      });
      expect(result.accessToken).toBe('access');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ invitedById: 'inv-id' }),
        }),
      );
    });

    it('allows register via email-match (no code, but targetEmail matches) → 201', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        preValidateEmailResult: { inviterId: 'inv-email-id' },
        consumeByEmailResult: { count: 1, inviterId: 'inv-email-id' },
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.register({
        email: 'invited@example.com',
        password: 'Str0ng!Pass1',
        firstName: 'A',
        lastName: 'B',
        // No inviteCode — email-match should authorize
      });
      expect(result.accessToken).toBe('access');
      expect(invites.preValidateEmail).toHaveBeenCalledWith('invited@example.com');
      expect(invites.atomicallyConsumeByEmail).toHaveBeenCalled();
    });

    it('blocks register when email-match race: atomicallyConsumeByEmail returns 0', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        preValidateEmailResult: { inviterId: 'inv-email-id' },
        consumeByEmailResult: { count: 0, inviterId: null },
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      await expect(
        svc.register({
          email: 'invited@example.com',
          password: 'Str0ng!Pass1',
          firstName: 'A',
          lastName: 'B',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('code takes precedence over email-match when both are present', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        preValidateResult: { inviterId: 'code-inviter-id' },
        consumeCount: 1,
        // email-match also would find something, but should not be called
        preValidateEmailResult: { inviterId: 'email-inviter-id' },
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.register({
        email: 'x@y.com',
        password: 'Str0ng!Pass1',
        firstName: 'A',
        lastName: 'B',
        inviteCode: 'VALIDCODE10',
      });
      expect(result.accessToken).toBe('access');
      // Code path used: preValidateCode called, preValidateEmail NOT called
      expect(invites.preValidateCode).toHaveBeenCalledWith('VALIDCODE10');
      expect(invites.preValidateEmail).not.toHaveBeenCalled();
      // Atomic consume by code, not by email
      expect(invites.atomicallyConsumeCode).toHaveBeenCalled();
      expect(invites.atomicallyConsumeByEmail).not.toHaveBeenCalled();
    });

    it('blocks new Google account without inviteCode and no email-match → 403', async () => {
      const prisma = makePrismaAuth(); // no existing user
      const invites = makeInvitesSvc({ preValidateEmailResult: null });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      await expect(
        svc.loginWithOAuth('google', 'goog-sub', { email: 'x@y.com', emailVerified: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows new Google account with valid inviteCode → 201', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({ preValidateResult: { inviterId: 'inv-id' }, consumeCount: 1 });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.loginWithOAuth(
        'google',
        'goog-sub',
        { email: 'x@y.com', emailVerified: true },
        undefined,
        'VALIDCODE10',
      );
      expect(result.accessToken).toBe('access');
    });

    it('allows new Google account via email-match (no code) → 201', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        preValidateEmailResult: { inviterId: 'inv-email-id' },
        consumeByEmailResult: { count: 1, inviterId: 'inv-email-id' },
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.loginWithOAuth(
        'google',
        'goog-sub',
        { email: 'invited@example.com', emailVerified: true },
      );
      expect(result.accessToken).toBe('access');
      expect(invites.preValidateEmail).toHaveBeenCalledWith('invited@example.com');
      expect(invites.atomicallyConsumeByEmail).toHaveBeenCalled();
    });

    it('allows login for existing Google account without inviteCode (creation NOT hit)', async () => {
      const existingUser = { id: 'u-exist', role: 'user', identityStatus: 'not_submitted', firstName: null };
      const prisma = makePrismaAuth({ existingUser });
      const svc = makeAuthSvc('invite_only', prisma);
      // No inviteCode — but user already exists → goes straight to issueTokens
      const result = await svc.loginWithOAuth('google', 'goog-sub', { email: 'x@y.com', emailVerified: true });
      expect(result.accessToken).toBe('access');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  // ── 'open' mode ────────────────────────────────────────────────────────────

  describe("mode 'open'", () => {
    it('allows register without inviteCode (ignores code)', async () => {
      const svc = makeAuthSvc('open', makePrismaAuth());
      const result = await svc.register({
        email: 'x@y.com',
        password: 'Str0ng!Pass1',
        firstName: 'A',
        lastName: 'B',
      });
      expect(result.accessToken).toBe('access');
    });

    // Threat 7 regression: in 'open' mode the email-match path must NOT run —
    // no silent consume of a pending targeted invite that happens to match the
    // registrant's email.
    it('does NOT run email-match (no silent consume) in open mode', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        // even though an invite WOULD match, open mode must never look it up
        preValidateEmailResult: { inviterId: 'inv-email-id' },
        consumeByEmailResult: { count: 1, inviterId: 'inv-email-id' },
      });
      const svc = makeAuthSvc('open', prisma, invites);
      await svc.register({
        email: 'invited@example.com',
        password: 'Str0ng!Pass1',
        firstName: 'A',
        lastName: 'B',
      });
      expect(invites.preValidateEmail).not.toHaveBeenCalled();
      expect(invites.atomicallyConsumeByEmail).not.toHaveBeenCalled();
      expect(invites.atomicallyConsumeCode).not.toHaveBeenCalled();
    });

    it('allows new Google account creation without inviteCode', async () => {
      const svc = makeAuthSvc('open', makePrismaAuth());
      const result = await svc.loginWithOAuth('google', 'goog-sub', { email: 'x@y.com', emailVerified: true });
      expect(result.accessToken).toBe('access');
    });
  });
});

// ─── 10. Email invite: targetEmail stored + mailer called ────────────────────

describe('InvitationsService — email-targeted invite', () => {
  it('stores normalized targetEmail when email is provided', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ emailVerified: true, inviteQuota: 3, inviteAbuseFlags: 0 }),
      countResult: 0,
    });
    const mailer = makeMailer();
    const svc = makeSvc(prisma, makeSettingsSvc(), mailer);
    await svc.createInvitation('inviter-id', { email: '  Bob@Example.COM  ' });
    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetEmail: 'bob@example.com', // normalized
        }),
      }),
    );
  });

  it('calls mailer.sendInvitationEmail (fire-and-forget) when email provided', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ emailVerified: true, inviteQuota: 3, inviteAbuseFlags: 0, displayName: 'Moussa Diallo' }),
      countResult: 0,
    });
    const mailer = makeMailer();
    const svc = makeSvc(prisma, makeSettingsSvc(), mailer);
    await svc.createInvitation('inviter-id', { email: 'bob@example.com' });
    // Fire-and-forget: we need to flush the microtask queue
    await Promise.resolve();
    expect(mailer.sendInvitationEmail).toHaveBeenCalledWith(
      'bob@example.com',
      'Moussa Diallo',
      expect.any(String), // code
      expect.stringContaining('https://nigerconnect.app/invite/'),
    );
  });

  it('does NOT call mailer when no email provided (link-only invite)', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ emailVerified: true, inviteQuota: 3, inviteAbuseFlags: 0 }),
      countResult: 0,
    });
    const mailer = makeMailer();
    const svc = makeSvc(prisma, makeSettingsSvc(), mailer);
    await svc.createInvitation('inviter-id'); // no email arg
    await Promise.resolve();
    expect(mailer.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('does NOT store targetEmail when no email provided', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ emailVerified: true, inviteQuota: 3, inviteAbuseFlags: 0 }),
      countResult: 0,
    });
    const svc = makeSvc(prisma);
    await svc.createInvitation('inviter-id');
    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetEmail: null,
        }),
      }),
    );
  });
});

// ─── 11. preValidateEmail ─────────────────────────────────────────────────────

describe('InvitationsService — preValidateEmail', () => {
  it('returns { inviterId } when a pending non-expired invite targets that email', async () => {
    const prisma = makePrisma({
      findFirstResult: makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9' }),
    });
    const svc = makeSvc(prisma);
    const result = await svc.preValidateEmail('BOB@EXAMPLE.COM');
    expect(result).toEqual({ inviterId: 'inv-9' });
    // verify the lookup normalized the email
    expect(prisma.invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetEmail: 'bob@example.com', status: 'pending' }),
      }),
    );
  });

  it('returns null when no pending invite targets that email (no-match)', async () => {
    const prisma = makePrisma({ findFirstResult: null });
    const svc = makeSvc(prisma);
    const result = await svc.preValidateEmail('unknown@example.com');
    expect(result).toBeNull();
  });

  it('never throws — absence is a soft null, not an error', async () => {
    const prisma = makePrisma({ findFirstResult: null });
    const svc = makeSvc(prisma);
    await expect(svc.preValidateEmail('notfound@example.com')).resolves.toBeNull();
  });
});

// ─── 12. atomicallyConsumeByEmail — race ─────────────────────────────────────

describe('InvitationsService — atomicallyConsumeByEmail race', () => {
  it('returns count=1 and inviterId when consume succeeds', async () => {
    const prisma = makePrisma({
      findFirstResult: makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9' }),
      updateManyCount: 1,
    });
    const svc = makeSvc(prisma);
    const result = await svc.atomicallyConsumeByEmail('bob@example.com', 'new-user-id', prisma as never);
    expect(result).toEqual({ count: 1, inviterId: 'inv-9' });
  });

  it('returns count=0 when no invite found for that email', async () => {
    const prisma = makePrisma({ findFirstResult: null });
    const svc = makeSvc(prisma);
    const result = await svc.atomicallyConsumeByEmail('nobody@example.com', 'new-user-id', prisma as never);
    expect(result).toEqual({ count: 0, inviterId: null });
  });

  it('returns count=0 when the updateMany race is lost (another registration won)', async () => {
    const prisma = makePrisma({
      findFirstResult: makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9' }),
      updateManyCount: 0, // race lost
    });
    const svc = makeSvc(prisma);
    const result = await svc.atomicallyConsumeByEmail('bob@example.com', 'new-user-id', prisma as never);
    expect(result).toEqual({ count: 0, inviterId: 'inv-9' });
  });

  it('simulates 2 concurrent registrations via email-match — only 1 wins', async () => {
    const candidate = makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9' });
    const findFirst = jest.fn(async () => candidate);
    const updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 1 })  // first request wins
      .mockResolvedValueOnce({ count: 0 }); // second request loses

    const prisma = makePrisma();
    prisma.invitation.findFirst = findFirst;
    prisma.invitation.updateMany = updateMany;

    const svc = makeSvc(prisma);
    const [r1, r2] = await Promise.all([
      svc.atomicallyConsumeByEmail('bob@example.com', 'user-A', prisma as never),
      svc.atomicallyConsumeByEmail('bob@example.com', 'user-B', prisma as never),
    ]);

    const wins = [r1, r2].filter((r) => r.count === 1).length;
    const losses = [r1, r2].filter((r) => r.count === 0).length;
    expect(wins).toBe(1);
    expect(losses).toBe(1);
  });

  it('purges targetEmail on successful consume (data-minimization)', async () => {
    const prisma = makePrisma({
      findFirstResult: makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9' }),
      updateManyCount: 1,
    });
    const svc = makeSvc(prisma);
    await svc.atomicallyConsumeByEmail('bob@example.com', 'new-user-id', prisma as never);
    expect(prisma.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetEmail: null }),
      }),
    );
  });
});

// ─── 13. Expiry cron purges targetEmail ──────────────────────────────────────

describe('InvitationExpiryCron — purges targetEmail on expiry', () => {
  it('sets targetEmail=null when flipping pending→expired', async () => {
    const updateMany = jest.fn(async () => ({ count: 2 }));
    const prisma = { invitation: { updateMany } };
    const { InvitationExpiryCron } = await import('./invitation-expiry.cron');
    const cron = new InvitationExpiryCron(prisma as never);
    await cron.run();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'expired', targetEmail: null }),
      }),
    );
  });
});
