import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './common/config/env.validation';
import { ConfigService } from '@nestjs/config';

async function bootstrap(): Promise<void> {
  // Initialize Sentry BEFORE creating the Nest app so early errors are captured
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: Number(
        process.env.SENTRY_TRACES_SAMPLE_RATE ??
          (process.env.NODE_ENV === 'production' ? '0.3' : '1.0'),
      ),
      // Don't send PII by default
      sendDefaultPii: false,
    });
    Logger.log('Sentry initialized', 'Bootstrap');
  }

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const config = app.get(ConfigService<Env, true>);

  const isProd = process.env.NODE_ENV === 'production';
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: isProd
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix('api', { exclude: ['health'] });

  // Graceful shutdown — flush Sentry events
  if (sentryDsn) {
    const shutdown = async (signal: string) => {
      Logger.log(`Received ${signal}, flushing Sentry and shutting down...`, 'Bootstrap');
      await Sentry.flush(2000);
      await app.close();
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`🚀 NigerConnect API running on port ${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(err, 'Bootstrap');
  Sentry.captureException(err);
  process.exit(1);
});
