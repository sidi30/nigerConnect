"use client";

// "Invitations & Paramètres" — admin console section for the referral system.
//
// Three panels:
//   1. Mode toggle (open / invite_only / closed) + quota/expiry settings
//      → PATCH /admin/settings (admin-only; mods see the panel read-only via
//        GET /admin/settings, but the controls are disabled for non-admins)
//   2. Root-invite generator → POST /admin/invitations/root
//   3. Invite funnel metrics  → GET /admin/invitations/metrics

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ClipboardCopy,
  Link2,
  Settings2,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  adminFetch,
  AdminApiError,
  type AdminRole,
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
// API types
// ---------------------------------------------------------------------------

type RegistrationMode = "open" | "invite_only" | "closed";

interface AdminSettings {
  registrationMode: RegistrationMode;
  defaultInviteQuota: number;
  inviteExpiryDays: number;
}

interface RootInvite {
  code: string;
  url: string;
  expiresAt: string | null;
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

function patchSettings(body: Partial<{
  registrationMode: RegistrationMode;
  defaultInviteQuota: number;
  inviteExpiryDays: number;
}>): Promise<AdminSettings> {
  return adminFetch<AdminSettings>("/admin/settings", { method: "PATCH", body });
}

function generateRootInvites(count: number, expiresInDays?: number): Promise<RootInvite[]> {
  const body: { count: number; expiresInDays?: number } = { count };
  if (expiresInDays !== undefined) body.expiresInDays = expiresInDays;
  return adminFetch<RootInvite[]>("/admin/invitations/root", { method: "POST", body });
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
          setError(e instanceof AdminApiError ? e.message : "Erreur de chargement.");
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

const MODE_OPTIONS: { value: RegistrationMode; label: string; tone: "green" | "amber" | "red" }[] = [
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
// Integer input with save button
// ---------------------------------------------------------------------------

function IntInput({
  label,
  value,
  min,
  max,
  unit,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  disabled: boolean;
  onSave: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  const [saving, setSaving] = useState(false);

  // Sync when prop changes (after a successful PATCH)
  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  const dirty = parseInt(local, 10) !== value && !Number.isNaN(parseInt(local, 10));

  async function save() {
    const n = parseInt(local, 10);
    if (Number.isNaN(n) || n < min || n > max) return;
    setSaving(true);
    try {
      await onSave(n);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-[#5A4634] uppercase tracking-wide">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={local}
          disabled={disabled || saving}
          onChange={(e) => setLocal(e.target.value)}
          aria-label={label}
          className="w-24 rounded-lg border border-[#E8DFD3] bg-[#FDFBF7] px-3 py-2 text-sm font-semibold text-[#1A0F0A] focus:outline-none focus:ring-2 focus:ring-[#E05206] disabled:opacity-50"
        />
        {unit ? <span className="text-sm text-[#8A6B4D]">{unit}</span> : null}
        {dirty ? (
          <button
            type="button"
            disabled={saving || disabled}
            onClick={save}
            className="px-3 py-1.5 rounded-lg bg-[#E05206] hover:bg-[#C8470A] text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function SettingsPanel({
  role,
}: {
  role: AdminRole | null;
}) {
  const isAdmin = role === "admin";
  const settings = useAsync<AdminSettings>((s) => fetchSettings(s), []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleModeChange(mode: RegistrationMode) {
    if (!settings.data) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await patchSettings({ registrationMode: mode });
      settings.data.registrationMode = updated.registrationMode;
      setSaved(true);
      settings.reload();
    } catch (e) {
      // Let the user see the optimistic toggle revert on reload
      settings.reload();
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  async function handleQuotaSave(n: number) {
    await patchSettings({ defaultInviteQuota: n });
    settings.reload();
  }

  async function handleExpirySave(n: number) {
    await patchSettings({ inviteExpiryDays: n });
    settings.reload();
  }

  return (
    <Card className="p-5">
      <CardHeader
        icon={Settings2}
        title="Paramètres d'inscription"
        subtitle="Mode global, quota d'invitations et expiration"
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
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="flex gap-6">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      ) : settings.error && !settings.data ? (
        <ErrorBanner message={settings.error} onRetry={settings.reload} />
      ) : settings.data ? (
        <div className="space-y-6">
          {/* Mode toggle */}
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

          {/* Numeric settings */}
          <div className="flex gap-6 flex-wrap">
            <IntInput
              label="Quota d'invitations par défaut"
              value={settings.data.defaultInviteQuota}
              min={1}
              max={1000}
              unit="invitations"
              disabled={!isAdmin}
              onSave={handleQuotaSave}
            />
            <IntInput
              label="Expiration par défaut"
              value={settings.data.inviteExpiryDays}
              min={1}
              max={365}
              unit="jours"
              disabled={!isAdmin}
              onSave={handleExpirySave}
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Root invite generator
// ---------------------------------------------------------------------------

function CopyableLink({ code, url }: { code: string; url: string }) {
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
          <CheckCircle2 size={13} strokeWidth={2.5} className="text-[#15803D]" aria-hidden="true" />
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
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RootInvite[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  async function generate() {
    const n = parseInt(count, 10);
    const exp = parseInt(expiresInDays, 10);
    if (Number.isNaN(n) || n < 1 || n > 200) return;
    setLoading(true);
    setError(null);
    try {
      const invites = await generateRootInvites(
        n,
        !Number.isNaN(exp) && exp > 0 ? exp : undefined,
      );
      setResults(invites);
      // Scroll to results list
      setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Erreur lors de la génération.");
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
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="root-invite-expiry"
            className="text-xs font-semibold text-[#5A4634] uppercase tracking-wide"
          >
            Expiration
          </label>
          <div className="flex items-center gap-2">
            <input
              id="root-invite-expiry"
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              disabled={loading}
              className="w-20 rounded-lg border border-[#E8DFD3] bg-[#FDFBF7] px-3 py-2 text-sm font-semibold text-[#1A0F0A] focus:outline-none focus:ring-2 focus:ring-[#E05206] disabled:opacity-50"
            />
            <span className="text-sm text-[#8A6B4D]">jours</span>
          </div>
        </div>
        <PrimaryButton onClick={generate} disabled={loading}>
          {loading ? "Génération…" : "Générer"}
        </PrimaryButton>
      </div>

      {error ? <ErrorBanner message={error} onRetry={generate} /> : null}

      {results.length > 0 ? (
        <div ref={listRef}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold text-[#5A4634]">
              {results.length} lien{results.length > 1 ? "s" : ""} généré{results.length > 1 ? "s" : ""}
            </p>
            <GhostButton onClick={copyAll}>
              Tout copier
            </GhostButton>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {results.map((r) => (
              <CopyableLink key={r.code} code={r.code} url={r.url} />
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
            <KpiChip label="Expirées" value={metrics.data.expired} tone="red" />
          </div>

          {/* Conversion + K-factor */}
          <div className="flex flex-wrap gap-4">
            <div className="rounded-xl border border-[#E8DFD3] bg-[#FDFBF7] px-4 py-3 min-w-[120px]">
              <p className="text-xs text-[#8A6B4D] mb-0.5">Taux de conversion</p>
              <p className="text-2xl font-bold text-[#E05206] tabular-nums">
                {metrics.data.conversionRate.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
              </p>
            </div>
            <div className="rounded-xl border border-[#E8DFD3] bg-[#FDFBF7] px-4 py-3 min-w-[120px]">
              <p className="text-xs text-[#8A6B4D] mb-0.5">K-factor</p>
              <p className="text-2xl font-bold text-[#1D4ED8] tabular-nums">
                {metrics.data.kFactor.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}
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
            Pilotage du mode d&apos;inscription, génération de codes racines et métriques
          </p>
        </div>
      </div>

      <SettingsPanel role={role} />
      <RootInviteGenerator role={role} />
      <MetricsPanel />
    </div>
  );
}
