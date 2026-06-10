"use client";

// "Vue d'ensemble" — the analytics dashboard star page.
//
// Three independent data sources, each with its own loading / error / empty
// handling so a single failing endpoint never blanks the whole page:
//   - /admin/metrics            → KPI headline numbers
//   - /admin/metrics/timeseries → sparklines + the hero trend chart
//   - /admin/metrics/breakdowns → donuts, bar lists, funnel
//
// The day-range toggle (7/30/90) refetches only the timeseries.

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  FileText,
  Flag,
  Globe2,
  KeyRound,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  AdminApiError,
  fetchBreakdowns,
  fetchMetrics,
  fetchTimeseries,
  type AdminMetrics,
  type MetricsBreakdowns,
  type MetricsTimeseries,
} from "@/lib/adminApi";
import {
  Card,
  CardHeader,
  chartColors,
  DeltaBadge,
  ErrorBanner,
  fmt,
  Skeleton,
  StatCard,
  StatusChip,
} from "./ui";
import {
  BarList,
  ChartLoading,
  DonutChart,
  Sparkline,
  TrendChart,
  VBarChart,
} from "./charts";
import { Funnel } from "./Funnel";

// Country code → flag emoji (regional indicators). Data label only.
function flag(code: string): string {
  if (!code || code.length !== 2) return "";
  const base = 0x1f1e6;
  const cc = code.toUpperCase();
  return String.fromCodePoint(
    base + (cc.charCodeAt(0) - 65),
    base + (cc.charCodeAt(1) - 65),
  );
}

const IDENTITY_LABELS: Record<string, string> = {
  not_submitted: "Non soumis",
  pending: "En attente",
  approved: "Validé",
  rejected: "Rejeté",
};

const AUTH_LABELS: Record<string, string> = {
  password: "Mot de passe",
  google: "Google",
  facebook: "Facebook",
  apple: "Apple",
};

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

// Generic async-data hook returning { data, loading, error, reload }.
function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    return fn(signal)
      .then((res) => setData(res))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof AdminApiError ? e.message : "Erreur de chargement.");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    void run(ac.signal);
    return () => ac.abort();
  }, [run, nonce]);

  return {
    data,
    loading,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}

export default function OverviewSection() {
  const [range, setRange] = useState<Range>(30);

  const metrics = useAsync<AdminMetrics>((s) => fetchMetrics(s), []);
  const timeseries = useAsync<MetricsTimeseries>(
    (s) => fetchTimeseries(range, s),
    [range],
  );
  const breakdowns = useAsync<MetricsBreakdowns>((s) => fetchBreakdowns(s), []);

  // Chart libs want plain indexable rows; map the typed points to that shape
  // once so every chart below can consume it without per-call casts.
  const series: Array<Record<string, number | string>> = (
    timeseries.data?.series ?? []
  ).map((p) => ({ ...p }));

  return (
    <div className="space-y-6">
      {/* ---- KPI ROW ------------------------------------------------------ */}
      <KpiRow
        metrics={metrics.data}
        loading={metrics.loading && !metrics.data}
        error={metrics.error && !metrics.data ? metrics.error : null}
        onRetry={metrics.reload}
        series={series}
      />

      {/* ---- HERO TREND CHART -------------------------------------------- */}
      <Card className="p-5">
        <CardHeader
          icon={TrendingUp}
          title="Activité de la plateforme"
          subtitle={`Inscriptions, publications et messages — ${range} derniers jours`}
          right={
            <div
              role="group"
              aria-label="Période"
              className="inline-flex rounded-lg border border-[#E8DFD3] bg-[#FDFBF7] p-0.5"
            >
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206] ${
                    range === r
                      ? "bg-white text-[#E05206] shadow-sm"
                      : "text-[#5A4634] hover:text-[#1A0F0A]"
                  }`}
                >
                  {r}j
                </button>
              ))}
            </div>
          }
        />
        {timeseries.loading && !timeseries.data ? (
          <ChartLoading height={300} />
        ) : timeseries.error && !timeseries.data ? (
          <ErrorBanner message={timeseries.error} onRetry={timeseries.reload} />
        ) : (
          <TrendChart
            data={series}
            height={300}
            ariaLabel={`Graphique d'activité sur ${range} jours : inscriptions, publications et messages par jour`}
            series={[
              { dataKey: "signups", name: "Inscriptions", color: chartColors[0] },
              { dataKey: "posts", name: "Publications", color: chartColors[1] },
              { dataKey: "messages", name: "Messages", color: chartColors[2] },
            ]}
          />
        )}
      </Card>

      {/* ---- DISTRIBUTION ROW -------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard
          icon={ShieldCheck}
          title="Statut d'identité"
          subtitle="Répartition des comptes"
          state={panelState(breakdowns)}
          onRetry={breakdowns.reload}
        >
          {breakdowns.data ? (
            <DonutChart
              ariaLabel="Répartition des statuts d'identité des utilisateurs"
              centerValue={breakdowns.data.identityDistribution.reduce(
                (s, d) => s + d.count,
                0,
              )}
              centerCaption="comptes"
              data={breakdowns.data.identityDistribution.map((d) => ({
                name: IDENTITY_LABELS[d.status] ?? d.status,
                value: d.count,
              }))}
            />
          ) : null}
        </ChartCard>

        <ChartCard
          icon={KeyRound}
          title="Méthodes de connexion"
          subtitle="Comment les comptes s'authentifient"
          state={panelState(breakdowns)}
          onRetry={breakdowns.reload}
        >
          {breakdowns.data ? (
            <DonutChart
              ariaLabel="Répartition des méthodes d'authentification"
              data={breakdowns.data.authMethods.map((d) => ({
                name: AUTH_LABELS[d.method] ?? d.method,
                value: d.count,
              }))}
            />
          ) : null}
        </ChartCard>

        <ChartCard
          icon={Globe2}
          title="Top pays"
          subtitle="Utilisateurs par pays (8 premiers)"
          state={panelState(breakdowns)}
          onRetry={breakdowns.reload}
        >
          {breakdowns.data ? (
            <BarList
              ariaLabel="Nombre d'utilisateurs par pays, 8 premiers"
              data={[...breakdowns.data.usersByCountry]
                .sort((a, b) => b.count - a.count)
                .slice(0, 8)
                .map((d) => ({
                  label: d.code
                    ? `${flag(d.code)} ${d.code}`.trim()
                    : "Inconnu",
                  value: d.count,
                }))}
            />
          ) : null}
        </ChartCard>

        <ChartCard
          icon={Flag}
          title="Signalements par motif"
          subtitle="Raisons des signalements reçus"
          state={panelState(breakdowns)}
          onRetry={breakdowns.reload}
        >
          {breakdowns.data ? (
            <VBarChart
              ariaLabel="Nombre de signalements par motif"
              color={chartColors[6]}
              data={[...breakdowns.data.reportsByReason]
                .sort((a, b) => b.count - a.count)
                .slice(0, 6)
                .map((d) => ({ label: d.reason, value: d.count }))}
            />
          ) : null}
        </ChartCard>
      </div>

      {/* ---- FUNNEL + HEALTH --------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="p-5 lg:col-span-2">
          <CardHeader
            icon={BarChart3}
            title="Tunnel d'activation"
            subtitle="De l'inscription à l'identité validée"
          />
          {breakdowns.loading && !breakdowns.data ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : breakdowns.error && !breakdowns.data ? (
            <ErrorBanner
              message={breakdowns.error}
              onRetry={breakdowns.reload}
            />
          ) : breakdowns.data ? (
            <Funnel
              steps={[
                {
                  label: "Inscrits",
                  value: breakdowns.data.funnel.registered,
                },
                {
                  label: "Email vérifié",
                  value: breakdowns.data.funnel.emailVerified,
                },
                {
                  label: "Identité soumise",
                  value: breakdowns.data.funnel.identitySubmitted,
                },
                {
                  label: "Identité validée",
                  value: breakdowns.data.funnel.identityApproved,
                },
              ]}
            />
          ) : null}
        </Card>

        <Card className="p-5">
          <CardHeader
            icon={Activity}
            title="État du système"
            subtitle="Comptes & rôles"
          />
          <HealthChips
            metrics={metrics.data}
            breakdowns={breakdowns.data}
            loading={
              (metrics.loading && !metrics.data) ||
              (breakdowns.loading && !breakdowns.data)
            }
          />
        </Card>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// KPI row
// --------------------------------------------------------------------------
function KpiRow({
  metrics,
  loading,
  error,
  onRetry,
  series,
}: {
  metrics: AdminMetrics | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  series: Array<Record<string, number | string>>;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-4 w-24 mb-4" />
            <Skeleton className="h-8 w-20 mb-2" />
            <Skeleton className="h-3 w-28" />
          </Card>
        ))}
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;
  if (!metrics) return null;

  const sparkData = series;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <StatCard
        icon={Users}
        label="Utilisateurs"
        value={metrics.users.total}
        sublabel={
          <span className="tabular-nums">
            {fmt(metrics.users.active7d)} actifs sur 7j
          </span>
        }
        spark={
          sparkData.length ? (
            <Sparkline
              data={sparkData}
              dataKey="signups"
              color={chartColors[0]}
            />
          ) : null
        }
      />
      <StatCard
        icon={TrendingUp}
        label="Inscriptions 7j"
        value={metrics.users.signups7d}
        delta={
          <DeltaBadge
            value={metrics.users.signups7d}
            previous={metrics.users.signups7dPrev}
          />
        }
        sublabel={
          <span className="tabular-nums">
            {fmt(metrics.users.signups24h)} sur 24h
          </span>
        }
        spark={
          sparkData.length ? (
            <Sparkline
              data={sparkData}
              dataKey="signups"
              color={chartColors[2]}
            />
          ) : null
        }
      />
      <StatCard
        icon={FileText}
        label="Publications"
        value={metrics.content.posts}
        sublabel={
          <span className="tabular-nums">
            {fmt(metrics.content.posts7d)} sur 7j
          </span>
        }
        spark={
          sparkData.length ? (
            <Sparkline
              data={sparkData}
              dataKey="posts"
              color={chartColors[1]}
            />
          ) : null
        }
      />
      <StatCard
        icon={Flag}
        label="Signalements en attente"
        value={metrics.moderation.reportsPending}
        accent={metrics.moderation.reportsPending > 0}
        sublabel={
          <span className="tabular-nums">
            {fmt(metrics.moderation.resolved7d)} résolus sur 7j
          </span>
        }
        spark={
          sparkData.length ? (
            <Sparkline
              data={sparkData}
              dataKey="reports"
              color={chartColors[6]}
            />
          ) : null
        }
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// System health chips
// --------------------------------------------------------------------------
function HealthChips({
  metrics,
  breakdowns,
  loading,
}: {
  metrics: AdminMetrics | null;
  breakdowns: MetricsBreakdowns | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  const moderators =
    breakdowns?.usersByRole.find((r) => r.role === "moderator")?.count ?? 0;
  const admins =
    breakdowns?.usersByRole.find((r) => r.role === "admin")?.count ?? 0;

  const rows: {
    label: string;
    value: number;
    tone: Parameters<typeof StatusChip>[0]["tone"];
  }[] = [
    {
      label: "Email vérifié",
      value: metrics?.users.emailVerified ?? 0,
      tone: "green",
    },
    {
      label: "Identité validée",
      value: metrics?.users.identityApproved ?? 0,
      tone: "green",
    },
    {
      label: "Suspendus",
      value: metrics?.users.suspended ?? 0,
      tone: (metrics?.users.suspended ?? 0) > 0 ? "amber" : "neutral",
    },
    {
      label: "Bannis",
      value: metrics?.users.banned ?? 0,
      tone: (metrics?.users.banned ?? 0) > 0 ? "red" : "neutral",
    },
    { label: "Modérateurs", value: moderators, tone: "blue" },
    { label: "Administrateurs", value: admins, tone: "brand" },
  ];

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="flex items-center justify-between gap-3 py-1.5 border-b border-[#F1E9DD] last:border-0"
        >
          <span className="text-sm text-[#5A4634]">{r.label}</span>
          <StatusChip tone={r.tone}>
            <span className="tabular-nums">{fmt(r.value)}</span>
          </StatusChip>
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------------------
// ChartCard — wraps a chart with header + per-panel loading/error/empty.
// --------------------------------------------------------------------------
type PanelState = "loading" | "error" | "ready";

function panelState(a: {
  data: unknown;
  loading: boolean;
  error: string | null;
}): { state: PanelState; error: string | null } {
  if (a.data) return { state: "ready", error: null };
  if (a.loading) return { state: "loading", error: null };
  if (a.error) return { state: "error", error: a.error };
  return { state: "loading", error: null };
}

function ChartCard({
  icon,
  title,
  subtitle,
  state,
  onRetry,
  children,
}: {
  icon: Parameters<typeof CardHeader>[0]["icon"];
  title: string;
  subtitle: string;
  state: { state: PanelState; error: string | null };
  onRetry: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <CardHeader icon={icon} title={title} subtitle={subtitle} />
      {state.state === "loading" ? (
        <ChartLoading height={220} />
      ) : state.state === "error" ? (
        <ErrorBanner message={state.error ?? "Erreur."} onRetry={onRetry} />
      ) : (
        children
      )}
    </Card>
  );
}
