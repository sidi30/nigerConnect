import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.validation';
import { SettingsService } from '../common/settings/settings.service';

const INTERVAL_MS = 60 * 60 * 1000; // hourly

/**
 * ADR-004 layer (c) — the disk disjuncteur. Hourly, it reads MinIO's OWN reported
 * usage for the public bucket (Prometheus metric maintained by MinIO's internal
 * scanner → ZERO API CPU, no ListObjects, no ffmpeg). If usage crosses
 * VIDEO_DISK_GUARD_BYTES, it flips `video_enabled` OFF (fail-closed): new uploads
 * stop immediately, already-published content stays until expiry/takedown.
 *
 * It NEVER re-arms automatically — a tripped guard stays tripped until an admin
 * re-enables the switch (PATCH /admin/settings) after reclaiming disk. On a
 * metrics-fetch failure it logs a warning and does NOTHING (never relaxes the
 * guard on uncertainty).
 */
@Injectable()
export class VideoDiskGuardCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoDiskGuardCron.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly metricsUrl: string;
  private readonly bucket: string;
  private readonly thresholdBytes: number;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.metricsUrl = config.get('MINIO_METRICS_URL', { infer: true });
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.thresholdBytes = config.get('VIDEO_DISK_GUARD_BYTES', { infer: true });
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    let usage: number | null;
    try {
      usage = await this.scrapeBucketUsage();
    } catch (error) {
      // Fail-SAFE: we couldn't measure the disk, so we do NOT touch the switch
      // (never re-arm on uncertainty). Just surface it for the owner.
      this.logger.warn(`[disk-guard] metrics scrape failed, leaving switch as-is: ${String(error)}`);
      return;
    }

    if (usage === null) {
      this.logger.warn(`[disk-guard] bucket "${this.bucket}" not found in metrics; leaving switch as-is`);
      return;
    }

    if (usage >= this.thresholdBytes) {
      // Trip the disjuncteur. setSetting is idempotent — re-tripping an already
      // OFF switch is harmless, but we only shout (error) when we actually cross.
      await this.settings.setSetting('video_enabled', 'false');
      this.logger.error(
        `[disk-guard] tripped: bucket "${this.bucket}" usage=${usage}B >= ${this.thresholdBytes}B — video_enabled forced OFF (manual re-arm required)`,
      );
      return;
    }

    this.logger.log(
      `[disk-guard] bucket "${this.bucket}" usage=${usage}B / ${this.thresholdBytes}B (${Math.round(
        (usage / this.thresholdBytes) * 100,
      )}%)`,
    );
  }

  /**
   * Fetch the MinIO cluster metrics (Prometheus text) and extract
   * `minio_bucket_usage_total_bytes{bucket="<bucket>"}`. Returns the byte value,
   * or null when the metric line for our bucket isn't present.
   */
  private async scrapeBucketUsage(): Promise<number | null> {
    const res = await fetch(this.metricsUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`metrics HTTP ${res.status}`);
    const body = await res.text();
    return VideoDiskGuardCron.parseBucketUsage(body, this.bucket);
  }

  /**
   * Parse a Prometheus exposition body for the usage of a specific bucket.
   * Exported-as-static for unit testing without a live MinIO.
   */
  static parseBucketUsage(prometheusBody: string, bucket: string): number | null {
    for (const line of prometheusBody.split('\n')) {
      if (!line.startsWith('minio_bucket_usage_total_bytes')) continue;
      // Match the bucket label exactly, then read the trailing numeric value.
      const labelMatch = line.match(/bucket="([^"]*)"/);
      if (!labelMatch || labelMatch[1] !== bucket) continue;
      const valueMatch = line.trim().match(/\s([0-9.eE+-]+)$/);
      if (!valueMatch || valueMatch[1] === undefined) continue;
      const value = Number(valueMatch[1]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }
}
