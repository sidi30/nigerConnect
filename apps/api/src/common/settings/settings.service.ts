import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type RegistrationMode = 'open' | 'invite_only' | 'closed';

const SETTING_KEY_PREFIX = 'setting:';
const CACHE_TTL_SECONDS = 300; // 5 min — write-through ensures near-instant propagation

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Read registration_mode from Redis (write-through cache) with a safe fallback to 'open'.
   * Never throws — a Redis failure gracefully falls back to a DB read, and a DB failure
   * returns 'open' so a misconfigured service never locks everyone out.
   */
  async getRegistrationMode(): Promise<RegistrationMode> {
    return this.getSetting('registration_mode', 'open') as Promise<RegistrationMode>;
  }

  /**
   * Generic setting read with Redis write-through cache.
   * Falls back to `defaultValue` if neither cache nor DB has the key.
   */
  async getSetting(key: string, defaultValue: string): Promise<string> {
    const cacheKey = `${SETTING_KEY_PREFIX}${key}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return cached;
    } catch (e) {
      this.logger.warn(`Redis get failed for setting:${key}: ${String(e)}`);
    }

    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key } });
      const val = row?.value ?? defaultValue;
      try {
        await this.redis.set(cacheKey, val, CACHE_TTL_SECONDS);
      } catch (e) {
        this.logger.warn(`Redis set failed for setting:${key}: ${String(e)}`);
      }
      return val;
    } catch (e) {
      this.logger.error(`DB read failed for setting:${key}: ${String(e)}`);
      return defaultValue;
    }
  }

  /**
   * Upsert a setting in the DB and immediately update the Redis cache (write-through).
   * The write-through means the new value is effective on the next request — no TTL wait.
   */
  async setSetting(key: string, value: string, adminId?: string): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value, updatedById: adminId ?? null },
      update: { value, updatedById: adminId ?? null },
    });
    // Write-through: cache the new value immediately so it's visible without waiting for TTL expiry.
    try {
      await this.redis.set(`${SETTING_KEY_PREFIX}${key}`, value, CACHE_TTL_SECONDS);
    } catch (e) {
      this.logger.warn(`Redis write-through failed for setting:${key}: ${String(e)}`);
    }
  }

  async getDefaultInviteQuota(): Promise<number> {
    const val = await this.getSetting('default_invite_quota', '3');
    return parseInt(val, 10) || 3;
  }

  async getInviteExpiryDays(): Promise<number> {
    const val = await this.getSetting('invite_expiry_days', '30');
    return parseInt(val, 10) || 30;
  }

  /**
   * "Admin full visibility" override for support: when the `admin_full_visibility`
   * setting is ON, an admin (only the admin role — never moderator) bypasses the
   * map opt-in (showOnMap) and the private-profile gate, so they can see every
   * member on the map and open any profile to resolve issues. OFF by default;
   * privacy-sensitive, audited via the setting's updatedById.
   */
  async isAdminFullVisibility(role: string | undefined): Promise<boolean> {
    if (role !== 'admin') return false;
    return this.isFullVisibilityActive();
  }

  /**
   * Effective state of the support override: enabled AND not expired. The toggle
   * auto-expires (`admin_full_visibility_until`) so it can't be left on forever —
   * fail-closed: enabled without a future expiry counts as OFF.
   */
  async isFullVisibilityActive(): Promise<boolean> {
    if ((await this.getSetting('admin_full_visibility', 'false')) !== 'true') return false;
    const until = await this.getSetting('admin_full_visibility_until', '');
    if (!until) return false;
    const ts = Date.parse(until);
    return Number.isFinite(ts) && ts > Date.now();
  }

  /** ISO expiry of the override (or null when off/expired). */
  async fullVisibilityUntil(): Promise<string | null> {
    if (!(await this.isFullVisibilityActive())) return null;
    return (await this.getSetting('admin_full_visibility_until', '')) || null;
  }

  /**
   * Master kill-switch for the proximity-encounter feature. OFF by default so the
   * feature ships DARK and a misconfig / DB failure fails CLOSED (off). Flip to
   * 'true' via the admin settings to enable, then roll out per city below.
   */
  async isProximityEnabled(): Promise<boolean> {
    return (await this.getSetting('proximity_enabled', 'false')) === 'true';
  }

  /**
   * Region allowlist for the proximity rollout. Pilots can be scoped by CITY
   * (`proximity_cities`, matched against user.city, case-insensitive) and/or by
   * COUNTRY (`proximity_countries`, matched against user.countryCode, e.g. 'FR').
   * Both empty = no restriction (everyone). When at least one list is set, a user
   * is in scope if their country OR their city matches; a user with neither field
   * is out of scope (fail-closed).
   */
  async isProximityRegionAllowed(
    city: string | null | undefined,
    countryCode: string | null | undefined,
  ): Promise<boolean> {
    const cities = this.parseCsv(await this.getSetting('proximity_cities', '')).map((c) =>
      c.toLowerCase(),
    );
    const countries = this.parseCsv(await this.getSetting('proximity_countries', '')).map((c) =>
      c.toUpperCase(),
    );
    if (cities.length === 0 && countries.length === 0) return true;
    if (countryCode && countries.includes(countryCode.trim().toUpperCase())) return true;
    if (city && cities.includes(city.trim().toLowerCase())) return true;
    return false;
  }

  private parseCsv(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
