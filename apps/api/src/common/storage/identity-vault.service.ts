import {
  createCipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
  constants as cryptoConstants,
} from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  PutObjectRetentionCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '../config/env.validation';

/**
 * Coffre d'archivage des pièces d'identité — « archivage intermédiaire » au
 * sens RGPD : la pièce sort de la base active au bout de 30 jours et n'est plus
 * détruite mais SCELLÉE ici, pour une durée bornée (5 ans après la suppression
 * du compte pour une pièce validée, 1 an pour une pièce rejetée).
 *
 * Trois barrières indépendantes :
 *
 *  1. **Bucket séparé + compte de service dédié.** `S3_VAULT_*` n'est PAS la
 *     clé S3 de l'application. La politique attachée n'accorde que
 *     PutObject / PutObjectRetention / DeleteObject : l'API scelle, elle ne
 *     relit jamais. Une API compromise ne peut pas exfiltrer le coffre.
 *  2. **Chiffrement hybride côté serveur, clé privée hors-ligne.** Chaque pièce
 *     reçoit une clé AES-256-GCM à usage unique, scellée par une clé publique
 *     RSA-4096. La privée vit sur la machine du responsable, jamais sur le VPS :
 *     un root sur le serveur ne lit rien.
 *  3. **Object-lock GOVERNANCE.** L'objet est immuable jusqu'à `retainUntil`.
 *     Le compte de service n'a pas `BypassGovernanceRetention`, donc même une
 *     purge malveillante déclenchée depuis l'API est refusée par MinIO. Le mode
 *     GOVERNANCE (et non COMPLIANCE) laisse au responsable une porte de sortie
 *     avec les identifiants d'administration, indispensable pour honorer une
 *     injonction d'effacement.
 *
 * Format d'enveloppe (`NCVAULT1`) :
 *
 *   magic(8) | u16 wrappedKeyLen | wrappedKey | iv(12) | tag(16) | ciphertext
 *   ciphertext = AES-256-GCM( u32 metaLen | metaJson utf8 | octets du fichier )
 *   AAD        = magic | userId
 *
 * Les métadonnées (identité du titulaire, type de pièce, décision, dates) sont
 * DANS le chiffré : la base ne contient aucune donnée personnelle en clair.
 */

const MAGIC = Buffer.from('NCVAULT1', 'utf8');

export interface VaultEnvelopeMeta {
  userId: string;
  outcome: 'approved' | 'rejected';
  documentType: string;
  /** Snapshot d'identité pris au scellement — le compte peut disparaître après. */
  holder: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    dateOfBirth?: string | null;
  };
  submittedAt: string;
  reviewedAt: string | null;
  originalKey: string;
  contentType: string;
}

export interface SealedArchive {
  vaultKey: string;
  contentSha256: string;
  sizeBytes: number;
  retainUntil: Date;
}

@Injectable()
export class IdentityVaultService {
  private readonly logger = new Logger(IdentityVaultService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string | null;
  private readonly publicKeyPem: string | null;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_VAULT_BUCKET', { infer: true }) ?? null;
    const accessKeyId = config.get('S3_VAULT_ACCESS_KEY', { infer: true });
    const secretAccessKey = config.get('S3_VAULT_SECRET_KEY', { infer: true });
    const rawKey = config.get('IDENTITY_VAULT_PUBLIC_KEY', { infer: true });
    this.publicKeyPem = rawKey ? decodePublicKey(rawKey) : null;

    if (this.bucket && accessKeyId && secretAccessKey && this.publicKeyPem) {
      this.client = new S3Client({
        region: config.get('S3_REGION', { infer: true }),
        endpoint: config.get('S3_ENDPOINT', { infer: true }) || undefined,
        forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
        credentials: { accessKeyId, secretAccessKey },
      });
      this.logger.log(`Identity vault ready: bucket=${this.bucket} (write-only, RSA-sealed)`);
    } else {
      this.client = null;
      this.logger.warn(
        'Identity vault NOT configured (S3_VAULT_* / IDENTITY_VAULT_PUBLIC_KEY absent) — ' +
          'expired identity documents will be DESTROYED instead of archived.',
      );
    }
  }

  /** Le coffre est-il opérationnel ? Sinon l'appelant retombe sur la destruction. */
  get isEnabled(): boolean {
    return this.client !== null && this.bucket !== null && this.publicKeyPem !== null;
  }

  /**
   * Scelle un document dans le coffre.
   *
   * @param retainUntil verrou WORM. Ne peut jamais être raccourci ensuite —
   *        on pose donc le plancher (archivage + durée minimale) et on le
   *        repousse plus tard si la suppression du compte l'exige.
   */
  async seal(params: {
    archiveId: string;
    meta: VaultEnvelopeMeta;
    body: Buffer;
    retainUntil: Date;
  }): Promise<SealedArchive> {
    if (!this.client || !this.bucket || !this.publicKeyPem) {
      throw new Error('Identity vault is not configured');
    }
    const { archiveId, meta, body, retainUntil } = params;
    const contentSha256 = createHash('sha256').update(body).digest('hex');

    const metaJson = Buffer.from(JSON.stringify(meta), 'utf8');
    const metaLen = Buffer.alloc(4);
    metaLen.writeUInt32BE(metaJson.length, 0);
    const plaintext = Buffer.concat([metaLen, metaJson, body]);

    const dataKey = randomBytes(32);
    const iv = randomBytes(12);
    const aad = Buffer.concat([MAGIC, Buffer.from(meta.userId, 'utf8')]);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // OAEP/SHA-256 — pas de PKCS#1 v1.5, qui est vulnérable au padding oracle.
    const wrappedKey = publicEncrypt(
      {
        key: this.publicKeyPem,
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      dataKey,
    );
    dataKey.fill(0);

    const wrappedLen = Buffer.alloc(2);
    wrappedLen.writeUInt16BE(wrappedKey.length, 0);
    const envelope = Buffer.concat([MAGIC, wrappedLen, wrappedKey, iv, tag, ciphertext]);

    const vaultKey = `identity/${meta.userId}/${archiveId}.enc`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: vaultKey,
        Body: envelope,
        ContentType: 'application/octet-stream',
        ObjectLockMode: 'GOVERNANCE',
        ObjectLockRetainUntilDate: retainUntil,
      }),
    );

    return { vaultKey, contentSha256, sizeBytes: body.length, retainUntil };
  }

  /**
   * Repousse le verrou WORM d'une pièce déjà scellée. Object-lock n'autorise
   * QUE l'allongement : un `retainUntil` antérieur est rejeté par le stockage,
   * ce qui est exactement la garantie recherchée. Appelé quand un compte est
   * supprimé (le compteur des 5 ans démarre à ce moment-là).
   */
  async extendRetention(vaultKey: string, retainUntil: Date): Promise<void> {
    if (!this.client || !this.bucket) throw new Error('Identity vault is not configured');
    await this.client.send(
      new PutObjectRetentionCommand({
        Bucket: this.bucket,
        Key: vaultKey,
        Retention: { Mode: 'GOVERNANCE', RetainUntilDate: retainUntil },
      }),
    );
  }

  /**
   * Efface définitivement une pièce arrivée au bout de sa durée. Le stockage
   * refuse l'appel tant que le verrou court — la durée de conservation n'est
   * donc pas seulement déclarative.
   */
  async purge(vaultKey: string): Promise<void> {
    if (!this.client || !this.bucket) throw new Error('Identity vault is not configured');
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: vaultKey }));
  }
}

/**
 * La clé publique voyage en base64 (une variable d'env sur une seule ligne) ou
 * en PEM brut si l'exploitant l'a collée telle quelle.
 */
function decodePublicKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.includes('BEGIN PUBLIC KEY')) return trimmed.replace(/\n/g, '\n');
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    return decoded.includes('BEGIN PUBLIC KEY') ? decoded : null;
  } catch {
    return null;
  }
}
