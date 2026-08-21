import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module';
import { AssociationController } from './association.controller';
import { AssociationService } from './association.service';

@Module({
  imports: [GeoModule],
  controllers: [AssociationController],
  providers: [AssociationService],
  // AssociationService is exported so other modules can import
  // AssociationModule and inject it — in particular for
  // `isLeaderOfAnyAssociation(userId, { countryCode? })`, the generic-role
  // capability a future "Réalisations" moderation module (docs/REALISATIONS.md,
  // not started yet) is meant to consume instead of reaching into
  // `assertRole`/ELEVATED_ROLES directly. See that method's doc comment in
  // association.service.ts for the full rationale.
  exports: [AssociationService],
})
export class AssociationModule {}
