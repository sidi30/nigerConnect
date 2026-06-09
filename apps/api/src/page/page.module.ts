import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module';
import { PageController } from './page.controller';
import { PageService } from './page.service';

@Module({
  imports: [GeoModule],
  controllers: [PageController],
  providers: [PageService],
  exports: [PageService],
})
export class PageModule {}
