import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RatesService } from './rates.service';

const INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h (ECB publishes ~1×/business day)
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Refreshes the ECB FX snapshot on a timer. The feed is a free, public, static
 * XML (no key, no quota). FAIL-OPEN by design: any network/parse failure is
 * logged and swallowed — getToday() keeps serving the last good snapshot, we
 * never overwrite it with an inferred value. No-op under NODE_ENV=test so the
 * suite never touches the network.
 */
@Injectable()
export class RatesCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RatesCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly rates: RatesService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    // Kick once at boot (best-effort) then every 6h.
    void this.run();
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let xml: string;
      try {
        const res = await fetch(ECB_URL, { signal: controller.signal });
        if (!res.ok) {
          this.logger.warn(`ECB feed HTTP ${res.status} — keeping last snapshot`);
          return;
        }
        xml = await res.text();
      } finally {
        clearTimeout(t);
      }

      const parsed = this.rates.parseEcbXml(xml);
      if (!parsed) {
        this.logger.warn('ECB feed unparseable/incomplete — keeping last snapshot');
        return;
      }
      await this.rates.upsertSnapshot(parsed);
      this.logger.log(`FX snapshot updated asOf=${parsed.asOf}`);
    } catch (error) {
      // Fail-open: never let an ECB outage surface as an API error.
      this.logger.error('ECB FX refresh failed (fail-open)', error as Error);
    }
  }
}
