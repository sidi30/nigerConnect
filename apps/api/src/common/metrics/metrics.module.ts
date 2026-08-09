import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HttpObservabilityMiddleware } from './http-observability.middleware';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Global so any module can inject MetricsService to add a business counter
 * without re-importing this module (see docs/OBSERVABILITE.md).
 */
@Global()
@Module({
  controllers: [MetricsController],
  // The middleware is listed explicitly so its MetricsService dependency is
  // resolved from this module's injector rather than by convention.
  providers: [MetricsService, HttpObservabilityMiddleware],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpObservabilityMiddleware).forRoutes('*');
  }
}
