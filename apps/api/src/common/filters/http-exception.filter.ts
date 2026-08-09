import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';
import { writeLog } from '../logger/json-logger';

/**
 * Query parameters that must never land in logs or Sentry — we redact them
 * before anything else sees the URL.
 *
 * Two lists on purpose. A FRAGMENT matches anywhere in the key, so a future
 * `reset_token` or `apiKey` is covered without anyone remembering to come back
 * here. EXACT holds the short names that would swallow innocent params as a
 * fragment — `code` would otherwise redact `country_code`.
 */
const SENSITIVE_FRAGMENTS = [
  'token',
  'password',
  'passwd',
  'secret',
  'signature',
  'credential',
  'apikey',
  'api_key',
  'api-key',
  'auth',
  'session',
];

const SENSITIVE_EXACT = new Set(['code', 'state', 'otp', 'email', 'phone', 'key', 'sig', 'pwd', 'jwt']);

function isSensitiveParam(rawKey: string): boolean {
  // A malformed percent-escape (`?%zz=1`) makes decodeURIComponent throw, and
  // this runs on EVERY request from the access-log middleware — where a throw
  // is an uncaught exception that kills the process. Fall back to the raw key.
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    key = rawKey;
  }
  key = key.toLowerCase();
  return SENSITIVE_EXACT.has(key) || SENSITIVE_FRAGMENTS.some((f) => key.includes(f));
}

function scrubUrl(rawUrl: string): string {
  const [pathname, search] = rawUrl.split('?', 2);
  if (!search) return rawUrl;
  const scrubbed = search
    .split('&')
    .map((pair) => {
      // Split on the FIRST '=' only, and keep the rest of the pair verbatim:
      // base64 values carry '=' padding and would otherwise be truncated.
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      return isSensitiveParam(key) ? `${key}=REDACTED` : pair;
    })
    .join('&');
  return `${pathname}?${scrubbed}`;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
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
      // Structured on purpose: the admin log explorer filters on these keys, and
      // `stack` is the only place a 5xx root cause survives (the client payload
      // is deliberately generic).
      const requestId = (request as Request & { requestId?: string }).requestId;
      writeLog('error', 'GlobalExceptionFilter', `${request.method} ${scrubbedUrl} → ${status}`, {
        ...(requestId ? { requestId } : {}),
        method: request.method,
        url: scrubbedUrl,
        status,
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
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
