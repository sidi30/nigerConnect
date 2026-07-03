import { Module } from '@nestjs/common';
import { CommunityPricesController } from './community-prices.controller';
import { CommunityPricesService } from './community-prices.service';
import { RatesController } from './rates.controller';
import { RatesCron } from './rates.cron';
import { RatesService } from './rates.service';

// E-TAUX: FX of the day (ECB free feed + UEMOA peg) and crowdsourced prices.
// Redis is @Global (cache + throttle counter) — no import needed.
@Module({
  controllers: [RatesController, CommunityPricesController],
  providers: [RatesService, CommunityPricesService, RatesCron],
  exports: [RatesService, CommunityPricesService],
})
export class RatesModule {}
