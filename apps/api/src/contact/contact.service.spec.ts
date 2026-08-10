/**
 * Unit tests — Contact / partenariat
 *
 * Couvre :
 *  1. create : persiste le message + notifie le staff (nom de l'expéditeur résolu)
 *  2. create : un SMTP en panne ne fait PAS perdre le message
 *  3. create : phone absent → null en base
 *  4. list : filtre par statut, 'all' ne filtre pas, pagination par curseur
 *  5. setStatus : 404 si inconnu, trace l'admin, retour à 'new' efface la trace
 *  6. Zod : bornes du formulaire (longueurs, email, champ inconnu rejeté)
 */

import { NotFoundException } from '@nestjs/common';
import { ContactService } from './contact.service';
import { createContactSchema, listContactSchema } from './contact.schemas';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { MailerService } from '../common/mail/mailer.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps() {
  const prisma = {
    contactMessage: {
      create: jest.fn().mockResolvedValue({ id: 'msg-1', createdAt: new Date('2026-08-10') }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      update: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ displayName: 'Ramzi', firstName: 'Ramzi' }),
    },
  } as unknown as PrismaService;

  const mailer = { sendContactNotification: jest.fn().mockResolvedValue(undefined) } as unknown as MailerService;

  return { prisma, mailer, service: new ContactService(prisma, mailer) };
}

const VALID = {
  topic: 'partnership' as const,
  email: 'partenaire@example.com',
  phone: '+33685218270',
  subject: 'Proposition de partenariat',
  message: 'Bonjour, nous aimerions travailler avec NigerConnect.',
};

// ─── 1. create ────────────────────────────────────────────────────────────────

describe('ContactService.create', () => {
  it('persiste le message et notifie le staff avec le nom de l\'expéditeur', async () => {
    const { prisma, mailer, service } = makeDeps();

    const res = await service.create('user-1', VALID);

    expect(res.id).toBe('msg-1');
    expect(prisma.contactMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          topic: 'partnership',
          email: 'partenaire@example.com',
          phone: '+33685218270',
          subject: VALID.subject,
        }),
      }),
    );
    expect(mailer.sendContactNotification).toHaveBeenCalledWith(
      expect.objectContaining({ fromName: 'Ramzi', fromEmail: 'partenaire@example.com' }),
    );
  });

  it('ne perd pas le message si l\'envoi du mail échoue', async () => {
    const { prisma, mailer, service } = makeDeps();
    (mailer.sendContactNotification as jest.Mock).mockRejectedValue(new Error('SMTP down'));

    // Ne throw pas : la demande est déjà en base, consultable dans la console.
    await expect(service.create('user-1', VALID)).resolves.toEqual(
      expect.objectContaining({ id: 'msg-1' }),
    );
    expect(prisma.contactMessage.create).toHaveBeenCalled();
  });

  it('stocke null quand aucun téléphone n\'est fourni', async () => {
    const { prisma, service } = makeDeps();
    const { phone: _phone, ...noPhone } = VALID;

    await service.create('user-1', noPhone);

    expect(prisma.contactMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: null }) }),
    );
  });
});

// ─── 2. list ──────────────────────────────────────────────────────────────────

describe('ContactService.list', () => {
  it('filtre par statut', async () => {
    const { prisma, service } = makeDeps();

    await service.list({ status: 'new', limit: 30 });

    expect(prisma.contactMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'new' } }),
    );
  });

  it("'all' ne filtre pas", async () => {
    const { prisma, service } = makeDeps();

    await service.list({ status: 'all', limit: 30 });

    expect(prisma.contactMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('renvoie un curseur quand il reste des pages', async () => {
    const { prisma, service } = makeDeps();
    // limit+1 lignes → il y a une page suivante.
    (prisma.contactMessage.findMany as jest.Mock).mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);

    const res = await service.list({ status: 'all', limit: 2 });

    expect(res.items).toHaveLength(2);
    expect(res.nextCursor).toBe('b');
  });

  it('ne renvoie pas de curseur sur la dernière page', async () => {
    const { prisma, service } = makeDeps();
    (prisma.contactMessage.findMany as jest.Mock).mockResolvedValue([{ id: 'a' }]);

    const res = await service.list({ status: 'all', limit: 2 });

    expect(res.nextCursor).toBeNull();
  });
});

// ─── 3. setStatus ─────────────────────────────────────────────────────────────

describe('ContactService.setStatus', () => {
  it('404 quand le message n\'existe pas', async () => {
    const { prisma, service } = makeDeps();
    (prisma.contactMessage.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.setStatus('missing-id', 'admin-1', { status: 'read' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('trace l\'admin qui traite le message', async () => {
    const { prisma, service } = makeDeps();

    await service.setStatus('msg-1', 'admin-1', { status: 'handled' });

    expect(prisma.contactMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'handled', handledById: 'admin-1' }),
      }),
    );
  });

  it('repasser en "new" efface la trace de traitement', async () => {
    const { prisma, service } = makeDeps();

    await service.setStatus('msg-1', 'admin-1', { status: 'new' });

    expect(prisma.contactMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'new', handledById: null, handledAt: null }),
      }),
    );
  });
});

// ─── 4. Validation Zod ────────────────────────────────────────────────────────

describe('createContactSchema', () => {
  it('accepte un message valide et normalise l\'email', () => {
    const parsed = createContactSchema.parse({ ...VALID, email: '  PARTENAIRE@Example.COM ' });
    expect(parsed.email).toBe('partenaire@example.com');
  });

  it('rejette un email invalide', () => {
    expect(() => createContactSchema.parse({ ...VALID, email: 'pas-un-email' })).toThrow();
  });

  it('rejette un message trop court ou trop long', () => {
    expect(() => createContactSchema.parse({ ...VALID, message: 'court' })).toThrow();
    expect(() => createContactSchema.parse({ ...VALID, message: 'x'.repeat(4001) })).toThrow();
  });

  it('rejette un sujet hors bornes', () => {
    expect(() => createContactSchema.parse({ ...VALID, subject: 'ab' })).toThrow();
    expect(() => createContactSchema.parse({ ...VALID, subject: 'x'.repeat(141) })).toThrow();
  });

  it('rejette un champ inconnu (.strict)', () => {
    expect(() => createContactSchema.parse({ ...VALID, status: 'handled' })).toThrow();
  });

  it('topic par défaut = info', () => {
    const { topic: _topic, ...noTopic } = VALID;
    expect(createContactSchema.parse(noTopic).topic).toBe('info');
  });
});

describe('listContactSchema', () => {
  it('statut par défaut = new, limite par défaut = 30', () => {
    const parsed = listContactSchema.parse({});
    expect(parsed.status).toBe('new');
    expect(parsed.limit).toBe(30);
  });

  it('borne la limite', () => {
    expect(() => listContactSchema.parse({ limit: 101 })).toThrow();
  });
});
