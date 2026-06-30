import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
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

  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    logger: isProd
      ? ['log', 'error', 'warn']
      : ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const config = app.get(ConfigService<Env, true>);

  // Trust the reverse proxy chain in front of us so Express derives `req.ip` /
  // `X-Forwarded-For` from the real client instead of a proxy's address. Without
  // this, every request appears to come from the proxy and all clients share one
  // per-IP rate-limit bucket — defeating the OAuth/login throttles.
  //
  // The hop count MUST match the real topology (prod: Cloudflare → Traefik → api
  // = 2 hops). A wrong value silently mis-buckets the rate limiter, so we refuse
  // to guess in production: TRUST_PROXY_HOPS must be set explicitly there. Local
  // dev (no proxy) falls back to 1.
  const rawTrustProxyHops = process.env.TRUST_PROXY_HOPS;
  if (
    process.env.NODE_ENV === 'production' &&
    (rawTrustProxyHops === undefined || rawTrustProxyHops === '')
  ) {
    throw new Error(
      'TRUST_PROXY_HOPS must be set in production (e.g. 2 for Cloudflare → Traefik → api). ' +
        'Refusing to start with a guessed default that would mis-bucket the rate limiter.',
    );
  }
  const trustProxyHops = Number(rawTrustProxyHops ?? '1');
  const expressInstance = app.getHttpAdapter().getInstance() as {
    set(setting: string, val: unknown): void;
  };
  expressInstance.set('trust proxy', Number.isFinite(trustProxyHops) ? trustProxyHops : 1);

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
  // Auth is Bearer-token-based — we never read or set browser cookies. Setting
  // `credentials: true` would make the API echo `Access-Control-Allow-Credentials: true`
  // and authorise any future cookie to be sent cross-origin, broadening the
  // attack surface (CSRF on any endpoint that ever starts using cookies). Leave
  // it false until we explicitly need cookie auth.
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: false,
    // Cap the preflight cache: 10 min is enough to coalesce burst preflights
    // without being so long that a CORS policy change takes hours to propagate.
    maxAge: 600,
  });
  // Bound the request body. Chat caps messages at 4kB (sanitizer-side) and the
  // largest JSON payloads are presigned-upload metadata + report descriptions —
  // 256kB leaves plenty of headroom while making it expensive to mass-spray
  // huge bodies at the API.
  app.use(json({ limit: '256kb' }));
  app.use(urlencoded({ extended: false, limit: '256kb' }));
  // Health endpoints stay unprefixed: Docker/Traefik healthchecks, the prod
  // smoke script and the Playwright e2e runbook all probe /health[/live|/ready].
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live', 'health/ready'] });

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
