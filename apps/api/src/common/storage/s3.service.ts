import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
   * Upload an object to the PUBLIC bucket from the server itself.
   *
   * The normal path is a presigned PUT the *client* performs — the API never
   * relays user bytes. This is for the cases where there is no client: a
   * maintenance CLI seeding avatars for accounts nobody can log into. The key
   * is caller-supplied so it can follow the same `users/{id}/…` convention
   * `assertOwnedPublicImage` validates against.
   */
  async putPublicObject(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.publicBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(this.sseEnabled ? { ServerSideEncryption: 'AES256' as const } : {}),
      }),
    );
    return this.publicUrl(key);
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

  /**
   * Download a PRIVATE object into memory. Used by the identity archiver, which
   * has to re-read a document to seal it in the vault before deleting it from
   * the active bucket. Returns null when the object is already gone.
   */
  async getPrivateObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.privateBucket, Key: key }),
      );
      const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) return null;
      return {
        body: Buffer.from(await body.transformToByteArray()),
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      this.logger.warn(`getPrivateObject failed for ${key}: ${String(error)}`);
      return null;
    }
  }

  publicUrl(key: string): string {
    if (this.cdnUrl) return `${this.cdnUrl.replace(/\/$/, '')}/${key}`;
    return `s3://${this.publicBucket}/${key}`;
  }

  /** Max bytes accepted for a public image attached to a profile/post. */
  static readonly MAX_PUBLIC_IMAGE_BYTES = 15 * 1024 * 1024;
  private static readonly ALLOWED_IMAGE_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
  ]);

  /**
   * Max bytes accepted for a public VIDEO (story clip). 25 Mo — a 30 s / 720p
   * H.265 clip lands ~15–25 Mo. This is the ONLY hard duration/codec proxy the
   * server can enforce (no ffprobe by design, ADR-002/SD-1): the cap on bytes
   * bounds the disk; duration/resolution stay a client promise.
   */
  static readonly MAX_PUBLIC_VIDEO_BYTES = 25 * 1024 * 1024;
  private static readonly ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);

  /**
   * Extract the bucket key from a URL the client claims to have uploaded.
   * Accepts only URLs that point at THIS deployment's public surface:
   *   - `${CDN_URL}/<key>`         (prod / proxied MinIO)
   *   - `s3://${publicBucket}/<key>` (dev fallback when no CDN_URL)
   * Anything else (foreign host, private bucket, path traversal) → null.
   */
  parsePublicKey(url: string): string | null {
    if (typeof url !== 'string' || url.length === 0 || url.length > 1024) return null;
    let key: string | null = null;
    if (this.cdnUrl) {
      const base = `${this.cdnUrl.replace(/\/$/, '')}/`;
      if (url.startsWith(base)) key = url.slice(base.length);
    }
    if (key === null) {
      const s3Prefix = `s3://${this.publicBucket}/`;
      if (url.startsWith(s3Prefix)) key = url.slice(s3Prefix.length);
    }
    if (key === null) return null;
    // Strip any query string / fragment, then reject traversal or empties.
    key = key.split(/[?#]/)[0]!;
    if (!key || key.startsWith('/') || key.includes('..') || key.includes('//')) return null;
    return key;
  }

  /**
   * Attach-time guard for client-supplied media URLs. The client uploads via a
   * presigned PUT, then sends us the resulting URL. We never trust that URL
   * blindly: we confirm it points at our own public bucket, HEAD the object to
   * prove it exists, and enforce content-type (image/*) and size caps the
   * presigned PUT itself cannot. Returns the canonical CDN URL to persist.
   *
   * @param ownerId when set, requires the key to live under `users/<ownerId>/`
   *        so a user cannot attach another user's (or a guessed) object.
   * @throws BadRequestException on any failure — caller maps to 400.
   */
  async assertOwnedPublicImage(url: string, ownerId?: string): Promise<string> {
    const key = this.parsePublicKey(url);
    if (!key) {
      throw new BadRequestException('Media URL must point to an uploaded file on this platform');
    }
    if (ownerId && !key.startsWith(`users/${ownerId}/`)) {
      throw new BadRequestException('Media does not belong to you');
    }
    let head;
    try {
      head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.publicBucket, Key: key }),
      );
    } catch (error) {
      this.logger.warn(
        `assertOwnedPublicImage HEAD failed for ${this.publicBucket}/${key}: ${String(error)}`,
      );
      throw new BadRequestException(
        'Uploaded file not found — upload it before attaching',
      );
    }
    const contentType = (head.ContentType ?? '').toLowerCase();
    if (!S3Service.ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new BadRequestException(`Unsupported media type: ${contentType || 'unknown'}`);
    }
    if ((head.ContentLength ?? 0) > S3Service.MAX_PUBLIC_IMAGE_BYTES) {
      throw new BadRequestException('Uploaded file is too large');
    }
    return this.publicUrl(key);
  }

  /**
   * Unified attach-time guard for BOTH images and videos. Superset of
   * assertOwnedPublicImage that additionally CONFRONTS the client-declared
   * `expectedMediaType` against the REAL Content-Type of the uploaded object
   * (HEAD) — closing the image↔video spoof that lets a caller lie about what
   * they uploaded (broken display, dodged quotas). Also generalises the
   * ownership check to an arbitrary `requiredPrefix` (e.g. `stories/{ownerId}/`).
   *
   * Returns the canonical CDN URL to persist. Callers that need the byte size
   * (video quota accounting) should use assertOwnedPublicMediaDetailed instead —
   * this thin wrapper exists to satisfy the public contract shape (→ string).
   *
   * @param expectedMediaType the mediaType the client DECLARED ('image'|'video').
   * @param requiredPrefix    key prefix the object MUST live under (anti-IDOR).
   * @throws BadRequestException on any failure — caller maps to 400.
   */
  async assertOwnedPublicMedia(
    url: string,
    expectedMediaType: 'image' | 'video',
    requiredPrefix: string,
  ): Promise<string> {
    return (await this.assertOwnedPublicMediaDetailed(url, expectedMediaType, requiredPrefix)).url;
  }

  /**
   * Same guard as assertOwnedPublicMedia but also returns the object's real
   * byte size and content-type, so callers enforcing a per-user byte quota
   * (stories video: 200 Mo / 24h) don't have to HEAD the object twice.
   */
  async assertOwnedPublicMediaDetailed(
    url: string,
    expectedMediaType: 'image' | 'video',
    requiredPrefix: string,
  ): Promise<{ url: string; bytes: number; contentType: string }> {
    const key = this.parsePublicKey(url);
    if (!key) {
      throw new BadRequestException('Media URL must point to an uploaded file on this platform');
    }
    if (!key.startsWith(requiredPrefix)) {
      throw new BadRequestException('Media does not belong to you');
    }
    let head;
    try {
      head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.publicBucket, Key: key }),
      );
    } catch (error) {
      this.logger.warn(
        `assertOwnedPublicMedia HEAD failed for ${this.publicBucket}/${key}: ${String(error)}`,
      );
      throw new BadRequestException('Uploaded file not found — upload it before attaching');
    }
    const contentType = (head.ContentType ?? '').toLowerCase();

    // Source of truth = the REAL content-type. Map it to a kind, then reject any
    // divergence from what the client declared (the anti-spoof gate).
    let realKind: 'image' | 'video';
    if (S3Service.ALLOWED_IMAGE_TYPES.has(contentType)) realKind = 'image';
    else if (S3Service.ALLOWED_VIDEO_TYPES.has(contentType)) realKind = 'video';
    else throw new BadRequestException(`Unsupported media type: ${contentType || 'unknown'}`);

    if (realKind !== expectedMediaType) {
      throw new BadRequestException('Declared media type does not match the uploaded file');
    }

    const bytes = head.ContentLength ?? 0;
    const cap =
      realKind === 'video' ? S3Service.MAX_PUBLIC_VIDEO_BYTES : S3Service.MAX_PUBLIC_IMAGE_BYTES;
    if (bytes > cap) {
      throw new BadRequestException('Uploaded file is too large');
    }
    return { url: this.publicUrl(key), bytes, contentType };
  }

  /**
   * Real size of a public object, in bytes — 0 when it cannot be read.
   *
   * Used to give a per-association storage quota back what a deleted post was
   * occupying (B5). Asking the bucket rather than trusting a stored number
   * means the figure returned is what the disk actually holds; returning 0 on
   * a missing object is deliberate, since crediting bytes for something that
   * is not there would let the counter drift below reality.
   */
  async objectSize(key: string, bucket: string = this.publicBucket): Promise<number> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch (error) {
      this.logger.warn(`objectSize failed for ${bucket}/${key}: ${String(error)}`);
      return 0;
    }
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
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'application/pdf': '.pdf',
    };
    return map[contentType.toLowerCase()] ?? '';
  }
}
