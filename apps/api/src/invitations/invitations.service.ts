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
import type { InvitationKind } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { MailerService } from '../common/mail/mailer.service';
import type { CreateInvitationDto } from './invitations.schemas';

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 10;
const INVITE_URL_BASE = 'https://nigerconnect.app/invite';

/** Au-delà de ce nombre de filleuls bannis, la création d'invitation est gelée. */
const ABUSE_THRESHOLD = 3;

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
    private readonly notifications: NotificationService,
    private readonly mailer: MailerService,
  ) {}

  // ── POST /invitations ──────────────────────────────────────────────
  // v2 réseau : plus de quota dur ni d'expiration. Deux types :
  //   - single_use (défaut) : email/code, une seule acceptation.
  //   - reusable : lien partageable (N inscriptions), réservé à canBulkInvite.

  async createInvitation(
    inviterId: string,
    dto: CreateInvitationDto = {},
  ): Promise<{
    id: string;
    code: string;
    url: string;
    kind: InvitationKind;
  }> {
    const kind: InvitationKind = dto.kind ?? 'single_use';

    // 1. Load inviter (emailVerified gate + abuse freeze + bulk-invite right + name for email)
    const inviter = await this.prisma.user.findUniqueOrThrow({
      where: { id: inviterId },
      select: {
        emailVerified: true,
        inviteAbuseFlags: true,
        canBulkInvite: true,
        displayName: true,
        firstName: true,
      },
    });

    // 2. email-verified gate
    if (!inviter.emailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Tu dois vérifier ton email avant de pouvoir inviter.',
      });
    }

    // 3. Abuse-flag freeze : trop de filleuls bannis → on coupe les invitations.
    if (inviter.inviteAbuseFlags >= ABUSE_THRESHOLD) {
      throw new ForbiddenException({
        code: 'INVITE_QUOTA_FROZEN',
        message: "Tes invitations sont gelées suite à des abus signalés.",
      });
    }

    // 4. Lien réutilisable = droit accordé uniquement.
    if (kind === 'reusable' && !inviter.canBulkInvite) {
      throw new ForbiddenException({
        code: 'BULK_INVITE_NOT_ALLOWED',
        message: "Tu n'as pas le droit de générer un lien d'invitation en masse.",
      });
    }

    // 5. Email cible : uniquement pour single_use (le lien reusable n'a pas de destinataire).
    //    Data-minimization : stocké seulement tant que l'invitation est pending.
    const targetEmail =
      kind === 'single_use' && dto.email ? dto.email.trim().toLowerCase() : null;

    // 6. Generate unique code with retry on P2002 (collision astronomiquement rare).
    //    Plus de transaction Serializable : sans quota, aucune course à protéger ici.
    let invitation: Awaited<ReturnType<typeof this.prisma.invitation.create>> | null = null;
    for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
      const code = generateBase62Code();
      try {
        invitation = await this.prisma.invitation.create({
          data: { inviterId, code, kind, targetEmail, expiresAt: null },
        });
        break;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          this.logger.warn(`Invite code collision on attempt ${attempt + 1}, retrying`);
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
      kind: invitation.kind,
    };
  }

  // ── GET /invitations ───────────────────────────────────────────────

  async listInvitations(inviterId: string): Promise<{
    canBulkInvite: boolean;
    invites: Array<{
      id: string;
      code: string;
      url: string;
      kind: InvitationKind;
      status: string;
      acceptedBy: { id: string; displayName: string | null; avatarUrl: string | null } | null;
      signupsCount: number;
      createdAt: Date;
    }>;
  }> {
    const inviter = await this.prisma.user.findUniqueOrThrow({
      where: { id: inviterId },
      select: { canBulkInvite: true },
    });

    const invites = await this.prisma.invitation.findMany({
      where: { inviterId },
      orderBy: { createdAt: 'desc' },
      include: {
        acceptedBy: { select: { id: true, displayName: true, avatarUrl: true } },
        // Nombre d'inscriptions réelles via cette invitation (utile pour les liens reusable).
        _count: { select: { signups: true } },
      },
    });

    return {
      canBulkInvite: inviter.canBulkInvite,
      invites: invites.map((inv) => ({
        id: inv.id,
        code: inv.code,
        url: `${INVITE_URL_BASE}/${inv.code}`,
        kind: inv.kind,
        status: inv.status,
        acceptedBy: inv.acceptedBy
          ? { id: inv.acceptedBy.id, displayName: inv.acceptedBy.displayName, avatarUrl: inv.acceptedBy.avatarUrl }
          : null,
        signupsCount: inv._count.signups,
        createdAt: inv.createdAt,
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

    // Purge targetEmail on revoke (data-minimization). Works for both kinds:
    // a revoked reusable link stops validating (checkInvitation requires pending).
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'revoked', revokedAt: new Date(), targetEmail: null },
    });
  }

  // ── GET /invitations/check ─────────────────────────────────────────

  async checkInvitation(
    code: string,
  ): Promise<{ valid: boolean; inviterName?: string; kind?: InvitationKind }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { code },
      include: {
        inviter: { select: { displayName: true, firstName: true } },
      },
    });

    // pending = actif (vrai pour single_use non consommé ET reusable). Plus d'expiry.
    if (!invitation || invitation.status !== 'pending') {
      return { valid: false };
    }

    const inviterName =
      invitation.inviter?.displayName ??
      invitation.inviter?.firstName ??
      undefined;

    return { valid: true, kind: invitation.kind, ...(inviterName ? { inviterName } : {}) };
  }

  // ── Pre-validate without consuming (used by auth gating) ──────────

  /**
   * Validate that a code is usable for registration.
   * Returns inviterId + invitationId + kind so auth.service can set
   * invitedById/invitedViaId on the new user and pick the consume path.
   * Accepts both single_use (pending) and reusable (always pending = active) codes.
   * Does NOT consume — consumption happens inside the registration transaction.
   */
  async resolveCodeForRegistration(
    code: string,
  ): Promise<{ inviterId: string | null; invitationId: string; kind: InvitationKind }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { code },
      select: { id: true, status: true, kind: true, inviterId: true },
    });

    // Already-consumed single_use code → 400 (spec §4.1.6.b: "déjà utilisée").
    // Distinguished from not-found/revoked which stay 403.
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

    return { inviterId: invitation.inviterId, invitationId: invitation.id, kind: invitation.kind };
  }

  /**
   * Soft lookup: returns the inviterId + invitationId if a pending invitation
   * targets the given email; null if none found.
   *
   * Does NOT throw — email-match is an optional fallback path (single_use only;
   * reusable links carry no targetEmail). Apple Hide-My-Email relay addresses
   * won't match, which is expected — those users fall back to the code path.
   */
  async preValidateEmail(
    email: string,
  ): Promise<{ inviterId: string | null; invitationId: string } | null> {
    const normalized = email.trim().toLowerCase();
    const invitation = await this.prisma.invitation.findFirst({
      where: { status: 'pending', targetEmail: normalized },
      select: { id: true, inviterId: true },
    });
    if (!invitation) return null;
    return { inviterId: invitation.inviterId, invitationId: invitation.id };
  }

  /**
   * Atomically consume a SINGLE-USE invitation code immediately after user creation.
   * Uses updateMany with the pending condition to prevent double-consumption in
   * concurrent requests (§4.1.6.b). Also purges targetEmail on consume.
   * Returns count (0 = race lost, caller must rollback).
   *
   * Reusable links are NEVER consumed here — the caller skips this for kind=reusable.
   */
  async atomicallyConsumeSingleUse(
    code: string,
    acceptedById: string,
    prismaClient: PrismaService,
  ): Promise<number> {
    const now = new Date();
    const result = await prismaClient.invitation.updateMany({
      where: { code, kind: 'single_use', status: 'pending' },
      data: { status: 'accepted', acceptedById, acceptedAt: now, targetEmail: null },
    });
    return result.count;
  }

  /**
   * Atomically consume a pending single_use invitation matched by targetEmail.
   * Used when a new account's email matches a pending targeted invite and no
   * code was supplied (email-match registration path).
   *
   * Purges targetEmail on accept (data-minimization).
   * Returns count (0 = no match or race lost), the inviterId and invitationId.
   */
  async atomicallyConsumeByEmail(
    email: string,
    acceptedById: string,
    prismaClient: PrismaService,
  ): Promise<{ count: number; inviterId: string | null; invitationId: string | null }> {
    const normalized = email.trim().toLowerCase();
    const now = new Date();

    // First, find the invitation to get inviterId + id (needed for invitedViaId/notify).
    // kind:'single_use' is defense-in-depth: only single-use invites ever carry a
    // targetEmail today, but the explicit filter guarantees an email-match can never
    // accidentally consume a reusable link (mirror of atomicallyConsumeSingleUse).
    const candidate = await prismaClient.invitation.findFirst({
      where: { status: 'pending', kind: 'single_use', targetEmail: normalized },
      select: { id: true, inviterId: true },
    });

    if (!candidate) return { count: 0, inviterId: null, invitationId: null };

    // Atomic consume: match by id + status + targetEmail so two concurrent
    // registrations can't both match the same targeted invite.
    const result = await prismaClient.invitation.updateMany({
      where: { id: candidate.id, status: 'pending', kind: 'single_use', targetEmail: normalized },
      data: { status: 'accepted', acceptedById, acceptedAt: now, targetEmail: null },
    });

    return { count: result.count, inviterId: candidate.inviterId, invitationId: candidate.id };
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
