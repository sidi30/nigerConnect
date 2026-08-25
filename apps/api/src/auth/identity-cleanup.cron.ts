import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';
import { IdentityArchiverService, extractKey } from '../common/storage/identity-archiver.service';

const INTERVAL_MS = 60 * 60 * 1000; // every hour

/**
 * Un dépôt jamais examiné ne peut pas rester là indéfiniment : au bout de 90
 * jours la pièce est détruite et l'utilisateur repart de `not_submitted`. Elle
 * n'a jamais été validée, donc rien à archiver — l'archivage intermédiaire ne
 * couvre que les pièces effectivement examinées.
 */
const PENDING_MAX_AGE_MS = 90 * 86_400_000;

/**
 * Cycle de vie des pièces d'identité.
 *
 *   dépôt → bucket privé (base ACTIVE)
 *     ├─ examinée (validée/rejetée) → +30 j → SCELLÉE dans le coffre, puis
 *     │  retirée de la base active (voir IdentityArchiverService)
 *     └─ jamais examinée → détruite à 90 j, statut remis à not_submitted
 *
 * L'archivage intermédiaire (5 ans après suppression du compte pour une pièce
 * validée, 1 an pour une rejetée) répond à une finalité distincte de la
 * vérification elle-même : constatation, exercice ou défense d'un droit en
 * justice, et re-confirmation d'identité sur réquisition. La pièce quitte donc
 * la base active à échéance, mais n'est effacée qu'au terme de l'archive.
 *
 * Si le coffre n'est pas configuré (dev, test, déploiement sans clé publique),
 * on retombe sur l'ancien comportement — destruction pure — en le journalisant :
 * mieux vaut détruire que garder en clair une pièce hors durée annoncée.
 */
@Injectable()
export class IdentityCleanupCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdentityCleanupCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly archiver: IdentityArchiverService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      await this.processReviewed();
      await this.processStalePending();
      const purged = await this.archiver.purgeExpired();
      if (purged > 0) this.logger.log(`🧹 Purged ${purged} expired identity archives`);
    } catch (error) {
      this.logger.error('Identity cleanup failed', error as Error);
    }
  }

  /**
   * Pièces examinées dont les 30 jours de conservation active sont écoulés.
   *
   * `expiresAt` était historiquement laissé à NULL sur un rejet, si bien que le
   * filtre `expiresAt < now()` ne matchait jamais et que les pièces rejetées
   * restaient indéfiniment. On borne donc aussi par `reviewedAt` : toute pièce
   * examinée il y a plus de 30 jours sort de la base active, avec ou sans
   * `expiresAt`.
   */
  private async processReviewed(): Promise<void> {
    const now = new Date();
    const activeCutoff = new Date(now.getTime() - 30 * 86_400_000);
    const expired = await this.prisma.identityDocument.findMany({
      where: {
        status: { in: ['approved', 'rejected'] },
        OR: [{ expiresAt: { lt: now } }, { reviewedAt: { lt: activeCutoff } }],
      },
      select: { id: true, fileUrl: true },
    });
    if (expired.length === 0) return;

    let archived = 0;
    let destroyed = 0;
    for (const doc of expired) {
      // Le scellement d'abord : la ligne et le fichier actif ne partent que
      // lorsque la copie d'archive existe réellement.
      const sealed = await this.archiver.archiveDocument(doc.id).catch((error: unknown) => {
        this.logger.error(`Failed to archive identity document ${doc.id}`, error as Error);
        return null;
      });
      if (sealed === null) continue; // erreur de coffre → on retentera dans 1 h
      if (sealed) {
        archived += 1;
      } else {
        // Rien à sceller (vérification manuelle sans fichier, coffre désactivé,
        // objet déjà disparu) : les documents identity vivent dans le bucket
        // PRIVÉ, le delete doit donc le viser explicitement.
        const key = extractKey(doc.fileUrl);
        if (key) await this.s3.deletePrivateObject(key);
        destroyed += 1;
      }
      await this.prisma.identityDocument.delete({ where: { id: doc.id } });
    }
    if (archived > 0) this.logger.log(`🔒 Sealed ${archived} identity documents into the vault`);
    if (destroyed > 0) this.logger.log(`🧹 Destroyed ${destroyed} identity documents`);
  }

  /** Dépôts jamais examinés : destruction à 90 jours, statut réinitialisé. */
  private async processStalePending(): Promise<void> {
    const cutoff = new Date(Date.now() - PENDING_MAX_AGE_MS);
    const stale = await this.prisma.identityDocument.findMany({
      where: { status: 'pending', createdAt: { lt: cutoff } },
      select: { id: true, userId: true, fileUrl: true },
    });
    if (stale.length === 0) return;

    for (const doc of stale) {
      const key = extractKey(doc.fileUrl);
      if (key) await this.s3.deletePrivateObject(key);
      await this.prisma.$transaction([
        this.prisma.identityDocument.delete({ where: { id: doc.id } }),
        this.prisma.user.updateMany({
          where: { id: doc.userId, identityStatus: 'pending' },
          data: { identityStatus: 'not_submitted' },
        }),
      ]);
    }
    this.logger.log(`🧹 Destroyed ${stale.length} identity documents never reviewed (90d)`);
  }
}
