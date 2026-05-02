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
  /**
   * True when the client MUST echo `x-amz-server-side-encryption: AES256`
   * back in the PUT request — the header is baked into the signature when
   * the API runs against a real S3 (AES256 is bucket-default-friendly there).
   * False on MinIO, where SSE without KMS is a 501.
   */
  sseRequired: boolean;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  /** Internal client — talks to MinIO/S3 from the backend (delete, etc.). */
  private readonly client: S3Client;
  /**
   * Signing client — used only to generate presigned URLs the *client* will hit.
   * When MinIO runs behind a reverse proxy, the internal endpoint
   * (`http://minio:9000`) is unreachable from outside, so signing must use
   * the public hostname. Falls back to the internal client when
   * S3_PUBLIC_ENDPOINT is not configured (single-host dev setups).
   */
  private readonly signingClient: S3Client;
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly cdnUrl?: string;
  /**
   * When true, presigned uploads force the client to send
   * `x-amz-server-side-encryption: AES256` and bake it into the signature.
   * Off by default — MinIO without a KMS sidecar 501s on SSE requests, so
   * forcing this previously broke every upload. Real AWS S3 supports this
   * transparently; flip the env flag if you migrate.
   */
  private readonly sseEnabled: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.publicBucket = config.get('S3_BUCKET', { infer: true });
    this.privateBucket = config.get('S3_PRIVATE_BUCKET', { infer: true });
    this.cdnUrl = config.get('CDN_URL', { infer: true });
    this.sseEnabled = config.get('S3_SSE', { infer: true });
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    const publicEndpoint = config.get('S3_PUBLIC_ENDPOINT', { infer: true });
    const region = config.get('S3_REGION', { infer: true });
    const forcePathStyle = config.get('S3_FORCE_PATH_STYLE', { infer: true });
    const credentials = {
      accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }) ?? 'minioadmin',
      secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }) ?? 'minioadmin',
    };
    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle,
      credentials,
    });
    this.signingClient = publicEndpoint
      ? new S3Client({ region, endpoint: publicEndpoint, forcePathStyle, credentials })
      : this.client;

    this.logger.log(
      `S3 configured: bucket=${this.publicBucket}, sse=${this.sseEnabled ? 'AES256' : 'off'}, ` +
        `endpoint=${publicEndpoint ?? endpoint ?? 'aws-default'}`,
    );
  }

  /** Whether presigned uploads carry the SSE header. Used by the API to
   *  echo a hint back to the client so it sends matching headers. */
  get isSseEnabled(): boolean {
    return this.sseEnabled;
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

    // Build the signed PUT. We pin SSE only when the deployment actually
    // supports it: on AWS S3 it's the no-op default, on MinIO it triggers
    // a 501 NotImplemented so we leave the header out entirely.
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: params.contentType,
      ...(this.sseEnabled ? { ServerSideEncryption: 'AES256' as const } : {}),
    });
    const signableHeaders = new Set<string>(['content-type']);
    if (this.sseEnabled) signableHeaders.add('x-amz-server-side-encryption');
    const uploadUrl = await getSignedUrl(this.signingClient, command, {
      expiresIn,
      signableHeaders,
    });

    return {
      uploadUrl,
      publicUrl: visibility === 'public' ? this.publicUrl(key) : `s3://${bucket}/${key}`,
      key,
      bucket,
      visibility,
      expiresIn,
      sseRequired: this.sseEnabled,
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
    return getSignedUrl(this.signingClient, command, { expiresIn: capped });
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
