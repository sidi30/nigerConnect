import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module';
import { AssociationController } from './association.controller';
import { AssociationService } from './association.service';

@Module({
  imports: [GeoModule],
  controllers: [AssociationController],
  providers: [AssociationService],
  exports: [AssociationService],
})
export class AssociationModule {}
