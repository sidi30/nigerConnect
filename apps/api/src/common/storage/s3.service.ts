import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.validation';

/**
 * Object visibility:
 *   - public  : goes into the CDN bucket (S3_BUCKET). Anonymous download is allowed.
 *               Safe for avatars, post media, stories, public covers.
 *   - private : goes into S3_PRIVATE_BUCKET. Bucket policy forbids any anonymous
 *               read. Reads require a short-lived presigned GET.
 *
 * Identity documents, private chat media, and any future "for-their-eyes-only"
 * content MUST use 'private'.
 */
export type ObjectVisibility = 'public' | 'private';

export interface PresignedUpload {
  uploadUrl: string;
  /**
   * For public objects: the CDN URL the client can embed directly.
   * For private objects: an `s3://bucket/key` pointer — callers must ask the
   * server to produce a short-lived presigned GET when the time comes to
   * display it.
   */
  publicUrl: string;
  key: string;
  bucket: string;
  visibility: ObjectVisibility;
  expiresIn: number;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly cdnUrl?: string;

  constructor(config: ConfigService<Env, true>) {
    this.publicBucket = config.get('S3_BUCKET', { infer: true });
    this.privateBucket = config.get('S3_PRIVATE_BUCKET', { infer: true });
    this.cdnUrl = config.get('CDN_URL', { infer: true });
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.client = new S3Client({
      region: config.get('S3_REGION', { infer: true }),
      endpoint: endpoint || undefined,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }) ?? 'minioadmin',
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }) ?? 'minioadmin',
      },
    });
  }

  async createPresignedUpload(params: {
    folder: string;
    contentType: string;
    expiresIn?: number;
    extension?: string;
    visibility?: ObjectVisibility;
  }): Promise<PresignedUpload> {
    const visibility = params.visibility ?? 'public';
    const bucket = visibility === 'private' ? this.privateBucket : this.publicBucket;
    const ext = params.extension ?? this.extensionFromContentType(params.contentType);
    const key = `${params.folder}/${randomUUID()}${ext}`;
    const expiresIn = params.expiresIn ?? 600;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: params.contentType,
      // Force server-side encryption for every presigned upload. The signed
      // URL only validates headers the client sends, so this `x-amz-server-side-encryption`
      // is bound into the signature: a client cannot opt out.
      ServerSideEncryption: 'AES256',
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn,
      // Force the client to echo back the exact headers we baked into the
      // signature (content-type + SSE). Any tampering breaks the signature.
      signableHeaders: new Set(['content-type', 'x-amz-server-side-encryption']),
    });

    return {
      uploadUrl,
      publicUrl: visibility === 'public' ? this.publicUrl(key) : `s3://${bucket}/${key}`,
      key,
      bucket,
      visibility,
      expiresIn,
    };
  }

  /**
   * Generate a short-lived GET URL for a PRIVATE object. Meant for things like
   * identity documents viewed by moderators, or chat media the peer is about
   * to display. Max TTL is capped at 15 min to limit replay.
   */
  async createPresignedDownload(key: string, expiresIn = 300): Promise<string> {
    const capped = Math.min(Math.max(expiresIn, 30), 900);
    const command = new GetObjectCommand({
      Bucket: this.privateBucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: capped });
  }

  publicUrl(key: string): string {
    if (this.cdnUrl) return `${this.cdnUrl.replace(/\/$/, '')}/${key}`;
    return `s3://${this.publicBucket}/${key}`;
  }

  async deleteObject(key: string, bucket: string = this.publicBucket): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      this.logger.warn(`Failed to delete ${bucket}/${key}: ${String(error)}`);
    }
  }

  /**
   * Convenience wrapper: delete a private object by key.
   * Used by the identity-document lifecycle and future GDPR purges.
   */
  async deletePrivateObject(key: string): Promise<void> {
    await this.deleteObject(key, this.privateBucket);
  }

  extensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/heic': '.heic',
      'application/pdf': '.pdf',
    };
    return map[contentType.toLowerCase()] ?? '';
  }
}
