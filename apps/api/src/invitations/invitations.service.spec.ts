/**
 * Unit tests — Parrainage & Invitations (v2 réseau)
 *
 * Couvre :
 *  1. listInvitations : nouveau contrat { canBulkInvite, invites[] } + signupsCount (plus de quota)
 *  2. Email-verified gate → 403 si non vérifié
 *  3. Abuse-flag freeze (≥3 flags → 403)
 *  4. Lien réutilisable : kind=reusable exige canBulkInvite (sinon 403), email ignoré
 *  5. Revoke (pending → revoked, purge targetEmail, ownership)
 *  6. checkInvitation (pending = valide pour single_use ET reusable ; plus d'expiry)
 *  6b. resolveCodeForRegistration : 400 si single_use consommé, 403 si invalide, ok sinon (+ kind)
 *  7. atomicallyConsumeSingleUse (course concurrente → 1 ok / 1 fail, purge email)
 *  8. SettingsService write-through
 *  9. Auth gating : 3 modes × 3 portes + lien reusable (pas de consume)
 * 10. Email invite : targetEmail stocké + mailer appelé ; reusable ne stocke pas d'email
 * 11. preValidateEmail → { inviterId, invitationId }
 * 12. atomicallyConsumeByEmail → { count, inviterId, invitationId } + course
 * 13. Expiry cron purge targetEmail (legacy)
 */

import { BadRequestException, ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type InvitationRow = {
  id: string;
  code: string;
  inviterId: string | null;
  kind: 'single_use' | 'reusable';
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
    kind: 'single_use',
    status: 'pending',
    expiresAt: null,
    acceptedById: null,
    targetEmail: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeUserRow(overrides: Partial<{
  id: string;
  emailVerified: boolean;
  inviteAbuseFlags: number;
  canBulkInvite: boolean;
  displayName: string | null;
  firstName: string | null;
}> = {}) {
  return {
    id: 'inviter-id',
    emailVerified: true,
    inviteAbuseFlags: 0,
    canBulkInvite: false,
    displayName: 'Test User',
    firstName: 'Test',
    ...overrides,
  };
}

function makePrisma(opts: {
  userRow?: ReturnType<typeof makeUserRow> | null;
  invitationRow?: InvitationRow | null;
  updateManyCount?: number;
  findManyResult?: Array<Record<string, unknown>>;
  findFirstResult?: InvitationRow | null;
} = {}) {
  const prisma: Record<string, unknown> = {
    user: {
      findUniqueOrThrow: jest.fn(async () => opts.userRow ?? makeUserRow()),
    },
    invitation: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'inv-new',
        code: args.data['code'] ?? 'ABCDEFGHIJ',
        inviterId: args.data['inviterId'],
        kind: args.data['kind'] ?? 'single_use',
        status: 'pending',
        expiresAt: args.data['expiresAt'] ?? null,
        targetEmail: args.data['targetEmail'] ?? null,
        createdAt: new Date(),
        acceptedById: null,
        revokedAt: null,
        acceptedAt: null,
      })),
      findUnique: jest.fn(async () => opts.invitationRow ?? makeInvitationRow()),
      findMany: jest.fn(async () => opts.findManyResult ?? []),
      findFirst: jest.fn(async () => opts.findFirstResult ?? null),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: opts.updateManyCount ?? 1 })),
    },
  };
  return prisma as typeof prisma & {
    user: { findUniqueOrThrow: jest.Mock };
    invitation: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
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

function makeSvc(prisma: ReturnType<typeof makePrisma>, mailer = makeMailer()) {
  // v2 : InvitationsService(prisma, notifications, mailer) — plus de SettingsService.
  return new InvitationsService(prisma as never, makeNotifications() as never, mailer as never);
}

// ─── 1. listInvitations (nouveau contrat réseau) ────────────────────────────────

describe('InvitationsService — listInvitations', () => {
  it('returns { canBulkInvite, invites[] } (no quota fields)', async () => {
    const prisma = makePrisma({
      userRow: makeUserRow({ canBulkInvite: true }),
      findManyResult: [
        {
          id: 'inv-1',
          code: 'CODE1',
          kind: 'reusable',
          status: 'pending',
          acceptedBy: null,
          _count: { signups: 7 },
          createdAt: new Date(),
        },
      ],
    });
    const svc = makeSvc(prisma);
    const result = await svc.listInvitations('inviter-id');
    expect(result.canBulkInvite).toBe(true);
    expect(result).not.toHaveProperty('quota');
    expect(result).not.toHaveProperty('used');
    expect(result.invites[0]).toMatchObject({
      kind: 'reusable',
      signupsCount: 7,
      url: 'https://nigerconnect.app/invite/CODE1',
    });
  });

  it('reports canBulkInvite=false for a regular user', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ canBulkInvite: false }), findManyResult: [] });
    const svc = makeSvc(prisma);
    const result = await svc.listInvitations('inviter-id');
    expect(result.canBulkInvite).toBe(false);
    expect(result.invites).toEqual([]);
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

  it('allows invitation creation when email is verified (no quota anymore)', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true }) });
    const svc = makeSvc(prisma);
    const result = await svc.createInvitation('inviter-id');
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('url');
    expect(result.kind).toBe('single_use');
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

  it('allows creation when inviteAbuseFlags = 2 (below threshold)', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true, inviteAbuseFlags: 2 }) });
    const svc = makeSvc(prisma);
    const result = await svc.createInvitation('inviter-id');
    expect(result).toHaveProperty('code');
  });
});

// ─── 4. Lien réutilisable (droit canBulkInvite) ──────────────────────────────────

describe('InvitationsService — reusable link (mass invite)', () => {
  it('creates a reusable link when the inviter has canBulkInvite', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true, canBulkInvite: true }) });
    const svc = makeSvc(prisma);
    const result = await svc.createInvitation('inviter-id', { kind: 'reusable' });
    expect(result.kind).toBe('reusable');
    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'reusable' }) }),
    );
  });

  it('throws 403 BULK_INVITE_NOT_ALLOWED when reusable requested without the right', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true, canBulkInvite: false }) });
    const svc = makeSvc(prisma);
    await expect(svc.createInvitation('inviter-id', { kind: 'reusable' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.createInvitation('inviter-id', { kind: 'reusable' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BULK_INVITE_NOT_ALLOWED' }),
    });
    expect(prisma.invitation.create).not.toHaveBeenCalled();
  });

  it('ignores the email field for a reusable link (no targetEmail stored)', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true, canBulkInvite: true }) });
    const mailer = makeMailer();
    const svc = makeSvc(prisma, mailer);
    await svc.createInvitation('inviter-id', { kind: 'reusable', email: 'bob@example.com' });
    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetEmail: null }) }),
    );
    await Promise.resolve();
    expect(mailer.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('defaults to single_use when kind omitted', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true, canBulkInvite: false }) });
    const svc = makeSvc(prisma);
    const result = await svc.createInvitation('inviter-id');
    expect(result.kind).toBe('single_use');
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
      expect.objectContaining({ data: expect.objectContaining({ targetEmail: null }) }),
    );
  });

  it('throws NotFoundException when invitation does not belong to caller', async () => {
    const prisma = makePrisma({ invitationRow: makeInvitationRow({ inviterId: 'someone-else' }) });
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
    const prisma = makePrisma({ invitationRow: makeInvitationRow({ status: 'accepted', inviterId: 'inviter-id' }) });
    const svc = makeSvc(prisma);
    await expect(svc.revokeInvitation('inviter-id', 'inv-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

// ─── 6. checkInvitation (public endpoint) ────────────────────────────────────

describe('InvitationsService — checkInvitation', () => {
  it('returns { valid:true, kind, inviterName } for a valid pending single_use code', async () => {
    const prisma = makePrisma();
    prisma.invitation.findUnique = jest.fn(async () => ({
      ...makeInvitationRow({ status: 'pending', kind: 'single_use' }),
      inviter: { displayName: 'Aïcha Maïga', firstName: 'Aïcha', status: 'active', inviteAbuseFlags: 0 },
    }));
    const svc = makeSvc(prisma);
    const result = await svc.checkInvitation('TESTCODE10');
    expect(result).toEqual({ valid: true, kind: 'single_use', inviterName: 'Aïcha Maïga' });
  });

  it('returns { valid:true, kind:"reusable" } for an active reusable link', async () => {
    const prisma = makePrisma();
    prisma.invitation.findUnique = jest.fn(async () => ({
      ...makeInvitationRow({ status: 'pending', kind: 'reusable' }),
      inviter: { displayName: 'Moussa', firstName: 'Moussa', status: 'active', inviteAbuseFlags: 0 },
    }));
    const svc = makeSvc(prisma);
    const result = await svc.checkInvitation('LINKCODE10');
    expect(result).toMatchObject({ valid: true, kind: 'reusable' });
  });

  it('returns { valid:false } for an accepted single_use code', async () => {
    const prisma = makePrisma();
    prisma.invitation.findUnique = jest.fn(async () => ({
      ...makeInvitationRow({ status: 'accepted' }),
      inviter: null,
    }));
    const svc = makeSvc(prisma);
    const result = await svc.checkInvitation('BADCODE');
    expect(result).toEqual({ valid: false });
  });

  it('returns { valid:false } for a revoked link', async () => {
    const prisma = makePrisma();
    prisma.invitation.findUnique = jest.fn(async () => ({
      ...makeInvitationRow({ status: 'revoked', kind: 'reusable' }),
      inviter: null,
    }));
    const svc = makeSvc(prisma);
    expect(await svc.checkInvitation('REVOKED')).toEqual({ valid: false });
  });

  it('returns { valid:false } for a non-existent code', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => null) as any;
    const svc = makeSvc(prisma);
    expect(await svc.checkInvitation('NONEXIST')).toEqual({ valid: false });
  });
});

// ─── 6b. resolveCodeForRegistration HTTP-status discrimination ────────────────

describe('InvitationsService — resolveCodeForRegistration', () => {
  it('throws 400 INVITE_CODE_CONSUMED for an already-accepted single_use code', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => makeInvitationRow({ status: 'accepted' })) as any;
    const svc = makeSvc(prisma);
    await expect(svc.resolveCodeForRegistration('USEDCODE10')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.resolveCodeForRegistration('USEDCODE10')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVITE_CODE_CONSUMED' }),
    });
  });

  it('throws 403 INVALID_INVITE_CODE for a non-existent code', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => null) as any;
    const svc = makeSvc(prisma);
    await expect(svc.resolveCodeForRegistration('NONEXIST10')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.resolveCodeForRegistration('NONEXIST10')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_INVITE_CODE' }),
    });
  });

  it('throws 403 for a revoked code (not 400)', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () => makeInvitationRow({ status: 'revoked' })) as any;
    const svc = makeSvc(prisma);
    await expect(svc.resolveCodeForRegistration('REVOKED100')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns { inviterId, invitationId, kind } for a valid pending single_use code', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () =>
      makeInvitationRow({ status: 'pending', inviterId: 'inv-9', id: 'inv-1', kind: 'single_use' }),
    ) as any;
    const svc = makeSvc(prisma);
    await expect(svc.resolveCodeForRegistration('PENDING100')).resolves.toEqual({
      inviterId: 'inv-9',
      invitationId: 'inv-1',
      kind: 'single_use',
    });
  });

  it('accepts a reusable link (always pending) and returns kind=reusable', async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.invitation.findUnique = jest.fn(async () =>
      makeInvitationRow({ status: 'pending', inviterId: 'inv-9', id: 'link-1', kind: 'reusable' }),
    ) as any;
    const svc = makeSvc(prisma);
    await expect(svc.resolveCodeForRegistration('LINKCODE10')).resolves.toEqual({
      inviterId: 'inv-9',
      invitationId: 'link-1',
      kind: 'reusable',
    });
  });
});

// ─── 7. atomicallyConsumeSingleUse ───────────────────────────────────────────

describe('InvitationsService — atomicallyConsumeSingleUse', () => {
  it('returns 1 when the code is consumed successfully', async () => {
    const prisma = makePrisma({ updateManyCount: 1 });
    const svc = makeSvc(prisma);
    const count = await svc.atomicallyConsumeSingleUse('TESTCODE10', 'new-user-id', prisma as never);
    expect(count).toBe(1);
  });

  it('only targets single_use rows (reusable links never consumed)', async () => {
    const prisma = makePrisma({ updateManyCount: 1 });
    const svc = makeSvc(prisma);
    await svc.atomicallyConsumeSingleUse('TESTCODE10', 'new-user-id', prisma as never);
    expect(prisma.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ kind: 'single_use', status: 'pending' }) }),
    );
  });

  it('returns 0 when the code was already consumed (race lost)', async () => {
    const prisma = makePrisma({ updateManyCount: 0 });
    const svc = makeSvc(prisma);
    const count = await svc.atomicallyConsumeSingleUse('TESTCODE10', 'new-user-id', prisma as never);
    expect(count).toBe(0);
  });

  it('simulates 2 concurrent consumption — only 1 succeeds', async () => {
    const updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = makePrisma();
    prisma.invitation.updateMany = updateMany;
    const svc = makeSvc(prisma);
    const [r1, r2] = await Promise.all([
      svc.atomicallyConsumeSingleUse('TESTCODE10', 'user-A', prisma as never),
      svc.atomicallyConsumeSingleUse('TESTCODE10', 'user-B', prisma as never),
    ]);
    expect([r1, r2].filter((c) => c === 1).length).toBe(1);
    expect([r1, r2].filter((c) => c === 0).length).toBe(1);
  });

  it('purges targetEmail on consume (data-minimization)', async () => {
    const prisma = makePrisma({ updateManyCount: 1 });
    const svc = makeSvc(prisma);
    await svc.atomicallyConsumeSingleUse('TESTCODE10', 'new-user-id', prisma as never);
    expect(prisma.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetEmail: null }) }),
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
    const prismaMock = { appSetting: { findUnique: jest.fn(async () => null), upsert: prismaSet } };
    const { SettingsService: SS } = await import('../common/settings/settings.service');
    const svc = new SS(prismaMock as never, redisMock as never);
    await svc.setSetting('registration_mode', 'invite_only', 'admin-id');
    expect(prismaSet).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'registration_mode' },
        update: expect.objectContaining({ value: 'invite_only' }),
      }),
    );
    expect(redisMock.set).toHaveBeenCalledWith('setting:registration_mode', 'invite_only', 300);
  });

  it('returns cached value from Redis without hitting the DB', async () => {
    const redisMock = { get: jest.fn(async () => 'invite_only'), set: jest.fn(async () => undefined) };
    const prismaMock = { appSetting: { findUnique: jest.fn(async () => null) } };
    const { SettingsService: SS } = await import('../common/settings/settings.service');
    const svc = new SS(prismaMock as never, redisMock as never);
    expect(await svc.getRegistrationMode()).toBe('invite_only');
    expect(prismaMock.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to "open" when both Redis and DB miss', async () => {
    const redisMock = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
    const prismaMock = { appSetting: { findUnique: jest.fn(async () => null) } };
    const { SettingsService: SS } = await import('../common/settings/settings.service');
    const svc = new SS(prismaMock as never, redisMock as never);
    expect(await svc.getRegistrationMode()).toBe('open');
  });
});

// ─── 9. Auth gating — 3 modes × 3 portes + lien reusable ─────────────────────

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
    resolveResult?: { inviterId: string | null; invitationId: string; kind: 'single_use' | 'reusable' };
    consumeCount?: number;
    preValidateEmailResult?: { inviterId: string | null; invitationId: string } | null;
    consumeByEmailResult?: { count: number; inviterId: string | null; invitationId: string | null };
  } = {}) {
    return {
      resolveCodeForRegistration: jest.fn(async () =>
        opts.resolveResult ?? { inviterId: 'inv-id', invitationId: 'inv-1', kind: 'single_use' },
      ),
      atomicallyConsumeSingleUse: jest.fn(async () => opts.consumeCount ?? 1),
      notifyInviter: jest.fn(),
      preValidateEmail: jest.fn(async () => opts.preValidateEmailResult ?? null),
      atomicallyConsumeByEmail: jest.fn(async () =>
        opts.consumeByEmailResult ?? { count: 1, inviterId: 'inv-id', invitationId: 'inv-1' },
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
      { verifyForUser: jest.fn(async () => true) } as never, // MfaService
    );
  }

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
      await expect(
        svc.loginWithOAuth('google', 'google-sub', { email: 'x@y.com', emailVerified: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('allows login for existing Google account (creation branch NOT hit)', async () => {
      const existingUser = { id: 'u-exist', role: 'user', identityStatus: 'not_submitted', firstName: null };
      const prisma = makePrismaAuth({ existingUser });
      const svc = makeAuthSvc('closed', prisma);
      const result = await svc.loginWithOAuth('google', 'google-sub', { email: 'x@y.com', emailVerified: true });
      expect(result.accessToken).toBe('access');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe("mode 'invite_only'", () => {
    it('blocks register without inviteCode and no email-match → 403', async () => {
      const svc = makeAuthSvc('invite_only', makePrismaAuth(), makeInvitesSvc({ preValidateEmailResult: null }));
      await expect(
        svc.register({ email: 'x@y.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does NOT create a user when email-match misses and no code (no bypass)', async () => {
      const prisma = makePrismaAuth();
      const svc = makeAuthSvc('invite_only', prisma, makeInvitesSvc({ preValidateEmailResult: null }));
      await expect(
        svc.register({ email: 'attacker@evil.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B' }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITE_CODE_REQUIRED' }) });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('allows register with valid single_use inviteCode → 201 (consumed)', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        resolveResult: { inviterId: 'inv-id', invitationId: 'inv-1', kind: 'single_use' },
        consumeCount: 1,
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.register({
        email: 'x@y.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B', inviteCode: 'VALIDCODE10',
      });
      expect(result.accessToken).toBe('access');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ invitedById: 'inv-id', invitedViaId: 'inv-1' }),
        }),
      );
      expect(invites.atomicallyConsumeSingleUse).toHaveBeenCalled();
    });

    it('allows register via a REUSABLE link → 201 WITHOUT consuming the link', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        resolveResult: { inviterId: 'host-id', invitationId: 'link-1', kind: 'reusable' },
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.register({
        email: 'x@y.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B', inviteCode: 'LINKCODE10',
      });
      expect(result.accessToken).toBe('access');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ invitedById: 'host-id', invitedViaId: 'link-1' }),
        }),
      );
      // The shared link must stay active for the next signup → never consumed.
      expect(invites.atomicallyConsumeSingleUse).not.toHaveBeenCalled();
    });

    it('allows register via email-match (no code) → 201', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        preValidateEmailResult: { inviterId: 'inv-email-id', invitationId: 'inv-e' },
        consumeByEmailResult: { count: 1, inviterId: 'inv-email-id', invitationId: 'inv-e' },
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.register({
        email: 'invited@example.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B',
      });
      expect(result.accessToken).toBe('access');
      expect(invites.preValidateEmail).toHaveBeenCalledWith('invited@example.com');
      expect(invites.atomicallyConsumeByEmail).toHaveBeenCalled();
    });

    it('blocks register when email-match race: atomicallyConsumeByEmail returns 0', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        preValidateEmailResult: { inviterId: 'inv-email-id', invitationId: 'inv-e' },
        consumeByEmailResult: { count: 0, inviterId: null, invitationId: null },
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      await expect(
        svc.register({ email: 'invited@example.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('code takes precedence over email-match when both are present', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        resolveResult: { inviterId: 'code-inviter-id', invitationId: 'inv-1', kind: 'single_use' },
        consumeCount: 1,
        preValidateEmailResult: { inviterId: 'email-inviter-id', invitationId: 'inv-e' },
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.register({
        email: 'x@y.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B', inviteCode: 'VALIDCODE10',
      });
      expect(result.accessToken).toBe('access');
      expect(invites.resolveCodeForRegistration).toHaveBeenCalledWith('VALIDCODE10');
      expect(invites.preValidateEmail).not.toHaveBeenCalled();
      expect(invites.atomicallyConsumeSingleUse).toHaveBeenCalled();
      expect(invites.atomicallyConsumeByEmail).not.toHaveBeenCalled();
    });

    it('blocks new Google account without inviteCode and no email-match → 403', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({ preValidateEmailResult: null });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      await expect(
        svc.loginWithOAuth('google', 'goog-sub', { email: 'x@y.com', emailVerified: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows new Google account with valid inviteCode → 201', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        resolveResult: { inviterId: 'inv-id', invitationId: 'inv-1', kind: 'single_use' },
        consumeCount: 1,
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.loginWithOAuth(
        'google', 'goog-sub', { email: 'x@y.com', emailVerified: true }, undefined, 'VALIDCODE10',
      );
      expect(result.accessToken).toBe('access');
    });

    it('allows new Google account via a REUSABLE link without consuming it', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        resolveResult: { inviterId: 'host-id', invitationId: 'link-1', kind: 'reusable' },
      });
      const svc = makeAuthSvc('invite_only', prisma, invites);
      const result = await svc.loginWithOAuth(
        'google', 'goog-sub', { email: 'x@y.com', emailVerified: true }, undefined, 'LINKCODE10',
      );
      expect(result.accessToken).toBe('access');
      expect(invites.atomicallyConsumeSingleUse).not.toHaveBeenCalled();
    });

    it('allows login for existing Google account without inviteCode (creation NOT hit)', async () => {
      const existingUser = { id: 'u-exist', role: 'user', identityStatus: 'not_submitted', firstName: null };
      const prisma = makePrismaAuth({ existingUser });
      const svc = makeAuthSvc('invite_only', prisma);
      const result = await svc.loginWithOAuth('google', 'goog-sub', { email: 'x@y.com', emailVerified: true });
      expect(result.accessToken).toBe('access');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe("mode 'open'", () => {
    it('allows register without inviteCode (ignores code)', async () => {
      const svc = makeAuthSvc('open', makePrismaAuth());
      const result = await svc.register({
        email: 'x@y.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B',
      });
      expect(result.accessToken).toBe('access');
    });

    it('does NOT run email-match (no silent consume) in open mode', async () => {
      const prisma = makePrismaAuth();
      const invites = makeInvitesSvc({
        preValidateEmailResult: { inviterId: 'inv-email-id', invitationId: 'inv-e' },
        consumeByEmailResult: { count: 1, inviterId: 'inv-email-id', invitationId: 'inv-e' },
      });
      const svc = makeAuthSvc('open', prisma, invites);
      await svc.register({ email: 'invited@example.com', password: 'Str0ng!Pass1', firstName: 'A', lastName: 'B' });
      expect(invites.preValidateEmail).not.toHaveBeenCalled();
      expect(invites.atomicallyConsumeByEmail).not.toHaveBeenCalled();
      expect(invites.atomicallyConsumeSingleUse).not.toHaveBeenCalled();
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
  it('stores normalized targetEmail when email is provided (single_use)', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true }) });
    const svc = makeSvc(prisma);
    await svc.createInvitation('inviter-id', { email: '  Bob@Example.COM  ' });
    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetEmail: 'bob@example.com' }) }),
    );
  });

  it('calls mailer.sendInvitationEmail (fire-and-forget) when email provided', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true, displayName: 'Moussa Diallo' }) });
    const mailer = makeMailer();
    const svc = makeSvc(prisma, mailer);
    await svc.createInvitation('inviter-id', { email: 'bob@example.com' });
    await Promise.resolve();
    expect(mailer.sendInvitationEmail).toHaveBeenCalledWith(
      'bob@example.com',
      'Moussa Diallo',
      expect.any(String),
      expect.stringContaining('https://nigerconnect.app/invite/'),
    );
  });

  it('does NOT call mailer when no email provided (link-only invite)', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true }) });
    const mailer = makeMailer();
    const svc = makeSvc(prisma, mailer);
    await svc.createInvitation('inviter-id');
    await Promise.resolve();
    expect(mailer.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('does NOT store targetEmail when no email provided', async () => {
    const prisma = makePrisma({ userRow: makeUserRow({ emailVerified: true }) });
    const svc = makeSvc(prisma);
    await svc.createInvitation('inviter-id');
    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetEmail: null }) }),
    );
  });
});

// ─── 11. preValidateEmail ─────────────────────────────────────────────────────

describe('InvitationsService — preValidateEmail', () => {
  it('returns { inviterId, invitationId } when a pending invite targets that email', async () => {
    const prisma = makePrisma({
      findFirstResult: makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9', id: 'inv-1' }),
    });
    const svc = makeSvc(prisma);
    const result = await svc.preValidateEmail('BOB@EXAMPLE.COM');
    expect(result).toEqual({ inviterId: 'inv-9', invitationId: 'inv-1' });
    expect(prisma.invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetEmail: 'bob@example.com', status: 'pending' }),
      }),
    );
  });

  it('returns null when no pending invite targets that email (no-match)', async () => {
    const prisma = makePrisma({ findFirstResult: null });
    const svc = makeSvc(prisma);
    expect(await svc.preValidateEmail('unknown@example.com')).toBeNull();
  });

  it('never throws — absence is a soft null, not an error', async () => {
    const prisma = makePrisma({ findFirstResult: null });
    const svc = makeSvc(prisma);
    await expect(svc.preValidateEmail('notfound@example.com')).resolves.toBeNull();
  });
});

// ─── 12. atomicallyConsumeByEmail — race ─────────────────────────────────────

describe('InvitationsService — atomicallyConsumeByEmail race', () => {
  it('returns count=1, inviterId, invitationId when consume succeeds', async () => {
    const prisma = makePrisma({
      findFirstResult: makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9', id: 'inv-1' }),
      updateManyCount: 1,
    });
    const svc = makeSvc(prisma);
    const result = await svc.atomicallyConsumeByEmail('bob@example.com', 'new-user-id', prisma as never);
    expect(result).toEqual({ count: 1, inviterId: 'inv-9', invitationId: 'inv-1' });
  });

  it('returns count=0 when no invite found for that email', async () => {
    const prisma = makePrisma({ findFirstResult: null });
    const svc = makeSvc(prisma);
    const result = await svc.atomicallyConsumeByEmail('nobody@example.com', 'new-user-id', prisma as never);
    expect(result).toEqual({ count: 0, inviterId: null, invitationId: null });
  });

  it('returns count=0 when the updateMany race is lost (another registration won)', async () => {
    const prisma = makePrisma({
      findFirstResult: makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9', id: 'inv-1' }),
      updateManyCount: 0,
    });
    const svc = makeSvc(prisma);
    const result = await svc.atomicallyConsumeByEmail('bob@example.com', 'new-user-id', prisma as never);
    expect(result).toEqual({ count: 0, inviterId: 'inv-9', invitationId: 'inv-1' });
  });

  it('simulates 2 concurrent registrations via email-match — only 1 wins', async () => {
    const candidate = makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9' });
    const findFirst = jest.fn(async () => candidate);
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const prisma = makePrisma();
    prisma.invitation.findFirst = findFirst;
    prisma.invitation.updateMany = updateMany;
    const svc = makeSvc(prisma);
    const [r1, r2] = await Promise.all([
      svc.atomicallyConsumeByEmail('bob@example.com', 'user-A', prisma as never),
      svc.atomicallyConsumeByEmail('bob@example.com', 'user-B', prisma as never),
    ]);
    expect([r1, r2].filter((r) => r.count === 1).length).toBe(1);
    expect([r1, r2].filter((r) => r.count === 0).length).toBe(1);
  });

  it('purges targetEmail on successful consume (data-minimization)', async () => {
    const prisma = makePrisma({
      findFirstResult: makeInvitationRow({ status: 'pending', targetEmail: 'bob@example.com', inviterId: 'inv-9' }),
      updateManyCount: 1,
    });
    const svc = makeSvc(prisma);
    await svc.atomicallyConsumeByEmail('bob@example.com', 'new-user-id', prisma as never);
    expect(prisma.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetEmail: null }) }),
    );
  });
});

// ─── 13. Expiry cron purges targetEmail (legacy rows) ────────────────────────

describe('InvitationExpiryCron — purges targetEmail on expiry', () => {
  it('sets targetEmail=null when flipping pending→expired', async () => {
    const updateMany = jest.fn(async () => ({ count: 2 }));
    const prisma = { invitation: { updateMany } };
    const { InvitationExpiryCron } = await import('./invitation-expiry.cron');
    const cron = new InvitationExpiryCron(prisma as never);
    await cron.run();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'expired', targetEmail: null }) }),
    );
  });
});
