"use client";

// Observabilité — métriques infra/site + explorateur de logs centralisés.
//
// Tout passe par le proxy admin de l'API (/admin/observability/*) : Prometheus
// et Loki vivent sur un réseau Docker privé et ne sont jamais joignables depuis
// le navigateur. Les filtres partent en query params, la requête LogQL/PromQL
// est construite côté serveur.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Search,
  ServerCog,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AdminApiError,
  fetchErrorRateSeries,
  fetchLogContainers,
  fetchLogs,
  fetchObservabilityOverview,
  type ContainerUsage,
  type ErrorRatePoint,
  type LogEntry,
  type LogLevel,
  type LogStatusClass,
  type ObservabilityOverview,
} from "@/lib/adminApi";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  GhostButton,
  palette,
  Skeleton,
  StatusChip,
  type ChipTone,
} from "./ui";

// Au-delà, le taux d'erreur passe en rouge — même seuil que le dashboard Grafana.
const CRITICAL_ERROR_RATE = 5;
const WARNING_ERROR_RATE = 1;

// Les KPI se rafraîchissent seuls ; les logs restent figés tant qu'on n'a pas
// relancé la recherche (rien de pire qu'une liste qui bouge pendant la lecture).
const REFRESH_MS = 30_000;

const RANGES = [
  { label: "1 h", minutes: 60 },
  { label: "6 h", minutes: 360 },
  { label: "24 h", minutes: 1440 },
  { label: "7 j", minutes: 10080 },
  { label: "30 j", minutes: 43200 },
] as const;

const LEVELS: Array<{ value: LogLevel; label: string }> = [
  { value: "error", label: "Erreur" },
  { value: "warn", label: "Avertissement" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
];

const STATUS_CLASSES: Array<{ value: LogStatusClass; label: string }> = [
  { value: "2xx", label: "2xx — succès" },
  { value: "3xx", label: "3xx — redirection" },
  { value: "4xx", label: "4xx — erreur client" },
  { value: "5xx", label: "5xx — erreur serveur" },
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const selectClass =
  "w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50";

export default function ObservabilitySection() {
  return (
    <section>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-[#1A0F0A]">Observabilité</h2>
        <p className="text-sm text-[#8A6B4D] mt-0.5">
          Santé de l&apos;infrastructure, trafic de l&apos;API et logs centralisés
          (30 jours de rétention).
        </p>
      </div>

      <div className="space-y-6">
        <MetricsPanel />
        <LogExplorer />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Métriques infra + site
// ---------------------------------------------------------------------------

function MetricsPanel() {
  const [overview, setOverview] = useState<ObservabilityOverview | null>(null);
  const [series, setSeries] = useState<ErrorRatePoint[]>([]);
  const [minutes, setMinutes] = useState<number>(360);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const [o, s] = await Promise.all([
          fetchObservabilityOverview(signal),
          fetchErrorRateSeries(minutes, signal),
        ]);
        setOverview(o);
        setSeries(s.series);
      } catch (e) {
        if (signal?.aborted) return;
        setError(
          e instanceof AdminApiError ? e.message : "Chargement des métriques impossible.",
        );
      } finally {
        setLoading(false);
      }
    },
    [minutes],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const id = window.setInterval(() => void load(controller.signal), REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [load]);

  if (loading && !overview) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={() => void load()} />;
  }

  if (overview && !overview.available) {
    return (
      <EmptyState>
        <div className="flex flex-col items-center gap-2">
          <ServerCog className="w-6 h-6 text-[#8A6B4D]" aria-hidden="true" />
          <p className="font-semibold text-[#1A0F0A]">Supervision indisponible</p>
          <p className="text-sm max-w-md">
            {overview.reason ?? "La stack Prometheus/Loki ne répond pas."} Voir{" "}
            <code className="text-xs">docs/OBSERVABILITE.md</code> pour la démarrer.
          </p>
        </div>
      </EmptyState>
    );
  }

  const host = overview?.host;
  const app = overview?.app;
  const errorRate = app?.errorRatePercent ?? null;

  return (
    <div className="space-y-4">
      {/* KPI site */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric
          icon={Activity}
          label="Requêtes / s"
          value={formatNumber(app?.requestsPerSecond, 2)}
          sublabel="moyenne sur 5 min"
        />
        <Metric
          icon={Gauge}
          label="Latence p95"
          value={
            app?.latencyP95Seconds === null || app?.latencyP95Seconds === undefined
              ? "—"
              : `${Math.round(app.latencyP95Seconds * 1000)} ms`
          }
          sublabel="95 % des requêtes en dessous"
          tone={
            app?.latencyP95Seconds !== null && (app?.latencyP95Seconds ?? 0) > 1
              ? "amber"
              : undefined
          }
        />
        <Metric
          icon={AlertTriangle}
          label="Taux d'erreur 5xx"
          value={errorRate === null ? "—" : `${errorRate.toFixed(2)} %`}
          sublabel={`4xx : ${formatNumber(app?.errorRate4xxPercent, 2)} %`}
          tone={errorRateTone(errorRate)}
        />
        <Metric
          icon={ServerCog}
          label="Conteneurs supervisés"
          value={
            app?.containers === null || app?.containers === undefined
              ? "—"
              : String(app.containers)
          }
          sublabel={
            host?.containersTotal
              ? `sur ${host.containersTotal} sur l'hôte`
              : "NigerConnect"
          }
        />
      </div>

      {/* KPI hôte — le VPS est mutualisé, ces chiffres couvrent tous les projets */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metric
          icon={Cpu}
          label="CPU hôte"
          value={formatPercent(host?.cpuPercent)}
          sublabel="tous projets confondus"
          tone={thresholdTone(host?.cpuPercent, 75, 90)}
        />
        <Metric
          icon={MemoryStick}
          label="RAM hôte"
          value={formatPercent(host?.memoryPercent)}
          sublabel={
            host?.memoryUsedBytes && host.memoryTotalBytes
              ? `${formatBytes(host.memoryUsedBytes)} / ${formatBytes(host.memoryTotalBytes)}`
              : "tous projets confondus"
          }
          tone={thresholdTone(host?.memoryPercent, 80, 92)}
        />
        <Metric
          icon={HardDrive}
          label="Disque hôte"
          value={formatPercent(host?.diskPercent)}
          sublabel="partition la plus remplie"
          tone={thresholdTone(host?.diskPercent, 75, 90)}
        />
      </div>

      {/* Courbe du taux d'erreur avec seuil critique */}
      <Card className="p-5">
        <CardHeader
          title="Taux d'erreur dans le temps"
          subtitle={`Part de réponses 5xx. Rouge au-delà de ${CRITICAL_ERROR_RATE} %.`}
          icon={AlertTriangle}
          right={
            <div className="flex gap-1">
              {RANGES.slice(0, 4).map((r) => (
                <button
                  key={r.minutes}
                  type="button"
                  onClick={() => setMinutes(r.minutes)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    minutes === r.minutes
                      ? "bg-[#FDF0E6] text-[#E05206]"
                      : "text-[#8A6B4D] hover:bg-[#FDFBF7]"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          }
        />
        <ErrorRateChart data={series} />
      </Card>

      {/* Détail par conteneur */}
      <Card className="p-5">
        <CardHeader
          title="Conteneurs NigerConnect"
          subtitle="CPU et mémoire de travail, moyenne sur 5 min"
          icon={ServerCog}
        />
        <ContainerTable rows={overview?.containers ?? []} />
      </Card>
    </div>
  );
}

function ErrorRateChart({ data }: { data: ErrorRatePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-52 grid place-items-center text-sm text-[#8A6B4D]">
        Aucune donnée sur la période
      </div>
    );
  }
  const peak = Math.max(...data.map((p) => p.errorRate));
  // On garde le seuil visible même quand tout va bien : un graphe plat à 0 avec
  // la ligne rouge en haut se lit bien mieux qu'un axe auto-zoomé sur le bruit.
  const yMax = Math.max(CRITICAL_ERROR_RATE * 1.4, Math.ceil(peak * 1.2));

  return (
    <div
      role="img"
      aria-label={`Taux d'erreur 5xx, pic à ${peak.toFixed(2)} % sur la période. Seuil critique ${CRITICAL_ERROR_RATE} %.`}
      style={{ width: "100%", height: 220 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="obs-error-rate" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.red} stopOpacity={0.25} />
              <stop offset="100%" stopColor={palette.red} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={palette.border} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={formatClock}
            tick={{ fill: palette.faint, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: palette.border }}
            minTickGap={40}
          />
          <YAxis
            domain={[0, yMax]}
            tickFormatter={(v: number) => `${v.toFixed(0)} %`}
            tick={{ fill: palette.faint, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              borderRadius: 12,
              fontSize: 12,
            }}
            labelFormatter={(v) => formatDateTime(Number(v))}
            formatter={(value, name) => {
              const n = Number(value);
              return name === "errorRate"
                ? [`${n.toFixed(2)} %`, "Erreurs 5xx"]
                : [`${n.toFixed(2)} req/s`, "Trafic"];
            }}
          />
          <ReferenceLine
            y={CRITICAL_ERROR_RATE}
            stroke={palette.red}
            strokeDasharray="4 4"
            label={{
              value: `critique ${CRITICAL_ERROR_RATE} %`,
              position: "insideTopRight",
              fill: palette.red,
              fontSize: 11,
            }}
          />
          <Area
            type="monotone"
            dataKey="errorRate"
            stroke={palette.red}
            strokeWidth={2}
            fill="url(#obs-error-rate)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ContainerTable({ rows }: { rows: ContainerUsage[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[#8A6B4D]">
        Aucun conteneur remonté par cAdvisor pour le moment. Seuls api, web et
        postgres sont identifiables sur cet hôte : redis et minio partagent leur
        image avec d&apos;autres projets du VPS.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-[#8A6B4D] uppercase tracking-wide">
            <th className="pb-2">Conteneur</th>
            <th className="pb-2 text-right">CPU</th>
            <th className="pb-2 text-right">Mémoire</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-[#E8DFD3]">
              <td className="py-2 font-medium text-[#1A0F0A]">{row.name}</td>
              <td className="py-2 text-right tabular-nums text-[#5A4634]">
                {formatPercent(row.cpuPercent)}
              </td>
              <td className="py-2 text-right tabular-nums text-[#5A4634]">
                {row.memoryBytes === null ? "—" : formatBytes(row.memoryBytes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sublabel,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sublabel?: string;
  tone?: ChipTone;
}) {
  const accent =
    tone === "red"
      ? "bg-[#FCE8E8] text-[#B91C1C]"
      : tone === "amber"
        ? "bg-[#FEF3E2] text-[#B45309]"
        : "bg-[#FDF0E6] text-[#E05206]";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${accent}`}>
          <Icon size={18} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="text-xs font-semibold text-[#8A6B4D] uppercase tracking-wide truncate">
          {label}
        </span>
      </div>
      <div className="mt-3 text-2xl font-bold text-[#1A0F0A] tabular-nums leading-none">
        {value}
      </div>
      {sublabel ? <div className="text-xs text-[#5A4634] mt-1.5">{sublabel}</div> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Explorateur de logs
// ---------------------------------------------------------------------------

interface Filters {
  minutes: number;
  container: string;
  level: "" | LogLevel;
  statusClass: "" | LogStatusClass;
  status: string;
  userId: string;
  search: string;
  limit: number;
}

const DEFAULT_FILTERS: Filters = {
  minutes: 60,
  container: "",
  level: "",
  statusClass: "",
  status: "",
  userId: "",
  search: "",
  limit: 200,
};

function LogExplorer() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [containers, setContainers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchLogContainers(controller.signal)
      .then(setContainers)
      .catch(() => setContainers([]));
    return () => controller.abort();
  }, []);

  const statusError = useMemo(() => {
    if (!filters.status) return null;
    const n = Number(filters.status);
    return Number.isInteger(n) && n >= 100 && n <= 599
      ? null
      : "Code HTTP attendu entre 100 et 599.";
  }, [filters.status]);

  const userIdError = useMemo(
    () => (filters.userId && !UUID_RE.test(filters.userId) ? "UUID attendu." : null),
    [filters.userId],
  );

  const run = useCallback(async () => {
    if (statusError || userIdError) return;
    // Une recherche précédente encore en vol renverrait des résultats périmés.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await fetchLogs(
        {
          minutes: filters.minutes,
          limit: filters.limit,
          ...(filters.container ? { container: filters.container } : {}),
          ...(filters.level ? { level: filters.level } : {}),
          ...(filters.statusClass ? { statusClass: filters.statusClass } : {}),
          ...(filters.status ? { status: Number(filters.status) } : {}),
          ...(filters.userId ? { userId: filters.userId } : {}),
          ...(filters.search ? { search: filters.search } : {}),
        },
        controller.signal,
      );
      setEntries(res.entries);
      setQuery(res.query);
      setUnavailable(res.available ? null : (res.reason ?? "Loki injoignable."));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof AdminApiError ? e.message : "Recherche impossible.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [filters, statusError, userIdError]);

  // Première recherche au montage seulement : ensuite c'est l'admin qui décide.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="Explorateur de logs"
        subtitle="Tous les conteneurs NigerConnect, 30 jours d'historique"
        icon={Search}
        right={
          <GhostButton onClick={() => void run()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? " Recherche…" : " Rechercher"}
          </GhostButton>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Field label="Période">
          <select
            className={selectClass}
            value={filters.minutes}
            onChange={(e) => set("minutes", Number(e.target.value))}
          >
            {RANGES.map((r) => (
              <option key={r.minutes} value={r.minutes}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Conteneur">
          <select
            className={selectClass}
            value={filters.container}
            onChange={(e) => set("container", e.target.value)}
          >
            <option value="">Tous</option>
            {containers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Niveau">
          <select
            className={selectClass}
            value={filters.level}
            onChange={(e) => set("level", e.target.value as Filters["level"])}
          >
            <option value="">Tous</option>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Classe HTTP">
          <select
            className={selectClass}
            value={filters.statusClass}
            onChange={(e) =>
              set("statusClass", e.target.value as Filters["statusClass"])
            }
          >
            <option value="">Toutes</option>
            {STATUS_CLASSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Code HTTP exact" error={statusError}>
          <input
            className={selectClass}
            placeholder="404"
            inputMode="numeric"
            value={filters.status}
            onChange={(e) => set("status", e.target.value.replace(/\D/g, "").slice(0, 3))}
          />
        </Field>

        <Field label="Utilisateur (UUID)" error={userIdError}>
          <input
            className={selectClass}
            placeholder="8f2c…"
            value={filters.userId}
            onChange={(e) => set("userId", e.target.value.trim())}
          />
        </Field>

        <Field label="Recherche texte">
          <input
            className={selectClass}
            placeholder="prisma, timeout, /api/geo…"
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
          />
        </Field>

        <Field label="Lignes">
          <select
            className={selectClass}
            value={filters.limit}
            onChange={(e) => set("limit", Number(e.target.value))}
          >
            {[100, 200, 500, 1000].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3">
        <button
          type="button"
          onClick={() => setFilters(DEFAULT_FILTERS)}
          className="text-xs font-semibold text-[#8A6B4D] hover:text-[#1A0F0A] underline"
        >
          Réinitialiser les filtres
        </button>
        {query ? (
          <code
            className="text-[11px] text-[#8A6B4D] truncate max-w-[60%]"
            title={query}
          >
            {query}
          </code>
        ) : null}
      </div>

      {error ? <div className="mb-3"><ErrorBanner message={error} /></div> : null}

      {unavailable ? (
        <div className="rounded-lg border border-[#E8DFD3] bg-[#FFF8F3] px-4 py-3 text-sm text-[#5A4634]">
          Logs indisponibles : {unavailable}
        </div>
      ) : loading && entries.length === 0 ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-[#8A6B4D] py-6 text-center">
          Aucune ligne ne correspond à ces filtres sur la période.
        </p>
      ) : (
        <ul className="divide-y divide-[#E8DFD3] max-h-[32rem] overflow-y-auto rounded-lg border border-[#E8DFD3]">
          {entries.map((entry, i) => {
            const key = `${entry.ts}-${i}`;
            const open = expanded === key;
            return (
              <li key={key} className="px-3 py-2 hover:bg-[#FDFBF7]">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : key)}
                  aria-expanded={open}
                  className="w-full text-left"
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-[11px] tabular-nums text-[#8A6B4D] shrink-0 pt-0.5">
                      {formatDateTime(entry.ts)}
                    </span>
                    <StatusChip tone={levelTone(entry.level)}>
                      {entry.level ?? entry.stream}
                    </StatusChip>
                    <span className="text-[11px] font-semibold text-[#5A4634] shrink-0 pt-0.5">
                      {entry.container.replace(/^nigerconnect-/, "")}
                    </span>
                    {entry.status !== null ? (
                      <StatusChip tone={statusTone(entry.status)}>{entry.status}</StatusChip>
                    ) : null}
                    <span className="text-xs text-[#1A0F0A] break-all flex-1 min-w-0">
                      {entry.message}
                    </span>
                  </div>
                </button>
                {open ? (
                  <div className="mt-2 space-y-1 text-[11px] text-[#5A4634]">
                    {entry.userId ? (
                      <div>
                        <span className="font-semibold">Utilisateur :</span>{" "}
                        <code>{entry.userId}</code>
                      </div>
                    ) : null}
                    {entry.requestId ? (
                      <div>
                        <span className="font-semibold">Requête :</span>{" "}
                        <code>{entry.requestId}</code>
                      </div>
                    ) : null}
                    <pre className="whitespace-pre-wrap break-all bg-[#FDFBF7] border border-[#E8DFD3] rounded p-2 text-[11px]">
                      {entry.raw}
                    </pre>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#8A6B4D] mb-1">{label}</span>
      {children}
      {error ? <span className="block text-[11px] text-[#B91C1C] mt-1">{error}</span> : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Formatage / seuils
// ---------------------------------------------------------------------------

function errorRateTone(rate: number | null): ChipTone | undefined {
  if (rate === null) return undefined;
  if (rate >= CRITICAL_ERROR_RATE) return "red";
  if (rate >= WARNING_ERROR_RATE) return "amber";
  return undefined;
}

function thresholdTone(
  value: number | null | undefined,
  warn: number,
  critical: number,
): ChipTone | undefined {
  if (value === null || value === undefined) return undefined;
  if (value >= critical) return "red";
  if (value >= warn) return "amber";
  return undefined;
}

function levelTone(level: string | null): ChipTone {
  if (level === "error") return "red";
  if (level === "warn") return "amber";
  if (level === "info") return "blue";
  return "neutral";
}

function statusTone(status: number): ChipTone {
  if (status >= 500) return "red";
  if (status >= 400) return "amber";
  return "green";
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)} %`;
}

function formatBytes(bytes: number): string {
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
