import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { WorldCitiesService } from './world-cities';

@Module({
  controllers: [GeoController],
  // WorldCitiesService builds the in-memory city index once at OnModuleInit;
  // GeoService uses it both for the /geo/cities search endpoint and for wiring
  // the world-city geocoder fallback into the auth flow.
  providers: [GeoService, WorldCitiesService],
  // Export WorldCitiesService so other modules (e.g. a future profile module)
  // can inject it without re-importing the raw dataset.
  exports: [WorldCitiesService],
})
export class GeoModule {}
