import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus registry for the API.
 *
 * A dedicated `Registry` (not prom-client's global one) keeps the metric set
 * scoped to this Nest instance — two apps created in the same Jest process
 * would otherwise collide on duplicate metric names.
 *
 * Label cardinality is the thing that kills a Prometheus: `route` is always the
 * Express route TEMPLATE (`/api/admin/users/:id`), never the concrete URL, and
 * unmatched requests collapse into a single `unmatched` bucket.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly requests: Counter<'method' | 'route' | 'status'>;
  private readonly duration: Histogram<'method' | 'route'>;
  private readonly errors: Counter<'method' | 'route' | 'class'>;

  constructor() {
    this.registry.setDefaultLabels({ app: 'nigerconnect-api' });
    // process_* / nodejs_* : heap, event-loop lag, handles. Free RSS + GC data.
    collectDefaultMetrics({ register: this.registry });

    this.requests = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests handled, by method, route template and status code',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.duration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds, by method and route template',
      labelNames: ['method', 'route'],
      // Tuned for an API whose slowest normal calls are geo/feed queries; the
      // 0.25/0.5 pair is where a p95 regression first becomes visible.
      buckets: [0.005, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.errors = new Counter({
      name: 'http_errors_total',
      help: 'HTTP responses with a 4xx or 5xx status, by class',
      labelNames: ['method', 'route', 'class'],
      registers: [this.registry],
    });
  }

  observeHttp(method: string, route: string, status: number, seconds: number): void {
    const labels = { method, route };
    this.requests.inc({ ...labels, status: String(status) });
    this.duration.observe(labels, seconds);
    if (status >= 400) {
      this.errors.inc({ ...labels, class: status >= 500 ? '5xx' : '4xx' });
    }
  }

  scrape(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
