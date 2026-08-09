import type { LoggerService } from '@nestjs/common';

/**
 * Structured logging — one JSON object per line.
 *
 * Docker's json-file driver captures stdout/stderr verbatim and Promtail ships
 * those lines to Loki, so the log LINE is the log record: every field the admin
 * log explorer filters on (level, status, userId, requestId) has to be a real
 * JSON key, not text baked into a message.
 *
 * JSON is the default in production and plain text in dev (readable in a
 * terminal). `LOG_FORMAT=json|text` forces either one.
 *
 * Never pass a request body, a header or a token in `fields`: these lines leave
 * the process as-is and are retained 30 days in Loki.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const JSON_LOGS =
  (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json';

export interface LogFields {
  [key: string]: unknown;
}

/**
 * Write one log record. Errors go to stderr (matching Nest's ConsoleLogger and
 * giving Loki a usable `stream="stderr"` label), everything else to stdout.
 */
export function writeLog(
  level: LogLevel,
  context: string,
  message: string,
  fields?: LogFields,
): void {
  const stream = level === 'error' ? process.stderr : process.stdout;

  if (!JSON_LOGS) {
    const extra = fields && Object.keys(fields).length > 0 ? ` ${safeInline(fields)}` : '';
    stream.write(`${level.toUpperCase().padEnd(5)} [${context}] ${message}${extra}\n`);
    return;
  }

  const record = {
    ts: new Date().toISOString(),
    level,
    context,
    msg: message,
    ...fields,
  };
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    // A circular / non-serialisable field must never cost us the log line.
    line = JSON.stringify({ ts: record.ts, level, context, msg: message });
  }
  stream.write(`${line}\n`);
}

function safeInline(fields: LogFields): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
}

/**
 * Nest LoggerService adapter — installed in main.ts when JSON_LOGS is on so
 * framework logs land in Loki with the same shape as our own records.
 */
export class JsonLogger implements LoggerService {
  log(message: unknown, ...rest: unknown[]): void {
    this.emit('info', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }

  /**
   * Nest calls loggers as `(message, ...params, context)` — the trailing string
   * is the context, and for `error` the one before it is the stack.
   */
  private emit(level: LogLevel, message: unknown, rest: unknown[]): void {
    const params = [...rest];
    const context = typeof params[params.length - 1] === 'string' ? (params.pop() as string) : 'App';
    const stack = params.length > 0 ? params.map(stringify).join('\n') : undefined;
    writeLog(level, context, stringify(message), stack ? { stack } : undefined);
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
