import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { scrubUrl } from '../filters/http-exception.filter';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const started = Date.now();
    // Reuse the same redaction list as the exception filter so password reset
    // tokens, OAuth codes, etc. never land in the access log even on the happy path.
    const safeUrl = scrubUrl(req.url);

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - started;
          this.logger.log(`${req.method} ${safeUrl} ${ms}ms`);
        },
      }),
    );
  }
}
