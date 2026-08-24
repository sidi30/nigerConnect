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
    notification: {
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
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

// S3 stub: parsePublicKey accepts our CDN host, rejects everything else — enough
// for attachment normalization / presign tests.
function makeS3() {
  return {
    parsePublicKey: jest.fn((url: string) =>
      url.startsWith('https://cdn.nigerconnect.app/') ? url.split('/').slice(3).join('/') : null,
    ),
    createPresignedUpload: jest.fn(async () => ({
      uploadUrl: 'https://cdn.nigerconnect.app/put',
      publicUrl: 'https://cdn.nigerconnect.app/newsletter/x.png',
      key: 'newsletter/x.png',
      bucket: 'public',
      visibility: 'public' as const,
      expiresIn: 600,
      sseRequired: false,
    })),
  };
}

function makeSvc(
  prisma = makePrisma(),
  mailer = makeMailer(),
  notifications = makeNotifications(),
  s3 = makeS3(),
) {
  return new NewsletterService(
    prisma as never,
    mailer as never,
    notifications as never,
    s3 as never,
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

  describe('targeting: segment audience', () => {
    it('builds a segmented WHERE (country/city/verified/ambassador/activeSince) and keeps the opt-out', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
        subject: 'Niamey',
        bodyHtml: '<p>x</p>',
        bodyText: 'x',
        audience: 'segment',
        critical: false,
        segment: {
          countryCode: 'NE',
          city: 'Niamey',
          verifiedOnly: true,
          ambassadorOnly: true,
          activeSince: '2026-01-01T00:00:00.000Z',
        },
        includeEmails: [],
        excludeEmails: [],
      });
      (prisma.user.count as AnyFn).mockResolvedValue(4);
      (prisma.user.findMany as AnyFn).mockResolvedValue([]);
      const svc = makeSvc(prisma);

      const res = await svc.sendCampaign('id');
      expect(res).toEqual({ totalRecipients: 4 });
      const where = (prisma.user.count as AnyFn).mock.calls[0][0].where;
      expect(where).toMatchObject({
        status: 'active',
        newsletterOptIn: true, // non-critical → opt-out always enforced
        countryCode: 'NE',
        city: { equals: 'Niamey', mode: 'insensitive' },
        identityStatus: 'approved',
        isAmbassador: true,
      });
      expect(where.lastLoginAt).toEqual({ gte: new Date('2026-01-01T00:00:00.000Z') });
    });
  });

  describe('targeting: dedup + exclusions', () => {
    it('does not mail an address twice across the subscriber list and the include list', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
        subject: 'Hi',
        bodyHtml: '<p>x</p>',
        bodyText: 'x',
        audience: 'subscribers',
        critical: false,
        includeEmails: ['dup@x.com', 'extra@x.com'],
        excludeEmails: [],
      });
      (prisma.newsletterSubscriber.count as AnyFn).mockResolvedValue(1);
      (prisma.newsletterSubscriber.findMany as AnyFn)
        .mockResolvedValueOnce([{ id: 's1', email: 'DUP@x.com', unsubscribeToken: 't1' }])
        .mockResolvedValue([]);
      const mailer = makeMailer();
      const svc = makeSvc(prisma, mailer);

      await svc.sendCampaign('id');
      await new Promise((r) => setImmediate(r));

      const recipients = (mailer.sendNewsletter as AnyFn).mock.calls.map((c: unknown[]) =>
        String(c[0]).toLowerCase(),
      );
      // dup@x.com present in both sources but mailed once; extra@x.com added once.
      expect(recipients.sort()).toEqual(['dup@x.com', 'extra@x.com']);
    });

    it('honours excludeEmails (individual removal) against the subscriber list', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
        subject: 'Hi',
        bodyHtml: '<p>x</p>',
        bodyText: 'x',
        audience: 'subscribers',
        critical: false,
        includeEmails: [],
        excludeEmails: ['blocked@x.com'],
      });
      (prisma.newsletterSubscriber.count as AnyFn).mockResolvedValue(2);
      (prisma.newsletterSubscriber.findMany as AnyFn)
        .mockResolvedValueOnce([
          { id: 's1', email: 'blocked@x.com', unsubscribeToken: 't1' },
          { id: 's2', email: 'ok@x.com', unsubscribeToken: 't2' },
        ])
        .mockResolvedValue([]);
      const mailer = makeMailer();
      const svc = makeSvc(prisma, mailer);

      await svc.sendCampaign('id');
      await new Promise((r) => setImmediate(r));

      const recipients = (mailer.sendNewsletter as AnyFn).mock.calls.map((c: unknown[]) => c[0]);
      expect(recipients).toEqual(['ok@x.com']);
    });
  });

  describe('targeting: custom audience', () => {
    it('counts only the include list and mails exactly those addresses', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
        subject: 'Custom',
        bodyHtml: '<p>x</p>',
        bodyText: 'x',
        audience: 'custom',
        critical: false,
        includeEmails: ['a@x.com', 'b@x.com'],
        excludeEmails: [],
      });
      const mailer = makeMailer();
      const svc = makeSvc(prisma, mailer);

      const res = await svc.sendCampaign('id');
      expect(res).toEqual({ totalRecipients: 2 });
      // No base audience query for 'custom'.
      expect(prisma.newsletterSubscriber.count).not.toHaveBeenCalled();
      expect(prisma.user.count).not.toHaveBeenCalled();
      await new Promise((r) => setImmediate(r));
      const recipients = (mailer.sendNewsletter as AnyFn).mock.calls.map((c: unknown[]) => c[0]);
      expect(recipients.sort()).toEqual(['a@x.com', 'b@x.com']);
    });

    it('rejects a custom campaign with no included addresses', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.findUnique as AnyFn).mockResolvedValue({
        id: 'id',
        status: 'draft',
        subject: 'Empty',
        bodyHtml: '<p>x</p>',
        bodyText: 'x',
        audience: 'custom',
        critical: false,
        includeEmails: [],
        excludeEmails: [],
      });
      const svc = makeSvc(prisma);
      await expect(svc.sendCampaign('id')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('previewRecipients', () => {
    it('estimates base − excluded + included', async () => {
      const prisma = makePrisma();
      (prisma.newsletterSubscriber.count as AnyFn).mockResolvedValue(10);
      const svc = makeSvc(prisma);
      const n = await svc.previewRecipients({
        audience: 'subscribers',
        critical: false,
        includeEmails: ['a@x.com', 'b@x.com'],
        excludeEmails: ['c@x.com'],
      });
      expect(n).toBe(10 - 1 + 2);
    });
  });

  describe('uploadMedia', () => {
    it('presigns an image upload under the newsletter/ prefix', async () => {
      const s3 = makeS3();
      const svc = makeSvc(makePrisma(), makeMailer(), makeNotifications(), s3);
      const res = await svc.uploadMedia({ contentType: 'image/png' });
      expect(res.publicUrl).toContain('newsletter/');
      const arg = (s3.createPresignedUpload as AnyFn).mock.calls[0][0];
      expect(arg).toMatchObject({ folder: 'newsletter', visibility: 'public' });
    });

    it('rejects a non-image content-type', async () => {
      const svc = makeSvc();
      await expect(svc.uploadMedia({ contentType: 'application/pdf' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('createCampaign', () => {
    it('strips <script> from admin HTML and stores targeting fields', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.create as AnyFn).mockResolvedValue({ id: 'c1' });
      const svc = makeSvc(prisma);
      await svc.createCampaign(
        {
          subject: 'S',
          bodyHtml: '<p>hi</p><script>alert(1)</script>',
          bodyText: 'hi',
          audience: 'segment',
          critical: true,
          segment: { countryCode: 'NE' },
          includeEmails: ['a@x.com'],
          excludeEmails: [],
        } as never,
        'admin1',
      );
      const data = (prisma.newsletterCampaign.create as AnyFn).mock.calls[0][0].data;
      expect(data.bodyHtml).not.toContain('<script');
      expect(data.bodyHtml).toContain('<p>hi</p>');
      expect(data.audience).toBe('segment');
      expect(data.critical).toBe(true); // segment is a user audience → critical kept
      expect(data.segment).toEqual({ countryCode: 'NE' });
      expect(data.includeEmails).toEqual(['a@x.com']);
    });

    it('forces critical=false for a non-user audience', async () => {
      const prisma = makePrisma();
      (prisma.newsletterCampaign.create as AnyFn).mockResolvedValue({ id: 'c1' });
      const svc = makeSvc(prisma);
      await svc.createCampaign(
        {
          subject: 'S',
          bodyHtml: '<p>hi</p>',
          bodyText: 'hi',
          audience: 'subscribers',
          critical: true,
        } as never,
        'admin1',
      );
      const data = (prisma.newsletterCampaign.create as AnyFn).mock.calls[0][0].data;
      expect(data.critical).toBe(false);
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

describe("lecture d'une annonce par un membre", () => {
  const CAMPAIGN = {
    id: '11111111-1111-1111-1111-111111111111',
    subject: 'Qui sont les Nigeriens autour de toi ?',
    bodyText: 'Un texte bien plus long que les 140 caracteres de l apercu.',
    bodyHtml: '<p>Un texte</p>',
    sentAt: new Date('2026-08-24T12:46:00Z'),
  };

  it("refuse une campagne que ce compte n'a pas recue (pas d'IDOR)", async () => {
    const prisma = makePrisma();
    // Aucune notification pour ce couple (utilisateur, campagne).
    prisma.notification.findFirst = jest.fn(async () => null) as AnyFn;
    prisma.newsletterCampaign.findUnique = jest.fn(async () => CAMPAIGN) as AnyFn;

    await expect(
      makeSvc(prisma).getAnnouncementForUser('un-autre-membre', CAMPAIGN.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    // La campagne n'a meme pas ete lue en base.
    expect(prisma.newsletterCampaign.findUnique).not.toHaveBeenCalled();
  });

  it('sert le texte entier a qui a recu la notification', async () => {
    const prisma = makePrisma();
    prisma.notification.findFirst = jest.fn(async () => ({ id: 'n1', read: false })) as AnyFn;
    prisma.newsletterCampaign.findUnique = jest.fn(async () => CAMPAIGN) as AnyFn;

    const out = await makeSvc(prisma).getAnnouncementForUser('membre', CAMPAIGN.id);

    expect(out.bodyText).toBe(CAMPAIGN.bodyText);
    // Ouvrir l'annonce marque la notification comme lue.
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { read: true },
    });
  });

  it("refuse une campagne jamais envoyee, meme avec une notification", async () => {
    const prisma = makePrisma();
    prisma.notification.findFirst = jest.fn(async () => ({ id: 'n1', read: true })) as AnyFn;
    prisma.newsletterCampaign.findUnique = jest.fn(async () => ({
      ...CAMPAIGN,
      sentAt: null,
    })) as AnyFn;

    await expect(
      makeSvc(prisma).getAnnouncementForUser('membre', CAMPAIGN.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
