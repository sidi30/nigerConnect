import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PageService } from './page.service';

function makeDeps() {
  return {
    s3: { assertOwnedPublicImage: jest.fn(async (url: string) => url) },
    geo: { invalidateMarkerCache: jest.fn(async () => undefined) },
    notifications: { create: jest.fn(async () => ({ id: 'n1' })) },
  };
}

function makeService(prisma: unknown) {
  const d = makeDeps();
  // Constructor order mirrors PageService; extra deps are unused by these specs.
  return new PageService(prisma as never, d.notifications as never, d.geo as never, d.s3 as never);
}

/** pageAdmin stub where `actor` holds `role` on the page. */
function prismaWithAdmin(role: string, adminCount: number) {
  return {
    pageAdmin: {
      findUnique: jest.fn(async () => ({ role })),
      count: jest.fn(async () => adminCount),
      upsert: jest.fn(async () => ({ role: 'editor' })),
      delete: jest.fn(async () => ({})),
    },
    user: { findUnique: jest.fn(async () => ({ id: 'me' })) },
  };
}

describe('PageService — page must never be left without an admin', () => {
  it('refuses to remove the last admin', async () => {
    const prisma = prismaWithAdmin('admin', 1);
    const svc = makeService(prisma);

    await expect(svc.removeAdmin('me', 'p1', 'me')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pageAdmin.delete).not.toHaveBeenCalled();
  });

  it('refuses the last admin demoting THEMSELVES to editor', async () => {
    // The bypass this closes: removeAdmin was guarded, setAdmin was not, so the
    // sole admin could step down to `editor` and strand the page — nobody left
    // able to manage admins or delete it.
    const prisma = prismaWithAdmin('admin', 1);
    const svc = makeService(prisma);

    await expect(
      svc.setAdmin('me', 'p1', 'me', { role: 'editor' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pageAdmin.upsert).not.toHaveBeenCalled();
  });

  it('allows stepping down when another admin remains', async () => {
    const prisma = prismaWithAdmin('admin', 2);
    const svc = makeService(prisma);

    await svc.setAdmin('me', 'p1', 'me', { role: 'editor' } as never);

    expect(prisma.pageAdmin.upsert).toHaveBeenCalled();
  });

  it('refuses an editor promoting anyone', async () => {
    const prisma = prismaWithAdmin('editor', 2);
    const svc = makeService(prisma);

    await expect(
      svc.setAdmin('me', 'p1', 'other', { role: 'admin' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.pageAdmin.upsert).not.toHaveBeenCalled();
  });
});
