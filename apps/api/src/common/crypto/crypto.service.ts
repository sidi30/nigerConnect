import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

/**
 * Authenticated encryption for column-level secrets (MFA TOTP seeds, future PII).
 *
 * Format stored in DB (VarChar):
 *   v1.<iv_b64>.<tag_b64>.<ciphertext_b64>
 *
 * - Algorithm : AES-256-GCM (authenticated, tamper-evident).
 * - Key       : 32 bytes, provided as base64 in DATA_ENCRYPTION_KEY.
 * - IV        : 12 bytes per encryption, random.
 * - Versioned : the `v1.` prefix lets us migrate to a stronger scheme later
 *               without guessing which rows are already encrypted.
 *
 * In NON-production environments, if DATA_ENCRYPTION_KEY is absent, a deterministic
 * dev key is used to keep the DX smooth — this key is deliberately weak and logged.
 * NEVER rely on it for any real data.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;
  private static readonly VERSION = 'v1';
  private static readonly ALGORITHM = 'aes-256-gcm';

  constructor(config: ConfigService<Env, true>) {
    const b64 = config.get('DATA_ENCRYPTION_KEY', { infer: true });
    if (b64) {
      const buf = Buffer.from(b64, 'base64');
      if (buf.length !== 32) {
        throw new Error('DATA_ENCRYPTION_KEY must decode to exactly 32 bytes');
      }
      this.key = buf;
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('DATA_ENCRYPTION_KEY is required in production');
      }
      // Deterministic dev-only key. Logged loudly so it cannot go unnoticed.
      this.key = Buffer.alloc(32, 0x11);
      this.logger.warn(
        'DATA_ENCRYPTION_KEY not set — using an insecure dev key. DO NOT use this in production.',
      );
    }
  }

  /** Encrypt a UTF-8 string; returns the versioned, self-describing ciphertext. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(CryptoService.ALGORITHM, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      CryptoService.VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      enc.toString('base64'),
    ].join('.');
  }

  /** Decrypt a value produced by {@link encrypt}. Throws if tampered with. */
  decrypt(blob: string): string {
    const parts = blob.split('.');
    if (parts.length !== 4 || parts[0] !== CryptoService.VERSION) {
      throw new Error('Invalid ciphertext format');
    }
    const [, ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64!, 'base64');
    const tag = Buffer.from(tagB64!, 'base64');
    const data = Buffer.from(dataB64!, 'base64');
    const decipher = createDecipheriv(CryptoService.ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return plain.toString('utf8');
  }

  /**
   * Returns true if the value looks like a v1 envelope produced by this service.
   * Lets the app handle both old (plaintext) and new (encrypted) rows during
   * a migration window.
   */
  isEncrypted(value: string | null | undefined): boolean {
    if (!value) return false;
    return value.startsWith(`${CryptoService.VERSION}.`);
  }

  /**
   * Constant-time equality. Useful when comparing tokens/secrets without
   * leaking length or byte position via timing.
   */
  safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
