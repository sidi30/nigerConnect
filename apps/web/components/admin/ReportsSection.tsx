"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Flag, LifeBuoy } from "lucide-react";
import {
  fetchPendingReports,
  fetchReportTarget,
  resolveReport,
  AdminApiError,
  type Report,
  type ReportAction,
  type ReportTarget,
} from "@/lib/adminApi";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorBanner,
  formatDate,
  PrimaryButton,
  Skeleton,
  StatusChip,
} from "./ui";

function SectionHeader({
  title,
  subtitle,
  count,
}: {
  title: string;
  subtitle: string;
  count?: number;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div>
        <h2 className="text-xl font-bold text-[#1A0F0A]">{title}</h2>
        <p className="text-sm text-[#8A6B4D] mt-0.5">{subtitle}</p>
      </div>
      {count !== undefined && count > 0 ? (
        <StatusChip tone="amber">
          <span className="tabular-nums">{count}</span> en attente
        </StatusChip>
      ) : null}
    </div>
  );
}

function CardSkeleton() {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-9 w-full" />
    </Card>
  );
}

const ACTIONS: { value: ReportAction; label: string }[] = [
  { value: "none", label: "Aucune action" },
  { value: "warning", label: "Avertissement" },
  { value: "content_removed", label: "Contenu supprimé" },
  { value: "suspended", label: "Compte suspendu" },
  { value: "banned", label: "Compte banni" },
];

function DeletedBadge() {
  return <StatusChip tone="amber">Supprimé</StatusChip>;
}

function AuthorLine({
  label,
  author,
}: {
  label: string;
  author: { displayName: string | null; avatarUrl: string | null };
}) {
  const name = author.displayName ?? "Utilisateur";
  return (
    <div className="flex items-center gap-2 text-sm text-[#5A4634]">
      <Avatar src={author.avatarUrl} name={name} size={24} />
      <span>
        {label} <span className="text-[#1A0F0A]">{name}</span>
      </span>
    </div>
  );
}

// Renders the resolved reported content. Best-effort preview — moderators need
// to see WHAT was reported before deciding. Media are reported S3 URLs.
function TargetPreview({ target }: { target: ReportTarget }) {
  if (!target.found) {
    return (
      <p className="text-sm text-[#8A6B4D] italic">
        Contenu introuvable (définitivement supprimé).
      </p>
    );
  }

  switch (target.type) {
    case "post":
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <AuthorLine label="Auteur" author={target.author} />
            <span className="text-xs text-[#8A6B4D]">
              {target.isStory ? "Story" : "Publication"} · {target.visibility}
            </span>
            {target.deletedAt ? <DeletedBadge /> : null}
          </div>
          {target.content ? (
            <p className="text-sm text-[#1A0F0A] whitespace-pre-wrap break-words">
              {target.content}
            </p>
          ) : (
            <p className="text-sm text-[#8A6B4D] italic">(sans texte)</p>
          )}
          {target.media.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {target.media.map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={m.mediaUrl}
                  src={m.thumbnailUrl ?? m.mediaUrl}
                  alt=""
                  className="h-28 w-28 object-cover rounded-lg border border-[#E8DFD3]"
                />
              ))}
            </div>
          ) : null}
        </div>
      );

    case "comment":
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <AuthorLine label="Auteur" author={target.author} />
            {target.deletedAt ? <DeletedBadge /> : null}
          </div>
          <p className="text-sm text-[#1A0F0A] whitespace-pre-wrap break-words">
            {target.content}
          </p>
        </div>
      );

    case "message":
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <AuthorLine label="Expéditeur" author={target.sender} />
            {target.deletedAt ? <DeletedBadge /> : null}
          </div>
          {target.content ? (
            <p className="text-sm text-[#1A0F0A] whitespace-pre-wrap break-words">
              {target.content}
            </p>
          ) : (
            <p className="text-sm text-[#8A6B4D] italic">
              ({target.messageType === "text" ? "sans texte" : target.messageType})
            </p>
          )}
          {target.mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={target.mediaUrl}
              alt=""
              className="h-28 w-28 object-cover rounded-lg border border-[#E8DFD3]"
            />
          ) : null}
        </div>
      );

    case "user":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Avatar
              src={target.avatarUrl}
              name={target.displayName ?? "Utilisateur"}
              size={36}
            />
            <div>
              <div className="text-sm font-medium text-[#1A0F0A]">
                {target.displayName ?? "Utilisateur"}
              </div>
              <div className="text-xs text-[#8A6B4D]">
                {[target.city, target.countryCode].filter(Boolean).join(", ") ||
                  "—"}{" "}
                · {target.status}
              </div>
            </div>
          </div>
          {target.bio ? (
            <p className="text-sm text-[#1A0F0A] whitespace-pre-wrap break-words">
              {target.bio}
            </p>
          ) : null}
        </div>
      );

    case "association":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Avatar src={target.logoUrl} name={target.name} size={36} />
            <div>
              <div className="text-sm font-medium text-[#1A0F0A]">
                {target.name}
              </div>
              <div className="text-xs text-[#8A6B4D]">
                {target.category} ·{" "}
                {[target.city, target.countryCode].filter(Boolean).join(", ") ||
                  "—"}
              </div>
            </div>
          </div>
          {target.description ? (
            <p className="text-sm text-[#1A0F0A] whitespace-pre-wrap break-words">
              {target.description}
            </p>
          ) : null}
        </div>
      );

    default:
      return (
        <p className="text-sm text-[#8A6B4D] italic">
          Aperçu indisponible pour ce type de contenu.
        </p>
      );
  }
}

function ReportCard({
  report,
  onResolved,
}: {
  report: Report;
  onResolved: (id: string) => void;
}) {
  const [action, setAction] = useState<ReportAction>("none");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-loaded reported-content preview (one fetch per card, on first open).
  const [showTarget, setShowTarget] = useState(false);
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);

  const reporterName = report.reporter.displayName ?? "Utilisateur";

  async function toggleTarget() {
    if (showTarget) {
      setShowTarget(false);
      return;
    }
    setShowTarget(true);
    if (target || targetLoading) return;
    setTargetLoading(true);
    setTargetError(null);
    try {
      setTarget(await fetchReportTarget(report.id));
    } catch (e) {
      setTargetError(
        e instanceof AdminApiError ? e.message : "Échec du chargement.",
      );
    } finally {
      setTargetLoading(false);
    }
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await resolveReport(report.id, action, note.trim() || undefined);
      onResolved(report.id);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec de l'action.");
      setPending(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <StatusChip tone="brand" icon={Flag}>
            {report.reason}
          </StatusChip>
          <div className="text-sm text-[#5A4634] mt-2">
            Cible :{" "}
            <span className="font-medium text-[#1A0F0A]">
              {report.targetType}
            </span>{" "}
            <span className="text-[#8A6B4D]">#{report.targetId}</span>
          </div>
        </div>
        <div className="text-xs text-[#8A6B4D]">{formatDate(report.createdAt)}</div>
      </div>

      {report.description ? (
        <p className="text-sm text-[#1A0F0A] mt-3 whitespace-pre-wrap break-words">
          {report.description}
        </p>
      ) : null}

      <div className="flex items-center gap-2 mt-3 text-sm text-[#5A4634]">
        <Avatar src={report.reporter.avatarUrl} name={reporterName} size={28} />
        <span>
          Signalé par <span className="text-[#1A0F0A]">{reporterName}</span>
        </span>
      </div>

      {/* Reported content preview (lazy) */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => void toggleTarget()}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#E05206] hover:underline"
        >
          {showTarget ? (
            <EyeOff size={16} aria-hidden="true" />
          ) : (
            <Eye size={16} aria-hidden="true" />
          )}
          {showTarget ? "Masquer le contenu" : "Voir le contenu signalé"}
        </button>
        {showTarget ? (
          <div className="mt-3 rounded-lg border border-[#E8DFD3] bg-[#FBF7F1] p-4">
            {targetLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : targetError ? (
              <ErrorBanner message={targetError} />
            ) : target ? (
              <TargetPreview target={target} />
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      {/* Resolve form */}
      <div className="mt-4 border-t border-[#E8DFD3] pt-4 flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="sm:w-56">
          <label
            htmlFor={`action-${report.id}`}
            className="block text-sm font-semibold text-[#1A0F0A] mb-1"
          >
            Action
          </label>
          <select
            id={`action-${report.id}`}
            value={action}
            onChange={(e) => setAction(e.target.value as ReportAction)}
            disabled={pending}
            className="w-full border border-[#E8DFD3] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#E05206] disabled:opacity-50"
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label
            htmlFor={`note-${report.id}`}
            className="block text-sm font-semibold text-[#1A0F0A] mb-1"
          >
            Note (optionnel)
          </label>
          <input
            id={`note-${report.id}`}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            disabled={pending}
            className="w-full border border-[#E8DFD3] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#E05206] disabled:opacity-50"
            placeholder="Contexte de la décision…"
          />
        </div>
        <PrimaryButton onClick={() => void submit()} disabled={pending}>
          {pending ? "Résolution…" : "Résoudre"}
        </PrimaryButton>
      </div>
    </Card>
  );
}

export default function ReportsSection() {
  const [items, setItems] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPendingReports(signal);
      setItems(res.items);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof AdminApiError ? e.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const header = (
    <SectionHeader
      title="Support & Modération"
      subtitle="Signalements en attente de traitement"
      count={items.length}
    />
  );

  if (loading && items.length === 0)
    return (
      <div>
        {header}
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  if (error && items.length === 0)
    return (
      <div>
        {header}
        <ErrorBanner message={error} onRetry={() => void load()} />
      </div>
    );
  if (items.length === 0)
    return (
      <div>
        {header}
        <EmptyState>
          <div className="flex flex-col items-center gap-2 text-[#8A6B4D]">
            <LifeBuoy size={28} strokeWidth={1.75} aria-hidden="true" />
            <span>Aucun signalement en attente</span>
          </div>
        </EmptyState>
      </div>
    );

  return (
    <div>
      {header}
      <div className="space-y-4">
        {error ? (
          <ErrorBanner message={error} onRetry={() => void load()} />
        ) : null}
        {items.map((report) => (
          <ReportCard key={report.id} report={report} onResolved={removeItem} />
        ))}
      </div>
    </div>
  );
}
