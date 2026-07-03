import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { RatesService } from './rates.service';

@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  // FX of the day — public, read-only, never blocks (fail-open).
  @Public()
  @Get('today')
  today() {
    return this.rates.getToday();
  }

  // Aggregated feed banner (FX + one price per type), cache-first on Redis.
  // Auth-gated: it embeds community prices with a contributor projection, so it
  // must not be reachable anonymously (aligned with marketplace /services). The
  // pure-FX /rates/today above carries NO submitter and stays @Public.
  @Get('banner')
  banner() {
    return this.rates.getBanner();
  }
}
