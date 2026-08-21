import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AssociationService } from './association.service';

function makeNotifsStub() {
  return { create: jest.fn(async () => ({ id: 'n1' })) };
}

function makeGeoStub() {
  return { invalidateMarkerCache: jest.fn(async () => undefined) };
}

// S3 stub: mirrors assertOwnedPublicImage — returns the URL for an owned
// object, throws BadRequest for anything else (foreign host / not owned).
function makeS3Stub() {
  return {
    assertOwnedPublicImage: jest.fn(async (url: string, ownerId?: string) => {
      if (ownerId && !url.includes(`users/${ownerId}/`)) {
        throw new BadRequestException('Media does not belong to you');
      }
      return url;
    }),
  };
}

function makeMailerStub() {
  return { sendAssociationRoleGranted: jest.fn(async () => undefined) };
}

describe('AssociationService', () => {
  it('requires identity verification to create an association', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ identityStatus: 'not_submitted' })) },
    };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      makeS3Stub() as never,
      makeMailerStub() as never,
    );
    await expect(
      svc.create('u1', {
        name: 'A',
        category: 'generaliste',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('conflict when joining twice (already approved)', async () => {
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ userId: 'u1', status: 'approved' })),
      },
    };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      makeS3Stub() as never,
      makeMailerStub() as never,
    );
    await expect(svc.join('u1', 'a1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('conflict when a pending request is already open', async () => {
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ userId: 'u1', status: 'pending' })),
      },
    };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      makeS3Stub() as never,
      makeMailerStub() as never,
    );
    await expect(svc.join('u1', 'a1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('join on approval-required association creates pending membership and notifies admins', async () => {
    const create = jest.fn(async () => ({ userId: 'u1', status: 'pending' }));
    const notifs = makeNotifsStub();
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => null),
        create,
        findMany: jest.fn(async () => [{ userId: 'admin1' }, { userId: 'admin2' }]),
      },
      association: {
        findFirst: jest.fn(async () => ({
          id: 'a1',
          name: 'Club Niamey',
          requiresApproval: true,
        })),
      },
      user: {
        findUnique: jest.fn(async () => ({ displayName: 'Aïcha', firstName: 'Aïcha' })),
      },
    };
    const svc = new AssociationService(
      prisma as never,
      notifs as never,
      makeGeoStub() as never,
      makeS3Stub() as never,
      makeMailerStub() as never,
    );
    const result = (await svc.join('u1', 'a1')) as { pending: boolean };
    expect(result.pending).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending' }) }),
    );
    expect(notifs.create).toHaveBeenCalledTimes(2);
  });

  it('prevents last admin from leaving', async () => {
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ userId: 'u1', role: 'admin', status: 'approved' })),
        count: jest.fn(async () => 1),
        delete: jest.fn(),
      },
      association: { update: jest.fn() },
      $transaction: jest.fn(),
    };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      makeS3Stub() as never,
      makeMailerStub() as never,
    );
    await expect(svc.leave('u1', 'a1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound on unknown association', async () => {
    const prisma = { association: { findFirst: jest.fn(async () => null) } };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      makeS3Stub() as never,
      makeMailerStub() as never,
    );
    await expect(svc.getById('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  // Security regression: a verified creator must not be able to attach a media
  // URL that isn't an object they uploaded (foreign host = SSRF, or another
  // user's key). create() must run logoUrl/coverUrl through assertOwnedPublicImage.
  it('rejects a logo URL not owned by the creator (no unbound media)', async () => {
    const s3 = makeS3Stub();
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ identityStatus: 'approved' })) },
      $transaction: jest.fn(),
    };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      s3 as never,
      makeMailerStub() as never,
    );
    await expect(
      svc.create('u1', {
        name: 'A',
        category: 'generaliste',
        // Points at the CDN but under another user's prefix → must be rejected.
        logoUrl: 'https://cdn.nigerconnect.app/users/someone-else/logo.jpg',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(s3.assertOwnedPublicImage).toHaveBeenCalledWith(
      'https://cdn.nigerconnect.app/users/someone-else/logo.jpg',
      'u1',
    );
    // It must fail BEFORE writing anything.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('binds an owned logo URL through assertOwnedPublicImage on create', async () => {
    const s3 = makeS3Stub();
    const txCreate = jest.fn(async () => ({ id: 'a1' }));
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ identityStatus: 'approved' })) },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          association: { create: txCreate },
          associationMember: { create: jest.fn() },
        }),
      ),
    };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      s3 as never,
      makeMailerStub() as never,
    );
    await svc.create('u1', {
      name: 'A',
      category: 'generaliste',
      logoUrl: 'https://cdn.nigerconnect.app/users/u1/logo.jpg',
    } as never);
    expect(s3.assertOwnedPublicImage).toHaveBeenCalledWith(
      'https://cdn.nigerconnect.app/users/u1/logo.jpg',
      'u1',
    );
  });

  // A5 — the moderation note is written by a PLATFORM admin, about the very
  // people who call PATCH. Returning the raw updated row handed it straight to
  // them, along with the other internals ASSOCIATION_PUBLIC_SELECT documents.
  it('does not hand the moderation note back on update()', async () => {
    const row = {
      id: 'a1',
      name: 'Amicale',
      slug: 'amicale',
      normalizedName: 'amicale',
      verificationNote: 'Statuts douteux, dossier à re-vérifier',
      verifiedById: 'staff1',
      pendingOwnerId: 'u9',
      deletedAt: null,
    };
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ role: 'admin', status: 'approved' })),
      },
      association: {
        // Mirrors Prisma: with a `select`, only the picked columns come back.
        update: jest.fn(async ({ select }: { select?: Record<string, true> }) =>
          select
            ? Object.fromEntries(Object.entries(row).filter(([k]) => select[k]))
            : row,
        ),
      },
    };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      makeS3Stub() as never,
      makeMailerStub() as never,
    );

    const res = await svc.update('u1', 'a1', { name: 'Amicale' } as never);

    expect(res).not.toHaveProperty('verificationNote');
    expect(res).not.toHaveProperty('verifiedById');
    expect(res).not.toHaveProperty('pendingOwnerId');
    expect(res).not.toHaveProperty('normalizedName');
    expect(res).not.toHaveProperty('deletedAt');
    // …while still returning what the caller legitimately edits.
    expect(res).toMatchObject({ id: 'a1', name: 'Amicale' });
  });

  it('refuses the last admin demoting themselves to member', async () => {
    // `leave` already blocks the last admin from walking out; demoting yourself
    // was the unguarded door to the same orphaned-association state.
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ role: 'admin', status: 'approved' })),
        count: jest.fn(async () => 1),
        update: jest.fn(),
      },
      associationRoleAudit: { create: jest.fn(async () => ({})) },
    };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      makeS3Stub() as never,
      makeMailerStub() as never,
    );

    await expect(
      svc.changeRole('me', 'a1', 'me', { role: 'member' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.associationMember.update).not.toHaveBeenCalled();
  });

  it('lets an admin step down when another admin remains', async () => {
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ role: 'admin', status: 'approved' })),
        count: jest.fn(async () => 2),
        update: jest.fn(async () => ({ role: 'member' })),
      },
      associationRoleAudit: { create: jest.fn(async () => ({})) },
    };
    const svc = new AssociationService(
      prisma as never,
      makeNotifsStub() as never,
      makeGeoStub() as never,
      makeS3Stub() as never,
      makeMailerStub() as never,
    );

    await svc.changeRole('me', 'a1', 'me', { role: 'member' } as never);

    expect(prisma.associationMember.update).toHaveBeenCalled();
  });

  // ── A3 — governance ──────────────────────────────────────────────────────
  describe('changeRole — governance (A3)', () => {
    it('an admin cannot change another admin\'s role (403)', async () => {
      const prisma = {
        associationMember: {
          findUnique: jest.fn(async ({ where }: { where: { associationId_userId: { userId: string } } }) => {
            const uid = where.associationId_userId.userId;
            if (uid === 'admin1') return { role: 'admin', status: 'approved' };
            if (uid === 'admin2') return { role: 'admin', status: 'approved' };
            return null;
          }),
        },
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(
        svc.changeRole('admin1', 'a1', 'admin2', { role: 'member' } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('the owner CAN change an admin\'s role, and it is audited + notified', async () => {
      const update = jest.fn(async () => ({ role: 'member' }));
      const auditCreate = jest.fn(async () => ({}));
      const notifs = makeNotifsStub();
      const prisma = {
        associationMember: {
          findUnique: jest.fn(async ({ where }: { where: { associationId_userId: { userId: string } } }) => {
            const uid = where.associationId_userId.userId;
            if (uid === 'owner1') return { role: 'owner', status: 'approved' };
            if (uid === 'admin2') return { role: 'admin', status: 'approved' };
            return null;
          }),
          update,
          count: jest.fn(async () => 2),
        },
        associationRoleAudit: { create: auditCreate },
      };
      const svc = new AssociationService(
        prisma as never,
        notifs as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.changeRole('owner1', 'a1', 'admin2', { role: 'member' } as never);
      expect(update).toHaveBeenCalled();
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fromRole: 'admin', toRole: 'member', actorId: 'owner1', targetUserId: 'admin2' }),
        }),
      );
      expect(notifs.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin2', type: 'association_role_changed' }),
      );
    });

    it('nobody can touch the owner through changeRole — must use the ownership transfer flow', async () => {
      const prisma = {
        associationMember: {
          findUnique: jest.fn(async ({ where }: { where: { associationId_userId: { userId: string } } }) => {
            const uid = where.associationId_userId.userId;
            if (uid === 'admin1') return { role: 'admin', status: 'approved' };
            if (uid === 'owner1') return { role: 'owner', status: 'approved' };
            return null;
          }),
        },
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(
        svc.changeRole('admin1', 'a1', 'owner1', { role: 'member' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('counts only APPROVED holders when guarding the last admin/owner', async () => {
      // Twin of the leave() guard: a leftover non-approved row carrying an
      // elevated role would pass for a second responsible member and let the
      // real last one step down, leaving the association headless — the same
      // exit A2 blocks at the door, taken through the other one.
      const count = jest.fn(async () => 2);
      const prisma = {
        associationMember: {
          findUnique: jest.fn(async () => ({ role: 'admin', status: 'approved' })),
          count,
          update: jest.fn(async () => ({ role: 'member' })),
        },
        associationRoleAudit: { create: jest.fn(async () => ({})) },
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.changeRole('me', 'a1', 'me', { role: 'member' } as never);
      expect(count).toHaveBeenCalledWith({
        where: { associationId: 'a1', status: 'approved', role: { in: ['owner', 'admin'] } },
      });
    });
  });

  describe('ownership transfer (A3)', () => {
    it('acceptOwnershipTransfer promotes the invitee and demotes the previous owner to admin', async () => {
      const memberUpdate = jest.fn(async () => ({}));
      const auditCreate = jest.fn(async () => ({}));
      const notifs = makeNotifsStub();
      const tx = {
        associationMember: {
          update: memberUpdate,
          findFirst: jest.fn(async () => ({ userId: 'oldOwner' })),
        },
        associationRoleAudit: { create: auditCreate },
        association: { updateMany: jest.fn(async () => ({ count: 1 })) },
      };
      const prisma = {
        association: {
          findUnique: jest.fn(async () => ({ id: 'a1', name: 'Asso', pendingOwnerId: 'newOwner' })),
        },
        associationMember: {
          findUnique: jest.fn(async () => ({ role: 'admin', status: 'approved' })),
        },
        $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      };
      const svc = new AssociationService(
        prisma as never,
        notifs as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      const result = await svc.acceptOwnershipTransfer('newOwner', 'a1');
      expect(result).toEqual({ transferred: true });
      expect(memberUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { associationId_userId: { associationId: 'a1', userId: 'newOwner' } },
          data: { role: 'owner' },
        }),
      );
      expect(memberUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { associationId_userId: { associationId: 'a1', userId: 'oldOwner' } },
          data: { role: 'admin' },
        }),
      );
      expect(notifs.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'oldOwner' }));
    });

    it('rejects acceptOwnershipTransfer for anyone but the pending invitee', async () => {
      const prisma = {
        association: { findUnique: jest.fn(async () => ({ id: 'a1', name: 'Asso', pendingOwnerId: 'expected' })) },
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(svc.acceptOwnershipTransfer('someone-else', 'a1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a stale accept whose offer was withdrawn or re-pointed mid-flight', async () => {
      // TOCTOU: the pre-flight read still sees this user as `pendingOwnerId`,
      // but by the time the write runs the owner has cancelled (or offered to
      // somebody else) — the conditional claim matches 0 rows and nothing is
      // written. Before the CAS, this accept went through and took the
      // association from an owner who had already withdrawn the offer.
      const memberUpdate = jest.fn(async () => ({}));
      const claim = jest.fn(async () => ({ count: 0 }));
      const tx = {
        associationMember: { update: memberUpdate, findFirst: jest.fn(async () => null) },
        associationRoleAudit: { create: jest.fn(async () => ({})) },
        association: { updateMany: claim },
      };
      const prisma = {
        association: {
          findUnique: jest.fn(async () => ({ id: 'a1', name: 'Asso', pendingOwnerId: 'racer' })),
        },
        associationMember: {
          findUnique: jest.fn(async () => ({ role: 'member', status: 'approved' })),
        },
        $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(svc.acceptOwnershipTransfer('racer', 'a1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(claim).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'a1', pendingOwnerId: 'racer' } }),
      );
      expect(memberUpdate).not.toHaveBeenCalled();
    });
  });

  // ── A1 (course-corrected) — the roster is open by default ────────────────
  describe('listMembers (A1)', () => {
    it('is visible to a non-member by default (membersVisibility public)', async () => {
      const findMany = jest.fn(async () => []);
      const findUnique = jest.fn(async () => null); // the caller is NOT a member of a1
      const prisma = {
        association: {
          findFirst: jest.fn(async () => ({ id: 'a1', membersVisibility: 'public' })),
        },
        associationMember: { findUnique, findMany },
        block: { findMany: jest.fn(async () => []) },
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(svc.listMembers('stranger', 'a1')).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      // The whole point of the correction: no approved-membership check ran.
      expect(findUnique).not.toHaveBeenCalled();
      expect(findMany).toHaveBeenCalled();
    });

    it('members_only reinstates the approved-member gate for a non-member', async () => {
      const prisma = {
        association: {
          findFirst: jest.fn(async () => ({ id: 'a1', membersVisibility: 'members_only' })),
        },
        associationMember: { findUnique: jest.fn(async () => null) },
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(svc.listMembers('stranger', 'a1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('members_only still lets an approved member through', async () => {
      const findMany = jest.fn(async () => []);
      const prisma = {
        association: {
          findFirst: jest.fn(async () => ({ id: 'a1', membersVisibility: 'members_only' })),
        },
        associationMember: {
          findUnique: jest.fn(async () => ({ status: 'approved' })),
          findMany,
        },
        block: { findMany: jest.fn(async () => []) },
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(svc.listMembers('member1', 'a1')).resolves.toEqual({ items: [], nextCursor: null });
      expect(findMany).toHaveBeenCalled();
    });

    it('404s when the association does not exist (or was soft-deleted)', async () => {
      const prisma = { association: { findFirst: jest.fn(async () => null) } };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(svc.listMembers('viewer1', 'a1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['public', 'members_only'] as const)(
      'excludes private-privacy members and filters blocks in both directions (membersVisibility=%s)',
      async (membersVisibility) => {
        const findMany = jest.fn(async () => []);
        const prisma = {
          association: {
            findFirst: jest.fn(async () => ({ id: 'a1', membersVisibility })),
          },
          associationMember: {
            findUnique: jest.fn(async () => ({ status: 'approved' })), // satisfies members_only too
            findMany,
          },
          // one block I placed, one block placed ON me — both must end up excluded.
          block: {
            findMany: jest.fn(async () => [
              { blockerId: 'viewer1', blockedId: 'iBlockedThem' },
              { blockerId: 'theyBlockedMe', blockedId: 'viewer1' },
            ]),
          },
        };
        const svc = new AssociationService(
          prisma as never,
          makeNotifsStub() as never,
          makeGeoStub() as never,
          makeS3Stub() as never,
          makeMailerStub() as never,
        );
        await svc.listMembers('viewer1', 'a1');
        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              associationId: 'a1',
              status: 'approved',
              user: expect.objectContaining({
                privacyLevel: { not: 'private' },
                id: { notIn: expect.arrayContaining(['iBlockedThem', 'theyBlockedMe']) },
              }),
            }),
          }),
        );
      },
    );

    it('no longer filters out animated accounts (they stay in memberCount too — hiding them would leak by subtraction)', async () => {
      type FindManyArgs = { where: { user: Record<string, unknown> } };
      const findMany = jest.fn(async (_args: FindManyArgs) => []);
      const prisma = {
        association: {
          findFirst: jest.fn(async () => ({ id: 'a1', membersVisibility: 'public' })),
        },
        associationMember: { findUnique: jest.fn(async () => null), findMany },
        block: { findMany: jest.fn(async () => []) },
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.listMembers('viewer1', 'a1');
      expect(findMany.mock.calls[0]![0].where.user).not.toHaveProperty('isAnimated');
    });

    it('memberCount stays public and is always projected, independent of membersVisibility', async () => {
      type FindFirstArgs = { select: Record<string, unknown> };
      const findFirst = jest.fn(async (_args: FindFirstArgs) => ({
        id: 'a1',
        membersVisibility: 'members_only',
        memberCount: 42,
      }));
      const prisma = { association: { findFirst } };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.getById('a1');
      expect(findFirst.mock.calls[0]![0].select).toMatchObject({ memberCount: true });
    });
  });

  // ── generic role capability, for consumers outside this module ───────────
  describe('isLeaderOfAnyAssociation', () => {
    it('is true when the user runs (owner/admin of) at least one non-dissolved association', async () => {
      const count = jest.fn(async () => 1);
      const prisma = { associationMember: { count } };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(svc.isLeaderOfAnyAssociation('user1')).resolves.toBe(true);
      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user1',
            status: 'approved',
            role: { in: ['owner', 'admin'] },
            association: { deletedAt: null },
          }),
        }),
      );
    });

    it('narrows to a country when passed, and is false with zero matches', async () => {
      const count = jest.fn(async () => 0);
      const prisma = { associationMember: { count } };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(
        svc.isLeaderOfAnyAssociation('user1', { countryCode: 'NE' }),
      ).resolves.toBe(false);
      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            association: { deletedAt: null, countryCode: 'NE' },
          }),
        }),
      );
    });
  });

  // ── A2 — no orphaned association on account deletion ─────────────────────
  describe('reassignOwnershipBeforeDeletion (A2)', () => {
    it('promotes the oldest moderator, PRESERVING the owner role, and audits it', async () => {
      const update = jest.fn(async () => ({}));
      const tx = {
        associationMember: {
          findMany: jest.fn(async () => [{ associationId: 'a1', role: 'owner' }]),
          count: jest.fn(async () => 0), // nobody else with an elevated role remains
          findFirst: jest.fn(
            async ({ where }: { where: { role: string } }) =>
              where.role === 'moderator' ? { userId: 'mod1', role: 'moderator' } : null,
          ),
          update,
        },
        associationRoleAudit: { create: jest.fn(async () => ({})) },
        association: { findUnique: jest.fn(async () => ({ name: 'Asso Test' })) },
      };
      const svc = new AssociationService(
        {} as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      const events = await svc.reassignOwnershipBeforeDeletion(tx as never, 'departing');
      expect(events).toEqual([
        { kind: 'transferred', associationId: 'a1', associationName: 'Asso Test', successorId: 'mod1', newRole: 'owner' },
      ]);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: 'owner' } }),
      );
    });

    it('falls back to the oldest member when there is no moderator', async () => {
      const tx = {
        associationMember: {
          findMany: jest.fn(async () => [{ associationId: 'a1', role: 'admin' }]),
          count: jest.fn(async () => 0),
          findFirst: jest.fn(
            async ({ where }: { where: { role: string } }) =>
              where.role === 'member' ? { userId: 'member1', role: 'member' } : null,
          ),
          update: jest.fn(async () => ({})),
        },
        associationRoleAudit: { create: jest.fn(async () => ({})) },
        association: { findUnique: jest.fn(async () => ({ name: 'Asso Test' })) },
      };
      const svc = new AssociationService(
        {} as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      const events = await svc.reassignOwnershipBeforeDeletion(tx as never, 'departing');
      // The departing user was a plain 'admin' (not owner) — the successor
      // becomes 'admin', not 'owner'.
      expect(events).toEqual([
        { kind: 'transferred', associationId: 'a1', associationName: 'Asso Test', successorId: 'member1', newRole: 'admin' },
      ]);
    });

    it('soft-deletes the association when nobody else remains at all — the exact A2 regression scenario', async () => {
      const associationUpdate = jest.fn(async () => ({}));
      const tx = {
        associationMember: {
          findMany: jest.fn(async () => [{ associationId: 'a1', role: 'admin' }]),
          count: jest.fn(async () => 0),
          findFirst: jest.fn(async () => null),
        },
        association: { update: associationUpdate },
      };
      const svc = new AssociationService(
        {} as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      const events = await svc.reassignOwnershipBeforeDeletion(tx as never, 'lastAdmin');
      expect(events).toEqual([{ kind: 'dissolved', associationId: 'a1' }]);
      expect(associationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });

    it('does nothing when another elevated member still runs the association', async () => {
      const tx = {
        associationMember: {
          findMany: jest.fn(async () => [{ associationId: 'a1', role: 'admin' }]),
          count: jest.fn(async () => 1), // another admin/owner remains
        },
      };
      const svc = new AssociationService(
        {} as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      const events = await svc.reassignOwnershipBeforeDeletion(tx as never, 'departing');
      expect(events).toEqual([]);
    });

    it('notifyOwnershipEvents sends an in-app notification + email for a transferred seat', async () => {
      const notifs = makeNotifsStub();
      const mailer = makeMailerStub();
      const prisma = {
        user: { findUnique: jest.fn(async () => ({ email: 'mod@x.com', emailVerified: true, firstName: 'Aïcha' })) },
      };
      const svc = new AssociationService(
        prisma as never,
        notifs as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        mailer as never,
      );
      await svc.notifyOwnershipEvents([
        { kind: 'transferred', associationId: 'a1', associationName: 'Asso', successorId: 'mod1', newRole: 'owner' },
      ]);
      expect(notifs.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'mod1' }));
      expect(mailer.sendAssociationRoleGranted).toHaveBeenCalledWith('mod@x.com', 'owner', 'Asso', 'Aïcha');
    });
  });

  // ── A4 — bureau exécutif ──────────────────────────────────────────────────
  describe('bureau exécutif (A4)', () => {
    it('designateOfficer requires the actor to be admin/owner', async () => {
      const prisma = { associationMember: { findUnique: jest.fn(async () => ({ role: 'member', status: 'approved' })) } };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(
        svc.designateOfficer('u1', 'a1', { userId: 'u2', title: 'treasurer' } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates an unaccepted seat and notifies the target — not publicly visible yet', async () => {
      const create = jest.fn(async () => ({ id: 'off1', acceptedAt: null }));
      const notifs = makeNotifsStub();
      const prisma = {
        associationMember: {
          findUnique: jest.fn(async ({ where }: { where: { associationId_userId: { userId: string } } }) =>
            where.associationId_userId.userId === 'admin1'
              ? { role: 'admin', status: 'approved' }
              : { status: 'approved' },
          ),
        },
        associationOfficer: { findUnique: jest.fn(async () => null), create },
        association: { findUnique: jest.fn(async () => ({ name: 'Asso' })) },
      };
      const svc = new AssociationService(
        prisma as never,
        notifs as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      const officer = await svc.designateOfficer('admin1', 'a1', {
        userId: 'u2',
        title: 'treasurer',
      } as never);
      expect(officer.acceptedAt).toBeNull();
      expect(notifs.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u2', type: 'association_officer_invite' }),
      );
    });

    it('acceptOfficerSeat sets acceptedAt — the consent gate before public exposure', async () => {
      const update = jest.fn(async () => ({ acceptedAt: new Date() }));
      const prisma = {
        associationOfficer: { findUnique: jest.fn(async () => ({ acceptedAt: null })), update },
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.acceptOfficerSeat('u2', 'a1');
      expect(update).toHaveBeenCalled();
    });

    it('listOfficers only ever returns ACCEPTED seats', async () => {
      const findMany = jest.fn(async () => []);
      const prisma = { associationOfficer: { findMany } };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.listOfficers('a1');
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            associationId: 'a1',
            acceptedAt: { not: null },
            association: { deletedAt: null },
          },
        }),
      );
    });
  });

  // ── A1 — the founder is part of the roster, not a public byline ──────────
  describe('getById / list — no nominative leak (A1)', () => {
    it('never selects the founder identity on the public read path', async () => {
      type SelectArg = { select: Record<string, unknown> };
      const findFirst = jest.fn(async (_args: SelectArg) => ({ id: 'a1' }));
      const prisma = { association: { findFirst } };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.getById('a1');
      const select = findFirst.mock.calls[0]![0].select;
      // Gating the roster is pointless if every read still names the one member
      // who matters most — for a `religieux` association (RGPD art.9), "who
      // founded it" is the single most sensitive membership fact.
      expect(select.createdBy).toBeUndefined();
      expect(select.createdById).toBeUndefined();
      // …and the internals behind the badge / a transfer in progress stay in.
      expect(select.verifiedById).toBeUndefined();
      expect(select.verificationNote).toBeUndefined();
      expect(select.pendingOwnerId).toBeUndefined();
      // The public counter is untouched — only the nominative list is gated.
      expect(select.memberCount).toBe(true);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'a1', deletedAt: null } }),
      );
    });

    it('list() exposes memberCount but no founder id', async () => {
      const findMany = jest.fn(async (_args: { select: Record<string, unknown> }) => []);
      const prisma = { association: { findMany } };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.list({ limit: 20 } as never);
      const select = findMany.mock.calls[0]![0].select;
      expect(select.createdById).toBeUndefined();
      expect(select.memberCount).toBe(true);
    });
  });

  // ── leave() — the public counter and the board seat ───────────────────────
  describe('leave — counter integrity and board seat (A4)', () => {
    function svcFor(member: Record<string, unknown>) {
      const calls: unknown[] = [];
      const prisma = {
        associationMember: {
          findUnique: jest.fn(async () => member),
          count: jest.fn(async () => 3),
          delete: jest.fn((args: unknown) => {
            calls.push({ op: 'member.delete', args });
            return args;
          }),
        },
        associationOfficer: {
          deleteMany: jest.fn((args: unknown) => {
            calls.push({ op: 'officer.deleteMany', args });
            return args;
          }),
        },
        association: {
          update: jest.fn((args: unknown) => {
            calls.push({ op: 'association.update', args });
            return args;
          }),
        },
        $transaction: jest.fn(async () => []),
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      return { svc, prisma, calls };
    }

    it('does NOT decrement memberCount when withdrawing a request that was never counted', async () => {
      // join() only increments on auto-approve; a `pending` row never counted.
      // Decrementing on the way out let anyone run join → leave → join → leave
      // on an approval-gated association and drive its PUBLIC member count
      // arbitrarily negative.
      const { svc, prisma, calls } = svcFor({ userId: 'u1', role: 'member', status: 'pending' });
      await svc.leave('u1', 'a1');
      expect(prisma.association.update).not.toHaveBeenCalled();
      expect(calls.some((c) => (c as { op: string }).op === 'member.delete')).toBe(true);
    });

    it('still decrements for an approved member', async () => {
      const { svc, prisma } = svcFor({ userId: 'u1', role: 'member', status: 'approved' });
      await svc.leave('u1', 'a1');
      expect(prisma.association.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { memberCount: { decrement: 1 } } }),
      );
    });

    it('drops the board seat with the membership it rested on', async () => {
      const { svc, prisma } = svcFor({ userId: 'u1', role: 'member', status: 'approved' });
      await svc.leave('u1', 'a1');
      expect(prisma.associationOfficer.deleteMany).toHaveBeenCalledWith({
        where: { associationId: 'a1', userId: 'u1' },
      });
    });

    it('counts only APPROVED holders when guarding the last admin/owner', async () => {
      const { svc, prisma } = svcFor({ userId: 'u1', role: 'owner', status: 'approved' });
      await svc.leave('u1', 'a1');
      expect(prisma.associationMember.count).toHaveBeenCalledWith({
        where: { associationId: 'a1', status: 'approved', role: { in: ['owner', 'admin'] } },
      });
    });
  });

  // ── A6 — anti-squat ───────────────────────────────────────────────────────
  describe('create() — anti-squat (A6)', () => {
    it('rejects a duplicate association name with 409', async () => {
      const prisma = {
        user: { findUnique: jest.fn(async () => ({ identityStatus: 'approved' })) },
        $transaction: jest.fn(async () => {
          const err = new Error('unique violation') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }),
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await expect(
        svc.create('u1', { name: 'Dup', category: 'generaliste' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('the founder gets role owner, not admin', async () => {
      const memberCreate = jest.fn(async () => ({}));
      const prisma = {
        user: { findUnique: jest.fn(async () => ({ identityStatus: 'approved' })) },
        $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
          cb({
            association: { create: jest.fn(async () => ({ id: 'a1' })) },
            associationMember: { create: memberCreate },
          }),
        ),
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.create('u1', { name: 'A', category: 'generaliste' } as never);
      expect(memberCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'owner' }) }),
      );
    });

    it('computes a URL-safe slug from the name', async () => {
      const assocCreate = jest.fn(async () => ({ id: 'a1' }));
      const prisma = {
        user: { findUnique: jest.fn(async () => ({ identityStatus: 'approved' })) },
        $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
          cb({
            association: { create: assocCreate },
            associationMember: { create: jest.fn() },
          }),
        ),
      };
      const svc = new AssociationService(
        prisma as never,
        makeNotifsStub() as never,
        makeGeoStub() as never,
        makeS3Stub() as never,
        makeMailerStub() as never,
      );
      await svc.create('u1', { name: 'Café Niamey !', category: 'generaliste' } as never);
      expect(assocCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'cafe-niamey', normalizedName: 'cafe-niamey' }),
        }),
      );
    });
  });
});
