import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

// Regulatory constant — NOT a runtime datum. 1 EUR = 655.957 XOF, the fixed
// UEMOA/CFA peg guaranteed by the French Treasury since 1999. If it ever
// changed (major geopolitical event), a code deploy fixes it — never a fetch.
export const EUR_XOF_PEG = 655.957;

const BANNER_CACHE_KEY = 'rates:banner';
const BANNER_TTL_SECONDS = 300; // 5 min — feed banner is cache-first

// PII-free contributor projection (mirror of CommunityPricesService). Never a
// contributor's real name or coarse location — display handle + avatar +
// ambassador badge only, even in the cached feed banner.
const SUBMITTER_SELECT = {
  id: true,
  displayName: true,
  avatarUrl: true,
  isAmbassador: true,
} as const satisfies Prisma.UserSelect;

export interface RatesToday {
  eurXof: number;
  usdXof: number | null;
  cadXof: number | null;
  asOf: string | null;
  source: 'ecb' | 'unavailable';
}

export interface ParsedEcbRates {
  asOf: string; // YYYY-MM-DD
  eurUsd: number;
  eurCad: number;
}

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Round to 4 decimals — plenty for a display rate, avoids float noise. */
  private round4(n: number): number {
    return Math.round(n * 10_000) / 10_000;
  }

  /**
   * FX of the day. EUR/XOF is the constant peg; USD/XOF & CAD/XOF are derived
   * from the latest snapshot (fail-open: the most recent stored day is served
   * even if today's ECB fetch failed). `asOf` reflects the real snapshot date
   * so the UI never claims a rate is fresher than it is. Empty table → the peg
   * alone, source 'unavailable' (never a fabricated USD/CAD value).
   */
  async getToday(): Promise<RatesToday> {
    const snap = await this.prisma.fxRateSnapshot.findFirst({
      orderBy: { asOf: 'desc' },
      select: { asOf: true, eurUsd: true, eurCad: true },
    });
    if (!snap) {
      return { eurXof: EUR_XOF_PEG, usdXof: null, cadXof: null, asOf: null, source: 'unavailable' };
    }
    const eurUsd = Number(snap.eurUsd);
    const eurCad = Number(snap.eurCad);
    return {
      eurXof: EUR_XOF_PEG,
      usdXof: eurUsd > 0 ? this.round4(EUR_XOF_PEG / eurUsd) : null,
      cadXof: eurCad > 0 ? this.round4(EUR_XOF_PEG / eurCad) : null,
      asOf: snap.asOf.toISOString().slice(0, 10),
      source: 'ecb',
    };
  }

  /**
   * Feed banner = FX + at most one representative price per type (most recent
   * active row with a non-negative trust score). Cache-first on Redis so a hot
   * feed costs ~nothing. On any Redis hiccup we fall back to a live build
   * rather than erroring (the banner must never block the feed).
   */
  async getBanner(): Promise<{ rates: RatesToday; prices: unknown[] }> {
    try {
      const cached = await this.redis.get(BANNER_CACHE_KEY);
      if (cached) return JSON.parse(cached) as { rates: RatesToday; prices: unknown[] };
    } catch (err) {
      this.logger.warn(`banner cache read failed: ${(err as Error).message}`);
    }

    const [rates, prices] = await Promise.all([
      this.getToday(),
      this.prisma.communityPrice.findMany({
        where: { status: 'active', trustScore: { gte: 0 } },
        orderBy: { createdAt: 'desc' },
        distinct: ['type'],
        include: { submitter: { select: SUBMITTER_SELECT } },
      }),
    ]);
    const payload = { rates, prices };

    try {
      await this.redis.set(BANNER_CACHE_KEY, JSON.stringify(payload), BANNER_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`banner cache write failed: ${(err as Error).message}`);
    }
    return payload;
  }

  /**
   * Parse the ECB `eurofxref-daily.xml` defensively — no XML lib, no dependency.
   * Returns null (skip, keep prior snapshot) if the time attribute or either of
   * USD/CAD is missing/unparseable. Never invents a default value.
   */
  parseEcbXml(xml: string): ParsedEcbRates | null {
    const timeMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
    if (!timeMatch) return null;
    const rateFor = (code: string): number | null => {
      const m = xml.match(new RegExp(`currency=['"]${code}['"]\\s+rate=['"]([0-9.]+)['"]`));
      if (!m) return null;
      const v = Number(m[1]);
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    const eurUsd = rateFor('USD');
    const eurCad = rateFor('CAD');
    if (eurUsd == null || eurCad == null) return null;
    return { asOf: timeMatch[1]!, eurUsd, eurCad };
  }

  /**
   * Idempotent upsert on the publication day — a re-run the same day updates the
   * existing row instead of duplicating it. Invalidates the banner cache so the
   * fresh rate surfaces without waiting for the TTL.
   */
  async upsertSnapshot(parsed: ParsedEcbRates): Promise<void> {
    const asOf = new Date(`${parsed.asOf}T00:00:00.000Z`);
    await this.prisma.fxRateSnapshot.upsert({
      where: { asOf },
      create: { asOf, eurUsd: parsed.eurUsd.toString(), eurCad: parsed.eurCad.toString(), source: 'ecb' },
      update: { eurUsd: parsed.eurUsd.toString(), eurCad: parsed.eurCad.toString(), fetchedAt: new Date() },
    });
    try {
      await this.redis.del(BANNER_CACHE_KEY);
    } catch {
      // Non-fatal: the cache expires on its own TTL.
    }
  }
}
