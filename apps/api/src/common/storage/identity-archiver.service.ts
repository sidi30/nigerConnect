import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';
import {
  IdentityVaultService,
  type VaultEnvelopeMeta,
} from './identity-vault.service';

const DAY_MS = 86_400_000;

/** Pièce VALIDÉE : conservée 5 ans après la suppression du compte. */
export const APPROVED_RETENTION_MS = 5 * 365 * DAY_MS;
/**
 * Pièce REJETÉE : 1 an après le scellement. La personne n'est pas membre
 * vérifié — conserver davantage ne se justifie pas ; 1 an couvre la constatation
 * d'une tentative de fraude.
 */
export const REJECTED_RETENTION_MS = 365 * DAY_MS;

/**
 * Transfert d'une pièce d'identité de la base ACTIVE vers l'archive
 * intermédiaire (le coffre). Utilisé par le cron d'expiration et par la
 * suppression de compte.
 *
 * Invariant : on ne retire le document du bucket privé QUE si le scellement a
 * réussi. En cas d'échec on ne touche à rien et on réessaiera au prochain tour —
 * perdre la pièce serait pire que la garder un jour de plus.
 */
@Injectable()
export class IdentityArchiverService {
  private readonly logger = new Logger(IdentityArchiverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly vault: IdentityVaultService,
  ) {}

  get isEnabled(): boolean {
    return this.vault.isEnabled;
  }

  /**
   * Scelle le document `documentId` puis supprime le fichier du bucket privé.
   * Renvoie true si l'archive a bien été créée (l'appelant supprime alors la
   * ligne active), false s'il n'y avait rien à sceller.
   *
   * `accountDeletedAt` est renseigné quand l'archivage est déclenché par une
   * suppression de compte : le compteur des 5 ans démarre alors immédiatement.
   */
  async archiveDocument(documentId: string, accountDeletedAt?: Date): Promise<boolean> {
    const doc = await this.prisma.identityDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        userId: true,
        documentType: true,
        fileUrl: true,
        status: true,
        dateOfBirth: true,
        createdAt: true,
        reviewedAt: true,
      },
    });
    // Vérification manuelle (aucun fichier) ou pièce encore en attente : rien à
    // sceller, l'appelant retombe sur la suppression simple.
    if (!doc?.fileUrl) return false;
    if (doc.status !== 'approved' && doc.status !== 'rejected') return false;
    if (!this.vault.isEnabled) return false;

    const key = extractKey(doc.fileUrl);
    if (!key) return false;
    const object = await this.s3.getPrivateObject(key);
    if (!object) {
      // Le fichier a déjà disparu du bucket (purge manuelle, incident). On ne
      // fabrique pas une archive vide : l'appelant nettoiera la ligne.
      this.logger.warn(`No object behind ${key} — nothing to archive for document ${doc.id}`);
      return false;
    }

    const holder = await this.prisma.user.findUnique({
      where: { id: doc.userId },
      select: { firstName: true, lastName: true, email: true },
    });

    const outcome = doc.status as 'approved' | 'rejected';
    const now = new Date();
    const archiveId = randomUUID();
    // Le verrou WORM ne peut qu'être allongé : on le pose sur la durée connue à
    // cet instant. Pour une pièce validée d'un compte encore actif la date de
    // suppression est inconnue — le plancher est donc 5 ans à partir d'ici, et
    // `onAccountDeleted` le repoussera le jour venu.
    const purgeAt = this.computePurgeAt(outcome, now, accountDeletedAt);
    const retainUntil = purgeAt;

    const meta: VaultEnvelopeMeta = {
      userId: doc.userId,
      outcome,
      documentType: doc.documentType,
      holder: {
        firstName: holder?.firstName ?? null,
        lastName: holder?.lastName ?? null,
        email: holder?.email ?? null,
        dateOfBirth: doc.dateOfBirth ? doc.dateOfBirth.toISOString().slice(0, 10) : null,
      },
      submittedAt: doc.createdAt.toISOString(),
      reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
      originalKey: key,
      contentType: object.contentType,
    };

    const sealed = await this.vault.seal({ archiveId, meta, body: object.body, retainUntil });

    await this.prisma.identityArchive.create({
      data: {
        id: archiveId,
        userId: doc.userId,
        outcome,
        documentType: doc.documentType,
        vaultKey: sealed.vaultKey,
        contentSha256: sealed.contentSha256,
        sizeBytes: sealed.sizeBytes,
        archivedAt: now,
        purgeAt,
        retainUntil,
        accountDeletedAt: accountDeletedAt ?? null,
      },
    });

    // Seulement maintenant : la copie active peut partir.
    await this.s3.deletePrivateObject(key);
    return true;
  }

  /**
   * Suppression de compte : les pièces déjà scellées voient leur compteur
   * redémarrer à la date de suppression (5 ans pour une validée). Une pièce
   * rejetée garde son échéance à 1 an — le départ du membre ne la rallonge pas.
   */
  async onAccountDeleted(userId: string, deletedAt: Date): Promise<void> {
    const archives = await this.prisma.identityArchive.findMany({
      where: { userId, purgedAt: null },
      select: { id: true, outcome: true, vaultKey: true, purgeAt: true },
    });
    for (const archive of archives) {
      const target =
        archive.outcome === 'approved'
          ? new Date(deletedAt.getTime() + APPROVED_RETENTION_MS)
          : archive.purgeAt;
      // Object-lock refuse tout raccourcissement : on n'appelle le stockage que
      // si la nouvelle échéance est réellement plus lointaine.
      if (target.getTime() > archive.purgeAt.getTime()) {
        try {
          await this.vault.extendRetention(archive.vaultKey, target);
        } catch (error) {
          this.logger.error(`Failed to extend retention on ${archive.vaultKey}`, error as Error);
          continue;
        }
      }
      await this.prisma.identityArchive.update({
        where: { id: archive.id },
        data: { accountDeletedAt: deletedAt, purgeAt: target, retainUntil: target },
      });
    }
  }

  /** Efface les archives arrivées à échéance. Renvoie le nombre purgé. */
  async purgeExpired(now = new Date()): Promise<number> {
    if (!this.vault.isEnabled) return 0;
    const expired = await this.prisma.identityArchive.findMany({
      where: { purgedAt: null, purgeAt: { lt: now }, retainUntil: { lt: now } },
      select: { id: true, vaultKey: true },
    });
    let purged = 0;
    for (const archive of expired) {
      try {
        await this.vault.purge(archive.vaultKey);
      } catch (error) {
        // Verrou encore actif ou stockage indisponible : on retentera.
        this.logger.warn(`Vault purge refused for ${archive.vaultKey}: ${String(error)}`);
        continue;
      }
      await this.prisma.identityArchive.update({
        where: { id: archive.id },
        data: { purgedAt: new Date() },
      });
      purged += 1;
    }
    return purged;
  }

  private computePurgeAt(
    outcome: 'approved' | 'rejected',
    now: Date,
    accountDeletedAt?: Date,
  ): Date {
    if (outcome === 'rejected') return new Date(now.getTime() + REJECTED_RETENTION_MS);
    const base = accountDeletedAt ?? now;
    return new Date(base.getTime() + APPROVED_RETENTION_MS);
  }
}

/**
 * `s3://bucket/key` ou `https://host/key` → `key`. Une vérification manuelle n'a
 * pas de fichier (url nulle) → rien à extraire.
 */
export function extractKey(url: string | null): string | null {
  if (!url) return null;
  try {
    if (url.startsWith('s3://')) {
      const parts = url.replace('s3://', '').split('/');
      return parts.slice(1).join('/');
    }
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}
