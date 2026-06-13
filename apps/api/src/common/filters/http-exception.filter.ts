import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';

/**
 * Query parameters that must never land in logs or Sentry — we redact them
 * before anything else sees the URL.
 *
 * This list is defensive: the app doesn't pass these in query strings, but a
 * misconfigured client or a future endpoint might. Redacting here is cheap
 * insurance against a leak landing in a log aggregator.
 */
const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'code',
  'state',
  'password',
  'otp',
  'email',
  'phone',
]);

function scrubUrl(rawUrl: string): string {
  const [pathname, search] = rawUrl.split('?', 2);
  if (!search) return rawUrl;
  const scrubbed = search
    .split('&')
    .map((pair) => {
      const [k, v] = pair.split('=', 2);
      if (k && SENSITIVE_QUERY_PARAMS.has(decodeURIComponent(k).toLowerCase())) {
        return `${k}=REDACTED`;
      }
      return v === undefined ? pair : `${k}=${v}`;
    })
    .join('&');
  return `${pathname}?${scrubbed}`;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = isHttp ? exception.getResponse() : null;

    const scrubbedUrl = scrubUrl(request.url);

    // For non-HTTP exceptions (status 500) the underlying error message can carry
    // internal details — Prisma constraint text, file paths, driver errors. Never
    // surface those to the client: emit a stable generic message and a body that
    // does NOT spread the raw exception. HttpExceptions are author-controlled and
    // safe to echo.
    const message = isHttp
      ? this.extractMessage(raw, exception)
      : 'Internal server error';

    const payload = {
      statusCode: status,
      // Don't echo sensitive query params back to the client either.
      path: scrubbedUrl,
      method: request.method,
      timestamp: new Date().toISOString(),
      message,
      ...(isHttp && typeof raw === 'object' && raw !== null ? raw : {}),
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${scrubbedUrl} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Forward to Sentry when configured. Use the scrubbed URL here too —
      // Sentry stores every captured event indefinitely.
      Sentry.withScope((scope) => {
        scope.setTag('http.method', request.method);
        scope.setTag('http.status_code', String(status));
        scope.setContext('request', {
          url: scrubbedUrl,
          method: request.method,
          // request.ip is already a network artifact (not user-entered), but
          // we still keep it out of the public payload below.
          ip: request.ip,
        });
        Sentry.captureException(exception);
      });
    }

    response.status(status).json(payload);
  }

  private extractMessage(raw: unknown, exception: unknown): string {
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && raw && 'message' in raw) {
      const m = (raw as { message: unknown }).message;
      if (Array.isArray(m)) return m.join('; ');
      if (typeof m === 'string') return m;
    }
    if (exception instanceof Error) return exception.message;
    return 'Internal server error';
  }
}

// Exported for unit tests.
export { scrubUrl };
