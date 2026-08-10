import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.validation';
import { writeLog } from '../common/logger/json-logger';
import { PrismaService } from '../common/prisma/prisma.service';
import { CONTAINER_SELECTOR, buildLogQuery, type LogFilters } from './logql';

/**
 * Read-only proxy over the self-hosted monitoring stack (Prometheus + Loki).
 *
 * Both live on the private Docker networks and are NEVER published: the admin
 * console reaches them only through the role-gated endpoints of this module.
 * Queries are built here, never accepted from the client — see logql.ts.
 *
 * The API must keep working when the monitoring stack is down or not deployed
 * at all, so every failure degrades to `available: false` instead of a 500.
 */

/** Monitoring is a support tool: a slow backend must not pin an API worker. */
const QUERY_TIMEOUT_MS = 8_000;

/** Rate window used by every rate()/histogram_quantile() expression below. */
const RATE_WINDOW = '5m';

/**
 * Per-container rows are keyed on the IMAGE, not the container name, because
 * cAdvisor cannot name containers on this host: Docker 29 keeps its images in
 * containerd, so cAdvisor's docker factory fails ("failed to identify the
 * read-write layer ID") and the containerd factory falls back to labelling
 * every series with the raw container ID.
 *
 * Only images unique to NigerConnect on the shared VPS are listed. redis:7-alpine
 * (4 containers) and minio/minio (2) are served to several projects, so they are
 * left out rather than shown as someone else's numbers.
 */
const CONTAINERS_BY_IMAGE: ReadonlyArray<{ pattern: string; label: string }> = [
  { pattern: '(docker\\.io/)?(library/)?nigerconnect-api:.*', label: 'nigerconnect-api' },
  { pattern: '(docker\\.io/)?(library/)?nigerconnect-web:.*', label: 'nigerconnect-web' },
  { pattern: '(docker\\.io/)?postgis/postgis:.*', label: 'nigerconnect-postgres' },
];

const CONTAINER_MATCHER = `image=~"${CONTAINERS_BY_IMAGE.map((c) => c.pattern).join('|')}"`;

export interface OverviewMetrics {
  available: boolean;
  reason?: string;
  host: {
    /** Whole-host CPU usage, percent. The VPS is shared — this is everyone's load. */
    cpuPercent: number | null;
    memoryPercent: number | null;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
    diskPercent: number | null;
    /** Containers running on the host, all projects included. */
    containersTotal: number | null;
  };
  app: {
    /** NigerConnect containers currently seen by cAdvisor. */
    containers: number | null;
    requestsPerSecond: number | null;
    latencyP95Seconds: number | null;
    errorRatePercent: number | null;
    errorRate4xxPercent: number | null;
  };
  containers: ContainerUsage[];
}

export interface ContainerUsage {
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
}

export interface ErrorRatePoint {
  t: number;
  errorRate: number;
  requestsPerSecond: number;
}

export interface LogEntry {
  /** Milliseconds since epoch (Loki returns nanoseconds). */
  ts: number;
  container: string;
  stream: string;
  level: string | null;
  status: number | null;
  userId: string | null;
  /**
   * Résolu À L'AFFICHAGE depuis la base, jamais écrit dans Loki : un admin doit
   * pouvoir mettre un nom sur une ligne de log, sans qu'une donnée personnelle
   * directe traîne 30 jours dans le stockage de logs. `null` si le compte a
   * depuis été supprimé — la ligne, elle, reste.
   */
  userEmail: string | null;
  requestId: string | null;
  message: string;
  /** Raw line, kept so a non-JSON log (Postgres, Redis) stays readable. */
  raw: string;
}

interface PromVector {
  metric: Record<string, string>;
  value: [number, string];
}

interface PromMatrix {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

interface LokiStream {
  stream: Record<string, string>;
  values: Array<[string, string]>;
}

@Injectable()
export class ObservabilityService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  private get prometheusUrl(): string | undefined {
    return this.config.get('PROMETHEUS_URL', { infer: true });
  }

  private get lokiUrl(): string | undefined {
    return this.config.get('LOKI_URL', { infer: true });
  }

  /** Which backends are configured + reachable — drives the console's banner. */
  async status(): Promise<{
    prometheus: { configured: boolean; reachable: boolean };
    loki: { configured: boolean; reachable: boolean };
  }> {
    const [prometheus, loki] = await Promise.all([
      this.ping(this.prometheusUrl, '/-/ready'),
      this.ping(this.lokiUrl, '/ready'),
    ]);
    return {
      prometheus: { configured: Boolean(this.prometheusUrl), reachable: prometheus },
      loki: { configured: Boolean(this.lokiUrl), reachable: loki },
    };
  }

  async overview(): Promise<OverviewMetrics> {
    const empty: OverviewMetrics = {
      available: false,
      host: {
        cpuPercent: null,
        memoryPercent: null,
        memoryUsedBytes: null,
        memoryTotalBytes: null,
        diskPercent: null,
        containersTotal: null,
      },
      app: {
        containers: null,
        requestsPerSecond: null,
        latencyP95Seconds: null,
        errorRatePercent: null,
        errorRate4xxPercent: null,
      },
      containers: [],
    };

    if (!this.prometheusUrl) {
      return { ...empty, reason: 'PROMETHEUS_URL non configuré.' };
    }

    try {
      const [scalars, cpuByContainer, memByContainer] = await Promise.all([
        this.instantMany({
          cpuPercent: `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[${RATE_WINDOW}])) * 100)`,
          memoryPercent:
            '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',
          memoryUsedBytes: 'node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes',
          memoryTotalBytes: 'node_memory_MemTotal_bytes',
          // min(), not max(): we want the FULLEST filesystem, the one that will
          // page someone at 3am. max() reported the emptiest — 0.06 % on a host
          // whose root partition was 68 % full.
          diskPercent:
            '100 * (1 - min(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"}))',
          containersTotal: 'count(container_last_seen{name!=""})',
          containers: `count(container_last_seen{${CONTAINER_MATCHER}})`,
          requestsPerSecond: `sum(rate(http_requests_total[${RATE_WINDOW}]))`,
          latencyP95Seconds: `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[${RATE_WINDOW}])))`,
          errorRatePercent: this.errorRateExpr('5xx'),
          errorRate4xxPercent: this.errorRateExpr('4xx'),
        }),
        this.instant(
          `sum by (image) (rate(container_cpu_usage_seconds_total{${CONTAINER_MATCHER}}[${RATE_WINDOW}])) * 100`,
        ),
        this.instant(`sum by (image) (container_memory_working_set_bytes{${CONTAINER_MATCHER}})`),
      ]);

      const cpu = seriesByContainer(cpuByContainer);
      const memory = seriesByContainer(memByContainer);
      const names = new Set([...cpu.keys(), ...memory.keys()]);

      return {
        available: true,
        host: {
          cpuPercent: scalars.cpuPercent,
          memoryPercent: scalars.memoryPercent,
          memoryUsedBytes: scalars.memoryUsedBytes,
          memoryTotalBytes: scalars.memoryTotalBytes,
          diskPercent: scalars.diskPercent,
          containersTotal: scalars.containersTotal,
        },
        app: {
          containers: scalars.containers,
          requestsPerSecond: scalars.requestsPerSecond,
          latencyP95Seconds: scalars.latencyP95Seconds,
          errorRatePercent: scalars.errorRatePercent,
          errorRate4xxPercent: scalars.errorRate4xxPercent,
        },
        containers: [...names]
          .sort()
          .map((name) => ({
            name,
            cpuPercent: cpu.get(name) ?? null,
            memoryBytes: memory.get(name) ?? null,
          })),
      };
    } catch (err) {
      return { ...empty, reason: describeError(err) };
    }
  }

  /** Error-rate + throughput series for the trend chart. */
  async errorRateSeries(minutes: number, points: number): Promise<{
    available: boolean;
    reason?: string;
    series: ErrorRatePoint[];
  }> {
    if (!this.prometheusUrl) {
      return { available: false, reason: 'PROMETHEUS_URL non configuré.', series: [] };
    }
    const end = Math.floor(Date.now() / 1000);
    const start = end - minutes * 60;
    // Prometheus caps a range query at 11 000 points; `points` is bounded by the
    // controller schema, so the step can never degenerate to 0.
    const step = Math.max(15, Math.round((end - start) / points));

    try {
      const [errors, throughput] = await Promise.all([
        this.range(this.errorRateExpr('5xx'), start, end, step),
        this.range(`sum(rate(http_requests_total[${RATE_WINDOW}]))`, start, end, step),
      ]);
      const rps = new Map(
        (throughput[0]?.values ?? []).map(([t, v]) => [t, toNumber(v) ?? 0]),
      );
      const series = (errors[0]?.values ?? []).map(([t, v]) => ({
        t: t * 1000,
        errorRate: toNumber(v) ?? 0,
        requestsPerSecond: rps.get(t) ?? 0,
      }));
      return { available: true, series };
    } catch (err) {
      return { available: false, reason: describeError(err), series: [] };
    }
  }

  /** Filtered log search. Filters are whitelisted by the controller schema. */
  async logs(
    filters: LogFilters & { minutes: number; limit: number },
  ): Promise<{ available: boolean; reason?: string; query: string; entries: LogEntry[] }> {
    const query = buildLogQuery(filters);
    if (!this.lokiUrl) {
      return { available: false, reason: 'LOKI_URL non configuré.', query, entries: [] };
    }

    const end = Date.now();
    const start = end - filters.minutes * 60_000;
    const params = new URLSearchParams({
      query,
      // Loki wants nanoseconds.
      start: `${start}000000`,
      end: `${end}000000`,
      limit: String(filters.limit),
      direction: 'backward',
    });

    try {
      const data = await this.fetchJson<{ data?: { result?: LokiStream[] } }>(
        `${this.lokiUrl}/loki/api/v1/query_range?${params.toString()}`,
      );
      const entries = (data.data?.result ?? [])
        .flatMap((stream) =>
          stream.values.map(([ns, line]) => parseEntry(stream.stream, ns, line)),
        )
        // Loki returns one sorted list per stream; the merged view needs its own order.
        .sort((a, b) => b.ts - a.ts)
        .slice(0, filters.limit);
      await this.attachEmails(entries);
      return { available: true, query, entries };
    } catch (err) {
      return { available: false, reason: describeError(err), query, entries: [] };
    }
  }

  /**
   * UUID du compte portant cet email, `null` s'il n'existe pas. Permet de
   * filtrer les logs par email : c'est ce que l'admin a sous la main quand un
   * membre signale un problème, alors que Loki ne connaît que l'UUID.
   */
  async userIdForEmail(email: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /**
   * Met un email sur chaque ligne portant un `userId`, en UNE requête pour tout
   * le lot (une page fait jusqu'à 1000 lignes, souvent le même utilisateur).
   *
   * L'email est joint ICI, à la lecture, et non écrit dans la ligne de log :
   * Loki garde 30 jours, et une donnée personnelle directe n'a rien à y faire à
   * côté d'URLs et d'horodatages. L'admin voit ce qu'il lui faut pour enquêter,
   * le stockage de logs ne conserve qu'un pseudonyme.
   *
   * Best-effort : si la base ne répond pas, on rend les logs sans email plutôt
   * que de faire échouer la console de supervision.
   */
  private async attachEmails(entries: LogEntry[]): Promise<void> {
    const ids = [...new Set(entries.map((e) => e.userId).filter((id): id is string => !!id))];
    if (ids.length === 0) return;
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true },
      });
      const byId = new Map(users.map((u) => [u.id, u.email]));
      for (const entry of entries) {
        if (entry.userId) entry.userEmail = byId.get(entry.userId) ?? null;
      }
    } catch {
      /* best-effort : les logs restent lisibles sans email */
    }
  }

  /** Containers Loki currently has logs for — populates the filter dropdown. */
  async containers(): Promise<string[]> {
    if (!this.lokiUrl) return [];
    try {
      const data = await this.fetchJson<{ data?: string[] }>(
        `${this.lokiUrl}/loki/api/v1/label/container/values`,
      );
      const allowed = new RegExp(`^${CONTAINER_SELECTOR}$`);
      return (data.data ?? []).filter((name) => allowed.test(name)).sort();
    } catch {
      return [];
    }
  }

  // ── Prometheus plumbing ───────────────────────────────────────────────────

  /**
   * 5xx (or 4xx) share of traffic, in percent. `clamp_min` on the denominator
   * keeps an idle API at 0 % instead of NaN.
   */
  private errorRateExpr(klass: '4xx' | '5xx'): string {
    const numerator = `sum(rate(http_requests_total{status=~"${klass.charAt(0)}.."}[${RATE_WINDOW}])) or vector(0)`;
    const denominator = `clamp_min(sum(rate(http_requests_total[${RATE_WINDOW}])) or vector(0), 0.001)`;
    return `100 * (${numerator}) / (${denominator})`;
  }

  private async instantMany<K extends string>(
    queries: Record<K, string>,
  ): Promise<Record<K, number | null>> {
    const keys = Object.keys(queries) as K[];
    const results = await Promise.all(keys.map((key) => this.instant(queries[key])));
    const out = {} as Record<K, number | null>;
    keys.forEach((key, i) => {
      out[key] = toNumber(results[i]?.[0]?.value[1]);
    });
    return out;
  }

  private async instant(query: string): Promise<PromVector[]> {
    const url = `${this.prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
    const data = await this.fetchJson<{ data?: { result?: PromVector[] } }>(url);
    return data.data?.result ?? [];
  }

  private async range(
    query: string,
    start: number,
    end: number,
    step: number,
  ): Promise<PromMatrix[]> {
    const params = new URLSearchParams({
      query,
      start: String(start),
      end: String(end),
      step: String(step),
    });
    const data = await this.fetchJson<{ data?: { result?: PromMatrix[] } }>(
      `${this.prometheusUrl}/api/v1/query_range?${params.toString()}`,
    );
    return data.data?.result ?? [];
  }

  private async ping(base: string | undefined, path: string): Promise<boolean> {
    if (!base) return false;
    try {
      const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(3_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
    } catch (err) {
      // The URL carries the query; log it (no user data) so a broken expression
      // is diagnosable from the log explorer itself.
      writeLog('warn', 'Observability', 'Monitoring backend unreachable', {
        error: describeError(err),
      });
      throw new ServiceUnavailableException('Backend de supervision injoignable.');
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Backend de supervision: HTTP ${res.status}.`,
      );
    }
    return (await res.json()) as T;
  }
}

/**
 * Indexes a `sum by (image)` result under the friendly container name, dropping
 * images that aren't ours (see CONTAINERS_BY_IMAGE for why the image is the key).
 */
function seriesByContainer(series: PromVector[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const s of series) {
    const image = s.metric.image;
    if (!image) continue;
    const known = CONTAINERS_BY_IMAGE.find((c) => new RegExp(`^${c.pattern}$`).test(image));
    if (known) out.set(known.label, toNumber(s.value[1]));
  }
  return out;
}

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Erreur inconnue.';
}

/**
 * Turns one Loki value into a row. API lines are JSON (see JsonLogger) and get
 * their fields lifted; anything else (Postgres, Redis, MinIO) stays raw text.
 */
function parseEntry(labels: Record<string, string>, ns: string, line: string): LogEntry {
  const entry: LogEntry = {
    ts: Math.floor(Number(ns) / 1e6),
    container: labels.container ?? 'inconnu',
    stream: labels.stream ?? 'stdout',
    level: null,
    status: null,
    userId: null,
    userEmail: null,
    requestId: null,
    message: line,
    raw: line,
  };

  if (!line.startsWith('{')) return entry;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (typeof parsed.level === 'string') entry.level = parsed.level;
    if (typeof parsed.status === 'number') entry.status = parsed.status;
    if (typeof parsed.userId === 'string') entry.userId = parsed.userId;
    if (typeof parsed.requestId === 'string') entry.requestId = parsed.requestId;
    if (typeof parsed.msg === 'string') entry.message = parsed.msg;
  } catch {
    // Not our JSON after all — the raw line is already in place.
  }
  return entry;
}
