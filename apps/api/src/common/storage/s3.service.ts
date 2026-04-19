import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.validation';

export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly cdnUrl?: string;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
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
  }): Promise<PresignedUpload> {
    const ext = params.extension ?? this.extensionFromContentType(params.contentType);
    const key = `${params.folder}/${randomUUID()}${ext}`;
    const expiresIn = params.expiresIn ?? 600;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: params.contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });

    return {
      uploadUrl,
      publicUrl: this.publicUrl(key),
      key,
      expiresIn,
    };
  }

  publicUrl(key: string): string {
    if (this.cdnUrl) return `${this.cdnUrl.replace(/\/$/, '')}/${key}`;
    return `s3://${this.bucket}/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      this.logger.warn(`Failed to delete ${key}: ${String(error)}`);
    }
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
