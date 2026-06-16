import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../common/settings/settings.service';
import { NotificationService } from '../notification/notification.service';
import { MailerService } from '../common/mail/mailer.service';
import type { CreateInvitationDto } from './invitations.schemas';

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 10;
const INVITE_URL_BASE = 'https://nigerconnect.app/invite';

/** ~59 bits of entropy: sufficient to make enumeration brute-force infeasible,
 *  especially with the hard @Throttle on the check endpoint. */
function generateBase62Code(length = CODE_LENGTH): string {
  const bytes = randomBytes(length * 2); // oversample; 2 bytes → 1 valid char
  let result = '';
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    const idx = byte % 62;
    // Reject indices ≥ 62 to avoid modulo bias
    if (byte >= 62 * Math.floor(256 / 62)) continue;
    result += BASE62_CHARS[idx];
  }
  // If we didn't get enough chars (very rare), recurse
  if (result.length < length) return generateBase62Code(length);
  return result;
}

/** Maximum retries on P2002 (unique code collision — astronomically rare). */
const MAX_CODE_RETRIES = 5;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly mailer: MailerService,
  ) {}

  // ── Quota computation (§3) ─────────────────────────────────────────
  // Derived by count, never a stored counter — always accurate, never skewed.

  async computeUsedSlots(inviterId: string): Promise<number> {
    const now = new Date();
    return this.prisma.invitation.count({
      where: {
        inviterId,
        OR: [
          { status: 'accepted' },
          {
            status: 'pending',
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        ],
      },
    });
  }

  // ── POST /invitations ──────────────────────────────────────────────

  async createInvitation(
    inviterId: string,
    dto: CreateInvitationDto = {},
  ): Promise<{
    id: string;
    code: string;
    url: string;
    expiresAt: Date | null;
  }> {
    // 1. Load inviter (needed for emailVerified + quota + abuse flags + name for email)
    const inviter = await this.prisma.user.findUniqueOrThrow({
      where: { id: inviterId },
      select: {
        emailVerified: true,
        inviteQuota: true,
        inviteAbuseFlags: true,
        displayName: true,
        firstName: true,
      },
    });

    // 2. email-verified gate (§3)
    if (!inviter.emailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Tu dois vérifier ton email avant de pouvoir inviter.',
      });
    }

    // 3. Abuse-flag freeze (§3)
    const ABUSE_THRESHOLD = 3;
    if (inviter.inviteAbuseFlags >= ABUSE_THRESHOLD) {
      throw new ForbiddenException({
        code: 'INVITE_QUOTA_FROZEN',
        message: 'Ton quota d\'invitations est gelé suite à des abus signalés.',
      });
    }

    // 4. Quota check (derived by count, §3)
    const used = await this.computeUsedSlots(inviterId);
    if (used >= inviter.inviteQuota) {
      throw new ForbiddenException({
        code: 'INVITE_QUOTA_EXCEEDED',
        message: `Tu as utilisé tous tes slots d'invitation (${inviter.inviteQuota}/${inviter.inviteQuota}).`,
      });
    }

    // 5. Resolve expiry from settings
    const expiryDays = await this.settings.getInviteExpiryDays();
    const expiresAt = new Date(Date.now() + expiryDays * 86_400_000);

    // 5b. Normalize target email (data-minimization: only stored while pending)
    const targetEmail = dto.email ? dto.email.trim().toLowerCase() : null;

    // 6. Generate unique code with retry on P2002 — and re-check the quota
    //    INSIDE a Serializable transaction so two concurrent POST /invitations
    //    can't both pass the count-then-create check and overshoot the quota
    //    (TOCTOU). The pre-checks above (steps 2–4) give a fast, friendly error
    //    on the common path; the transactional re-count is the authoritative
    //    guard against the race. Serializable makes Postgres abort the loser of
    //    a concurrent insert (the phantom row changes the count), which surfaces
    //    as a P2034 serialization failure we retry.
    const quota = inviter.inviteQuota;
    let invitation: Awaited<ReturnType<typeof this.prisma.invitation.create>> | null = null;
    for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
      const code = generateBase62Code();
      try {
        invitation = await this.prisma.$transaction(
          async (tx) => {
            const usedNow = await tx.invitation.count({
              where: {
                inviterId,
                OR: [
                  { status: 'accepted' },
                  {
                    status: 'pending',
                    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                  },
                ],
              },
            });
            if (usedNow >= quota) {
              throw new ForbiddenException({
                code: 'INVITE_QUOTA_EXCEEDED',
                message: `Tu as utilisé tous tes slots d'invitation (${quota}/${quota}).`,
              });
            }
            return tx.invitation.create({ data: { inviterId, code, expiresAt, targetEmail } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          this.logger.warn(`Invite code collision on attempt ${attempt + 1}, retrying`);
          continue;
        }
        // P2034 = transaction failed due to a write conflict / serialization
        // failure (the concurrent-insert race we guard against) — retry.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
          this.logger.warn(`Invite create serialization conflict on attempt ${attempt + 1}, retrying`);
          continue;
        }
        throw e;
      }
    }

    if (!invitation) {
      throw new Error('Failed to generate a unique invitation code after retries');
    }

    const url = `${INVITE_URL_BASE}/${invitation.code}`;

    // 7. Fire-and-forget invitation email when a target email was provided.
    //    A mail outage must never block the POST /invitations response.
    if (targetEmail) {
      const inviterName = inviter.displayName ?? inviter.firstName ?? 'Quelqu\'un';
      void this.mailer
        .sendInvitationEmail(targetEmail, inviterName, invitation.code, url)
        .catch((e) =>
          this.logger.warn(
            `Failed to send invitation email to ${targetEmail}: ${String(e)}`,
          ),
        );
    }

    return {
      id: invitation.id,
      code: invitation.code,
      url,
      expiresAt: invitation.expiresAt,
    };
  }

  // ── GET /invitations ───────────────────────────────────────────────

  async listInvitations(inviterId: string): Promise<{
    quota: number;
    used: number;
    available: number;
    invites: Array<{
      id: string;
      code: string;
      url: string;
      status: string;
      acceptedBy: { id: string; displayName: string | null; avatarUrl: string | null } | null;
      createdAt: Date;
      expiresAt: Date | null;
    }>;
  }> {
    const inviter = await this.prisma.user.findUniqueOrThrow({
      where: { id: inviterId },
      select: { inviteQuota: true },
    });

    const [used, invites] = await Promise.all([
      this.computeUsedSlots(inviterId),
      this.prisma.invitation.findMany({
        where: { inviterId },
        orderBy: { createdAt: 'desc' },
        include: {
          acceptedBy: {
            select: { id: true, displayName: true, avatarUrl: true },
          },
        },
      }),
    ]);

    return {
      quota: inviter.inviteQuota,
      used,
      available: Math.max(0, inviter.inviteQuota - used),
      invites: invites.map((inv) => ({
        id: inv.id,
        code: inv.code,
        url: `${INVITE_URL_BASE}/${inv.code}`,
        status: inv.status,
        acceptedBy: inv.acceptedBy
          ? { id: inv.acceptedBy.id, displayName: inv.acceptedBy.displayName, avatarUrl: inv.acceptedBy.avatarUrl }
          : null,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
      })),
    };
  }

  // ── POST /invitations/:id/revoke ───────────────────────────────────

  async revokeInvitation(inviterId: string, invitationId: string): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation || invitation.inviterId !== inviterId) {
      throw new NotFoundException('Invitation introuvable.');
    }

    if (invitation.status !== 'pending') {
      throw new ConflictException({
        code: 'INVITATION_NOT_REVOCABLE',
        message: `L'invitation est déjà ${invitation.status === 'accepted' ? 'acceptée' : invitation.status}.`,
      });
    }

    // Purge targetEmail on revoke (data-minimization: we keep a third party's
    // email only while the invite is live/pending).
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'revoked', revokedAt: new Date(), targetEmail: null },
    });
    // Slot is automatically refunded because computeUsedSlots excludes revoked/expired rows.
  }

  // ── GET /invitations/check ─────────────────────────────────────────

  async checkInvitation(code: string): Promise<{ valid: boolean; inviterName?: string }> {
    const now = new Date();
    const invitation = await this.prisma.invitation.findUnique({
      where: { code },
      include: {
        inviter: { select: { displayName: true, firstName: true } },
      },
    });

    if (!invitation || invitation.status !== 'pending') {
      return { valid: false };
    }

    if (invitation.expiresAt && invitation.expiresAt <= now) {
      return { valid: false };
    }

    const inviterName =
      invitation.inviter?.displayName ??
      invitation.inviter?.firstName ??
      undefined;

    return { valid: true, ...(inviterName ? { inviterName } : {}) };
  }

  // ── Pre-validate without consuming (used by auth gating) ──────────

  /**
   * Validate that a code is pending and non-expired.
   * Returns the inviterId so auth.service can set invitedById on the new user.
   * Does NOT consume the code — consumption happens inside the transaction.
   */
  async preValidateCode(code: string): Promise<{ inviterId: string | null }> {
    const now = new Date();
    const invitation = await this.prisma.invitation.findUnique({
      where: { code },
      select: { id: true, status: true, expiresAt: true, inviterId: true },
    });

    // Already-consumed code → 400 (spec §4.1.6.b: "Invitation invalide ou déjà utilisée").
    // Distinguished from not-found/revoked/expired which stay 403.
    if (invitation && invitation.status === 'accepted') {
      throw new BadRequestException({
        code: 'INVITE_CODE_CONSUMED',
        message: 'Invitation déjà utilisée.',
      });
    }

    if (!invitation || invitation.status !== 'pending') {
      throw new ForbiddenException({
        code: 'INVALID_INVITE_CODE',
        message: 'Code d\'invitation invalide ou déjà utilisé.',
      });
    }

    if (invitation.expiresAt && invitation.expiresAt <= now) {
      throw new ForbiddenException({
        code: 'INVITE_CODE_EXPIRED',
        message: 'Ce code d\'invitation a expiré.',
      });
    }

    return { inviterId: invitation.inviterId };
  }

  /**
   * Soft lookup: returns the inviterId if a pending, non-expired invitation
   * targets the given email; null if none found.
   *
   * Does NOT throw — email-match is an optional fallback path. Absence just
   * means "no targeted invite for this email", the caller decides what to do.
   * Apple Hide-My-Email relay addresses will not match, which is expected —
   * those users fall back to the code path (already works).
   */
  async preValidateEmail(email: string): Promise<{ inviterId: string | null } | null> {
    const normalized = email.trim().toLowerCase();
    const now = new Date();
    const invitation = await this.prisma.invitation.findFirst({
      where: {
        status: 'pending',
        targetEmail: normalized,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, inviterId: true },
    });
    if (!invitation) return null;
    return { inviterId: invitation.inviterId };
  }

  /**
   * Atomically consume an invitation code immediately after user creation.
   * Uses updateMany with the same pending+non-expired condition to prevent
   * double-consumption in concurrent requests (§4.1.6.b).
   * Also purges targetEmail on consume (data-minimization).
   * Returns count (0 = race lost, caller must rollback).
   */
  async atomicallyConsumeCode(
    code: string,
    acceptedById: string,
    prismaClient: PrismaService,
  ): Promise<number> {
    const now = new Date();
    const result = await prismaClient.invitation.updateMany({
      where: {
        code,
        status: 'pending',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: { status: 'accepted', acceptedById, acceptedAt: now, targetEmail: null },
    });
    return result.count;
  }

  /**
   * Atomically consume a pending invitation matched by targetEmail.
   * Used when a new account's email matches a pending targeted invite and no
   * code was supplied (email-match registration path).
   *
   * Purges targetEmail on accept (data-minimization).
   * Returns count (0 = no match or race lost; caller treats as "no invite found").
   */
  async atomicallyConsumeByEmail(
    email: string,
    acceptedById: string,
    prismaClient: PrismaService,
  ): Promise<{ count: number; inviterId: string | null }> {
    const normalized = email.trim().toLowerCase();
    const now = new Date();

    // First, find the invitation to get inviterId (needed for notifyInviter).
    // We do a non-locking findFirst to get the candidate, then the atomic
    // updateMany to ensure only one concurrent registration wins.
    const candidate = await prismaClient.invitation.findFirst({
      where: {
        status: 'pending',
        targetEmail: normalized,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, inviterId: true },
    });

    if (!candidate) return { count: 0, inviterId: null };

    // Atomic consume: match by id + status + non-expired + targetEmail to prevent
    // two concurrent registrations both matching the same invite.
    const result = await prismaClient.invitation.updateMany({
      where: {
        id: candidate.id,
        status: 'pending',
        targetEmail: normalized,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: { status: 'accepted', acceptedById, acceptedAt: now, targetEmail: null },
    });

    return { count: result.count, inviterId: candidate.inviterId };
  }

  /**
   * Fire-and-forget: notify the inviter that their filleul joined.
   * Must be called AFTER the transaction commits.
   */
  notifyInviter(inviterId: string | null, newUserId: string, newUserFirstName: string | null): void {
    if (!inviterId) return; // root invitation (admin-generated) — no one to notify
    void this.notifications
      .create({
        userId: inviterId,
        type: 'invite_accepted',
        title: `${newUserFirstName ?? 'Quelqu\'un'} a rejoint grâce à toi 🎉`,
        actorId: newUserId,
        data: { userId: newUserId },
        expiresInHours: null, // keep this notification (not 24h expiry)
      })
      .catch((e) => this.logger.warn(`Failed to notify inviter ${inviterId}: ${String(e)}`));
  }
}
