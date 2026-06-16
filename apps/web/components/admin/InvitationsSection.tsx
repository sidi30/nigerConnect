"use client";

// "Invitations & Paramètres" — admin console section for the referral system v2.
//
// Three panels:
//   1. Mode toggle (open / invite_only / closed)
//      → PATCH /admin/settings (admin-only; mods see the panel read-only)
//      Note: defaultInviteQuota / inviteExpiryDays are deprecated in v2 and no
//      longer displayed (invitations are unlimited and never expire).
//   2. Root-invite generator → POST /admin/invitations/root
//      Supports kind: 'single_use' | 'reusable' (v2).
//   3. Invite funnel metrics  → GET /admin/invitations/metrics

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ClipboardCopy,
  Link2,
  RefreshCw,
  Settings2,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  adminFetch,
  AdminApiError,
  type AdminRole,
  type InvitationKind,
} from "@/lib/adminApi";
import {
  Card,
  CardHeader,
  ErrorBanner,
  GhostButton,
  PrimaryButton,
  Skeleton,
  StatusChip,
  fmt,
} from "./ui";
import { BarList } from "./charts";
import { Funnel } from "./Funnel";

// ---------------------------------------------------------------------------
// API types (local — mirrors adminApi types without re-exporting)
// ---------------------------------------------------------------------------

type RegistrationMode = "open" | "invite_only" | "closed";

interface AdminSettings {
  registrationMode: RegistrationMode;
  /** Deprecated (v2) — kept for API compat, not displayed. */
  defaultInviteQuota: number;
  /** Deprecated (v2) — kept for API compat, not displayed. */
  inviteExpiryDays: number;
}

interface RootInvite {
  code: string;
  url: string;
  expiresAt: string | null;
  kind?: InvitationKind;
}

interface InviteMetrics {
  sent: number;
  accepted: number;
  pending: number;
  expired: number;
  revoked: number;
  conversionRate: number;
  kFactor: number;
  topInviters: Array<{ name: string; count: number }>;
}

// ---------------------------------------------------------------------------
// API helpers (typed wrappers over adminFetch)
// ---------------------------------------------------------------------------

function fetchSettings(signal?: AbortSignal): Promise<AdminSettings> {
  return adminFetch<AdminSettings>("/admin/settings", { signal });
}

function patchSettings(
  body: Partial<{ registrationMode: RegistrationMode }>,
): Promise<AdminSettings> {
  return adminFetch<AdminSettings>("/admin/settings", { method: "PATCH", body });
}

function generateRootInvites(
  count: number,
  options?: { kind?: InvitationKind },
): Promise<RootInvite[]> {
  const body: { count: number; kind?: InvitationKind } = { count };
  if (options?.kind !== undefined) body.kind = options.kind;
  return adminFetch<RootInvite[]>("/admin/invitations/root", {
    method: "POST",
    body,
  });
}

function fetchInviteMetrics(signal?: AbortSignal): Promise<InviteMetrics> {
  return adminFetch<InviteMetrics>("/admin/invitations/metrics", { signal });
}

// ---------------------------------------------------------------------------
// Generic async hook
// ---------------------------------------------------------------------------

function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const run = useCallback(
    (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      return fn(signal)
        .then((res) => setData(res))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(
            e instanceof AdminApiError ? e.message : "Erreur de chargement.",
          );
        })
        .finally(() => setLoading(false));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    deps,
  );

  useEffect(() => {
    const ac = new AbortController();
    void run(ac.signal);
    return () => ac.abort();
  }, [run, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

const MODE_OPTIONS: {
  value: RegistrationMode;
  label: string;
  tone: "green" | "amber" | "red";
}[] = [
  { value: "open", label: "Ouvert", tone: "green" },
  { value: "invite_only", label: "Sur invitation", tone: "amber" },
  { value: "closed", label: "Fermé", tone: "red" },
];

function ModeToggle({
  current,
  disabled,
  onSelect,
}: {
  current: RegistrationMode;
  disabled: boolean;
  onSelect: (mode: RegistrationMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Mode d'inscription"
      className="inline-flex rounded-xl border border-[#E8DFD3] bg-[#FDFBF7] p-1 gap-1"
    >
      {MODE_OPTIONS.map((opt) => {
        const active = current === opt.value;
        const toneClass = active
          ? opt.tone === "green"
            ? "bg-[#E7F4EC] text-[#15803D] shadow-sm"
            : opt.tone === "amber"
              ? "bg-[#FEF3E2] text-[#B45309] shadow-sm"
              : "bg-[#FCE8E8] text-[#B91C1C] shadow-sm"
          : "text-[#5A4634] hover:text-[#1A0F0A] hover:bg-white";
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => !active && onSelect(opt.value)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206] disabled:opacity-50 disabled:cursor-not-allowed ${toneClass}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings panel (v2: mode only — quota & expiry deprecated)
// ---------------------------------------------------------------------------

function SettingsPanel({ role }: { role: AdminRole | null }) {
  const isAdmin = role === "admin";
  const settings = useAsync<AdminSettings>((s) => fetchSettings(s), []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleModeChange(mode: RegistrationMode) {
    if (!settings.data) return;
    setSaving(true);
    setSaved(false);
    try {
      await patchSettings({ registrationMode: mode });
      setSaved(true);
      settings.reload();
    } catch {
      settings.reload();
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader
        icon={Settings2}
        title="Paramètres d'inscription"
        subtitle="Mode global d'accès à la plateforme"
        right={
          saved ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-[#15803D]">
              <CheckCircle2 size={14} strokeWidth={2.5} aria-hidden="true" />
              Enregistré
            </span>
          ) : undefined
        }
      />

      {settings.loading && !settings.data ? (
        <Skeleton className="h-10 w-64" />
      ) : settings.error && !settings.data ? (
        <ErrorBanner message={settings.error} onRetry={settings.reload} />
      ) : settings.data ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#5A4634] uppercase tracking-wide">
              Mode d&apos;inscription
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <ModeToggle
                current={settings.data.registrationMode}
                disabled={!isAdmin || saving}
                onSelect={handleModeChange}
              />
              {!isAdmin ? (
                <span className="text-xs text-[#8A6B4D]">
                  Lecture seule — réservé aux administrateurs
                </span>
              ) : null}
            </div>
          </div>

          {/* v2 notice: quota and expiry removed */}
          <p className="text-xs text-[#8A6B4D]">
            En mode v2 les invitations sont illimitées et n&apos;expirent jamais.
            Le gel est automatique dès 3 signalements d&apos;abus.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Root invite generator (v2 — kind selector added)
// ---------------------------------------------------------------------------

function CopyableLink({
  code,
  url,
  kind,
}: {
  code: string;
  url: string;
  kind?: InvitationKind;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <li className="flex items-center gap-2 py-1.5 border-b border-[#F1E9DD] last:border-0 min-w-0">
      <span className="font-mono text-xs text-[#E05206] font-semibold w-28 shrink-0 truncate">
        {code}
      </span>
      {kind ? (
        <span className="shrink-0">
          {kind === "reusable" ? (
            <StatusChip tone="blue" icon={RefreshCw}>
              réutilisable
            </StatusChip>
          ) : (
            <StatusChip tone="neutral">usage unique</StatusChip>
          )}
        </span>
      ) : null}
      <span className="flex-1 text-xs text-[#5A4634] truncate hidden sm:block">
        {url}
      </span>
      <button
        type="button"
        onClick={copy}
        title="Copier le lien"
        aria-label={`Copier le lien d'invitation ${code}`}
        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border border-[#E8DFD3] text-[#5A4634] hover:bg-[#FDFBF7] transition-colors"
      >
        {copied ? (
          <CheckCircle2
            size={13}
            strokeWidth={2.5}
            className="text-[#15803D]"
            aria-hidden="true"
          />
        ) : (
          <ClipboardCopy size={13} strokeWidth={2} aria-hidden="true" />
        )}
        {copied ? "Copié" : "Copier"}
      </button>
    </li>
  );
}

function RootInviteGenerator({ role }: { role: AdminRole | null }) {
  const isAdmin = role === "admin";
  const [count, setCount] = useState("10");
  const [kind, setKind] = useState<InvitationKind>("single_use");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RootInvite[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  async function generate() {
    const n = parseInt(count, 10);
    if (Number.isNaN(n) || n < 1 || n > 200) return;
    setLoading(true);
    setError(null);
    try {
      const invites = await generateRootInvites(n, { kind });
      setResults(invites);
      setTimeout(
        () =>
          listRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        100,
      );
    } catch (e) {
      setError(
        e instanceof AdminApiError ? e.message : "Erreur lors de la génération.",
      );
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    const text = results.map((r) => r.url).join("\n");
    void navigator.clipboard.writeText(text);
  }

  if (!isAdmin) {
    return (
      <Card className="p-5">
        <CardHeader icon={Link2} title="Générateur d'invitations racines" />
        <p className="text-sm text-[#8A6B4D]">
          Réservé aux administrateurs.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <CardHeader
        icon={Link2}
        title="Générateur d'invitations racines"
        subtitle="Crée des invitations sans parrain pour le bootstrap et la waitlist"
      />

      <div className="flex flex-wrap gap-4 items-end mb-4">
        {/* Count */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="root-invite-count"
            className="text-xs font-semibold text-[#5A4634] uppercase tracking-wide"
          >
            Nombre de codes
          </label>
          <input
            id="root-invite-count"
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            disabled={loading}
            className="w-24 rounded-lg border border-[#E8DFD3] bg-[#FDFBF7] px-3 py-2 text-sm font-semibold text-[#1A0F0A] focus:outline-none focus:ring-2 focus:ring-[#E05206] disabled:opacity-50"
          />
        </div>

        {/* Kind selector */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-[#5A4634] uppercase tracking-wide">
            Type
          </span>
          <div
            role="group"
            aria-label="Type d'invitation"
            className="inline-flex rounded-xl border border-[#E8DFD3] bg-[#FDFBF7] p-1 gap-1"
          >
            <button
              type="button"
              disabled={loading}
              aria-pressed={kind === "single_use"}
              onClick={() => setKind("single_use")}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206] disabled:opacity-50 ${
                kind === "single_use"
                  ? "bg-[#F1E9DD] text-[#5A4634] shadow-sm"
                  : "text-[#5A4634] hover:text-[#1A0F0A] hover:bg-white"
              }`}
            >
              Usage unique
            </button>
            <button
              type="button"
              disabled={loading}
              aria-pressed={kind === "reusable"}
              onClick={() => setKind("reusable")}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206] disabled:opacity-50 ${
                kind === "reusable"
                  ? "bg-[#E6EDFB] text-[#1D4ED8] shadow-sm"
                  : "text-[#5A4634] hover:text-[#1A0F0A] hover:bg-white"
              }`}
            >
              Réutilisable
            </button>
          </div>
        </div>

        <PrimaryButton onClick={() => void generate()} disabled={loading}>
          {loading ? "Génération…" : "Générer"}
        </PrimaryButton>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void generate()} /> : null}

      {results.length > 0 ? (
        <div ref={listRef}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold text-[#5A4634]">
              {results.length} lien{results.length > 1 ? "s" : ""} généré
              {results.length > 1 ? "s" : ""}
            </p>
            <GhostButton onClick={copyAll}>Tout copier</GhostButton>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {results.map((r) => (
              <CopyableLink
                key={r.code}
                code={r.code}
                url={r.url}
                kind={r.kind}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Metrics panel
// ---------------------------------------------------------------------------

function MetricsPanel() {
  const metrics = useAsync<InviteMetrics>((s) => fetchInviteMetrics(s), []);

  return (
    <Card className="p-5">
      <CardHeader
        icon={BarChart3}
        title="Métriques de parrainage"
        subtitle="Funnel, taux de conversion et K-factor"
      />

      {metrics.loading && !metrics.data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : metrics.error && !metrics.data ? (
        <ErrorBanner message={metrics.error} onRetry={metrics.reload} />
      ) : metrics.data ? (
        <div className="space-y-6">
          {/* KPI chips row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiChip label="Envoyées" value={metrics.data.sent} tone="neutral" />
            <KpiChip label="Acceptées" value={metrics.data.accepted} tone="green" />
            <KpiChip label="En attente" value={metrics.data.pending} tone="amber" />
            <KpiChip label="Révoquées" value={metrics.data.revoked} tone="red" />
          </div>

          {/* Conversion + K-factor */}
          <div className="flex flex-wrap gap-4">
            <div className="rounded-xl border border-[#E8DFD3] bg-[#FDFBF7] px-4 py-3 min-w-[120px]">
              <p className="text-xs text-[#8A6B4D] mb-0.5">Taux de conversion</p>
              <p className="text-2xl font-bold text-[#E05206] tabular-nums">
                {metrics.data.conversionRate.toLocaleString("fr-FR", {
                  maximumFractionDigits: 1,
                })}{" "}
                %
              </p>
            </div>
            <div className="rounded-xl border border-[#E8DFD3] bg-[#FDFBF7] px-4 py-3 min-w-[120px]">
              <p className="text-xs text-[#8A6B4D] mb-0.5">K-factor</p>
              <p className="text-2xl font-bold text-[#1D4ED8] tabular-nums">
                {metrics.data.kFactor.toLocaleString("fr-FR", {
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-xs text-[#8A6B4D] mt-0.5">
                {metrics.data.kFactor >= 1 ? "Croissance virale" : "< 1 (non viral)"}
              </p>
            </div>
          </div>

          {/* Funnel */}
          <div>
            <p className="text-xs font-semibold text-[#5A4634] uppercase tracking-wide mb-3">
              Funnel d&apos;invitation
            </p>
            <Funnel
              steps={[
                { label: "Invitations envoyées", value: metrics.data.sent },
                { label: "En attente", value: metrics.data.pending },
                { label: "Acceptées", value: metrics.data.accepted },
              ]}
            />
          </div>

          {/* Top inviters */}
          {metrics.data.topInviters.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-[#5A4634] uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <TrendingUp size={13} strokeWidth={2.5} aria-hidden="true" />
                Top parrains
              </p>
              <BarList
                ariaLabel="Nombre d'invitations acceptées par parrain (top 10)"
                data={metrics.data.topInviters.map((t) => ({
                  label: t.name,
                  value: t.count,
                }))}
              />
            </div>
          ) : (
            <p className="text-sm text-[#8A6B4D]">
              Aucune invitation acceptée pour l&apos;instant.
            </p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function KpiChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "green" | "amber" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "bg-[#E7F4EC] text-[#15803D] border-[#C6E8D5]"
      : tone === "amber"
        ? "bg-[#FEF3E2] text-[#B45309] border-[#F5D68E]"
        : tone === "red"
          ? "bg-[#FCE8E8] text-[#B91C1C] border-[#F5C2C2]"
          : "bg-[#F1E9DD] text-[#5A4634] border-[#E8DFD3]";

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneClass}`}>
      <p className="text-xs font-semibold mb-1 opacity-75">{label}</p>
      <p className="text-xl font-bold tabular-nums">{fmt(value)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function InvitationsSection({ role }: { role: AdminRole | null }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center w-8 h-8 rounded-lg bg-[#FDF0E6] text-[#E05206] shrink-0">
          <Users size={18} strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-[#1A0F0A] leading-tight">
            Parrainage & Invitations
          </h2>
          <p className="text-xs text-[#8A6B4D]">
            Mode d&apos;inscription, génération de codes racines et métriques
          </p>
        </div>
      </div>

      <SettingsPanel role={role} />
      <RootInviteGenerator role={role} />
      <MetricsPanel />
    </div>
  );
}
