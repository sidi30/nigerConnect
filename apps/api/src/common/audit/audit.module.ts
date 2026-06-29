import { Global, Module } from '@nestjs/common';
import { AdminAuditService } from './audit.service';

// Global so geo/profile services (and the admin console) can record + read the
// privileged-access audit trail without importing a module each time.
@Global()
@Module({
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AuditModule {}
