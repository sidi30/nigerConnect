import { Module } from '@nestjs/common';
import { StorageModule } from '../common/storage/storage.module';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [StorageModule],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class MarketplaceModule {}
