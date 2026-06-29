import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';

// Lightweight hand-rolled mocks (mirrors auth.service.spec style — no Nest
// TestingModule needed since the service only depends on Prisma/Mailer/Config).
type AnyFn = jest.Mock;

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    newsletterSubscriber: {
      upsert: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    newsletterCampaign: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      delete: jest.fn(async () => ({})),
    },
    user: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    ...overrides,
  };
}

function makeMailer() {
  return { sendNewsletter: jest.fn(async () => undefined) };
}

function makeNotifications() {
  return { create: jest.fn(async () => ({})) };
}

function makeConfig(apiUrl = 'https://api.nigerconnect.app') {
  return { get: jest.fn(() => apiUrl) };
}

function makeSvc(
  prisma = makePrisma(),
  mailer = makeMailer(),
  notifications = makeNotifications(),
) {
  return new NewsletterService(
    prisma as never,
    mailer as never,
    notifications as never,
    makeConfig() as never,
  );
}

describe('NewsletterService', () => {
  describe('subscribe', () => {
    it('upserts with a generated unsubscribe token and reactivates on conflict', async () => {
      const prisma = makePrisma();
      const svc = makeSvc(prisma);
      await svc.subscribe({ email: 'a@b.com', source: 'landing' });

      const upsert = prisma.newsletterSubscriber.upsert as AnyFn;
      expect(upsert).toHaveBeenCalledTimes(1);
      const arg = upsert.mock.calls[0][0];
      expect(arg.where).toEqual({ email: 'a@b.com' });
      expect(arg.create.unsubscribeToken).toMatch(/^[0-9a-f]{64}$/);
      expect(arg.update).toEqual({ status: 'subscribed', unsubscribedAt: null });
    });
  });

  describe('unsubscribe', () => {
    it('returns true when a subscribed row is flipped', async () => {
      const prisma = makePrisma();
      (prisma.newsletterSubscriber.updateMany as AnyFn).mockResolvedValue({ count: 1 });
      const svc = makeSvc(prisma);
      await expect(svc.unsubscribe('tok')).resolves.toBe(true);
    });

    it('returns true for an already-unsubscribed (idempotent) token', async () => {
      const prisma = makePrisma();
      (prisma.newsletterSubscriber.updateMany as AnyFn).mockResolvedValue({ count: 0 });
      (prisma.newsletterSubscriber.findUnique as AnyFn).mockResolvedValue({ id: 'x' });
      const svc = makeSvc(prisma);
      await expect(svc.unsubscribe('tok')).resolves.toBe(true);
    });

    it('returns false for an unknown token', async () => {
      const prisma = makePrisma();
      (prisma.newsletterSubscriber.updateMany as AnyFn).mockResolvedValue({ count: 0 });
      (prisma.newsletterSubscriber.findUnique as AnyFn).mockResolvedValue(null);
      const svc = makeSvc(prisma);
      await expect(svc.unsubscribe('tok')).resolves.toBe(false);
    });
  });

  describe('sendCampaign', () => {
    it('throws NotFound when the campaign does not exist', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue(null);
      const svc = makeSvc(prisma);
      await expect(svc.sendCampaign('id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to re-send a non-draft campaign', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'sent',
      });
      const svc = makeSvc(prisma);
      await expect(svc.sendCampaign('id')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to send with zero subscribers', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
      });
      (prisma.newsletterSubscriber.count as AnyFn).mockResolvedValue(0);
      const svc = makeSvc(prisma);
      await expect(svc.sendCampaign('id')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('atomically claims the draft and reports recipient count', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
        subject: 'Hi',
        bodyHtml: '<p>x</p>',
        bodyText: 'x',
      });
      (prisma.newsletterSubscriber.count as AnyFn).mockResolvedValue(3);
      (prisma.newsletterCampaign.updateMany as AnyFn).mockResolvedValue({ count: 1 });
      // Make the background dispatch a no-op: no subscribers returned.
      (prisma.newsletterSubscriber.findMany as AnyFn).mockResolvedValue([]);
      const svc = makeSvc(prisma);

      const res = await svc.sendCampaign('id');
      expect(res).toEqual({ totalRecipients: 3 });
      const claim = (prisma.newsletterCampaign.updateMany as AnyFn).mock.calls[0][0];
      expect(claim.where).toEqual({ id: 'id', status: 'draft' });
      expect(claim.data.status).toBe('sending');
    });

    it('throws Conflict when the atomic claim loses the race', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
      });
      (prisma.newsletterSubscriber.count as AnyFn).mockResolvedValue(2);
      (prisma.newsletterCampaign.updateMany as AnyFn).mockResolvedValue({ count: 0 });
      const svc = makeSvc(prisma);
      await expect(svc.sendCampaign('id')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('app_users audience', () => {
    it('counts active users (opt-in only) for a non-critical campaign and dispatches in-app notifs', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
        subject: 'Nouveauté',
        bodyHtml: '<p>hi</p>',
        bodyText: 'hi',
        audience: 'app_users',
        critical: false,
      });
      (prisma.user.count as AnyFn).mockResolvedValue(2);
      // One verified user with email, then end of stream.
      (prisma.user.findMany as AnyFn)
        .mockResolvedValueOnce([
          { id: 'u1', email: 'u1@x.com', emailVerified: true, newsletterToken: null },
        ])
        .mockResolvedValue([]);
      const notifications = makeNotifications();
      const svc = makeSvc(prisma, makeMailer(), notifications);

      const res = await svc.sendCampaign('id');
      expect(res).toEqual({ totalRecipients: 2 });
      // Non-critical → recipient WHERE honours the opt-out flag.
      const countWhere = (prisma.user.count as AnyFn).mock.calls[0][0].where;
      expect(countWhere).toEqual({ status: 'active', newsletterOptIn: true });
      // Background dispatch is fire-and-forget — let microtasks drain.
      await new Promise((r) => setImmediate(r));
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', type: 'announcement' }),
      );
    });

    it('critical campaign reaches every active user, ignoring the opt-out', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
        subject: 'Maintenance',
        bodyHtml: '<p>x</p>',
        bodyText: 'x',
        audience: 'app_users',
        critical: true,
      });
      (prisma.user.count as AnyFn).mockResolvedValue(5);
      (prisma.user.findMany as AnyFn).mockResolvedValue([]);
      const svc = makeSvc(prisma);

      await svc.sendCampaign('id');
      const countWhere = (prisma.user.count as AnyFn).mock.calls[0][0].where;
      expect(countWhere).toEqual({ status: 'active' });
    });
  });

  describe('appUnsubscribe', () => {
    it('flips newsletterOptIn off for a known token', async () => {
      const prisma = makePrisma();
      (prisma.user.updateMany as AnyFn).mockResolvedValue({ count: 1 });
      const svc = makeSvc(prisma);
      await expect(svc.appUnsubscribe('tok')).resolves.toBe(true);
      const arg = (prisma.user.updateMany as AnyFn).mock.calls[0][0];
      expect(arg.data).toEqual({ newsletterOptIn: false });
    });
  });

  describe('updateCampaign / deleteCampaign', () => {
    it('updateCampaign rejects a non-draft', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'sent',
      });
      const svc = makeSvc(prisma);
      await expect(svc.updateCampaign('id', { subject: 'x' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('deleteCampaign rejects a non-draft', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'sending',
      });
      const svc = makeSvc(prisma);
      await expect(svc.deleteCampaign('id')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
