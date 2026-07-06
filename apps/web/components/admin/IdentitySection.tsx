"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, FileCheck2, MapPin, Search, UserCheck } from "lucide-react";
import {
  fetchPendingIdentity,
  manualApproveIdentity,
  reviewIdentity,
  searchAdminUsers,
  AdminApiError,
  type AdminUserSummary,
  type IdentitySubmission,
} from "@/lib/adminApi";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorBanner,
  formatDate,
  GhostButton,
  PrimaryButton,
  Skeleton,
  StatusChip,
} from "./ui";
// Spinner replaced by skeleton placeholders for a smoother loading state.

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
    <Card className="p-5">
      <div className="flex flex-col md:flex-row gap-5">
        <div className="md:w-72 shrink-0 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <Skeleton className="flex-1 h-48 rounded-lg" />
      </div>
    </Card>
  );
}

function fullName(u: IdentitySubmission["user"]): string {
  const name =
    u.displayName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");
  return name || u.email;
}

function location(u: IdentitySubmission["user"]): string {
  return [u.city, u.countryCode].filter(Boolean).join(", ");
}

function IdentityCard({
  item,
  onResolved,
}: {
  item: IdentitySubmission;
  onResolved: (id: string) => void;
}) {
  const [pending, setPending] = useState<null | "approve" | "reject">(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [dob, setDob] = useState("");
  const [error, setError] = useState<string | null>(null);

  const name = fullName(item.user);
  const loc = location(item.user);

  const today = new Date().toISOString().slice(0, 10);

  async function approve() {
    if (!dob) {
      setError("Renseigne la date de naissance figurant sur la pièce (gate 18+).");
      return;
    }
    setPending("approve");
    setError(null);
    try {
      await reviewIdentity(item.userId, "approved", undefined, dob);
      onResolved(item.id);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec de l'action.");
      setPending(null);
    }
  }

  async function submitReject() {
    if (!reason.trim()) {
      setError("Indique un motif de rejet.");
      return;
    }
    setPending("reject");
    setError(null);
    try {
      await reviewIdentity(item.userId, "rejected", reason.trim());
      onResolved(item.id);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec de l'action.");
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <Card className="p-5">
      <div className="flex flex-col md:flex-row gap-5">
        {/* Submitter info */}
        <div className="md:w-72 shrink-0">
          <div className="flex items-center gap-3">
            <Avatar src={item.user.avatarUrl} name={name} size={48} />
            <div className="min-w-0">
              <div className="font-semibold text-[#1A0F0A] truncate">{name}</div>
              <div className="text-sm text-[#5A4634] truncate">{item.user.email}</div>
            </div>
          </div>
          <dl className="mt-4 text-sm space-y-2">
            {loc ? (
              <div className="flex items-center justify-between gap-4">
                <dt className="flex items-center gap-1.5 text-[#8A6B4D]">
                  <MapPin size={15} strokeWidth={2} aria-hidden="true" />
                  Localisation
                </dt>
                <dd className="text-[#1A0F0A] text-right">{loc}</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-1.5 text-[#8A6B4D]">
                <FileCheck2 size={15} strokeWidth={2} aria-hidden="true" />
                Type de pièce
              </dt>
              <dd className="text-right">
                <StatusChip tone="blue">{item.documentType}</StatusChip>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#8A6B4D]">Soumis le</dt>
              <dd className="text-[#1A0F0A] text-right">{formatDate(item.createdAt)}</dd>
            </div>
          </dl>
        </div>

        {/* ID document image (short-lived presigned URL — never logged/cached) */}
        <div className="flex-1 min-w-0">
          <a
            href={item.viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
            title="Ouvrir en plein écran"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.viewUrl}
              alt="Pièce d'identité soumise"
              className="w-full max-h-72 object-contain rounded-lg border border-[#E8DFD3] bg-[#FDFBF7]"
            />
          </a>
          <p className="text-xs text-[#8A6B4D] mt-1">
            Cliquer pour ouvrir en plein écran. Image confidentielle.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-4 border-t border-[#E8DFD3] pt-4">
        {rejecting ? (
          <div className="space-y-3">
            <label
              htmlFor={`reason-${item.id}`}
              className="block text-sm font-semibold text-[#1A0F0A]"
            >
              Motif du rejet
            </label>
            <textarea
              id={`reason-${item.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              disabled={busy}
              className="w-full border border-[#E8DFD3] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#E05206] disabled:opacity-50"
              placeholder="Ex. document illisible, ne correspond pas au profil…"
            />
            <div className="flex gap-2">
              <GhostButton
                tone="danger"
                onClick={() => void submitReject()}
                disabled={busy}
              >
                {pending === "reject" ? "Rejet…" : "Confirmer le rejet"}
              </GhostButton>
              <GhostButton
                onClick={() => {
                  setRejecting(false);
                  setReason("");
                  setError(null);
                }}
                disabled={busy}
              >
                Annuler
              </GhostButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div>
              <label
                htmlFor={`dob-${item.id}`}
                className="block text-sm font-semibold text-[#1A0F0A] mb-1"
              >
                Date de naissance (sur la pièce)
              </label>
              <input
                id={`dob-${item.id}`}
                type="date"
                value={dob}
                max={today}
                onChange={(e) => setDob(e.target.value)}
                disabled={busy}
                className="border border-[#E8DFD3] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#E05206] disabled:opacity-50"
              />
              <p className="text-xs text-[#8A6B4D] mt-1">
                Obligatoire pour valider (gate 18+ proximité).
              </p>
            </div>
            <PrimaryButton onClick={() => void approve()} disabled={busy || !dob}>
              {pending === "approve" ? "Validation…" : "Approuver"}
            </PrimaryButton>
            <GhostButton
              tone="danger"
              onClick={() => {
                setRejecting(true);
                setError(null);
              }}
              disabled={busy}
            >
              Rejeter
            </GhostButton>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Manual verification (no document) ────────────────────────────────────────
// Admin-only panel to verify a member's identity without an uploaded piece:
// search a member (autocomplete), enter their DOB (18+ gate) + a motive, approve.
function fullNameSummary(u: AdminUserSummary): string {
  const name = u.displayName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");
  return name || u.email;
}

function ManualVerifyPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUserSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AdminUserSummary | null>(null);
  const [dob, setDob] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  // Debounced autocomplete (300ms) — skipped once a member is selected so we
  // don't re-query while the admin fills the DOB/motive.
  useEffect(() => {
    if (selected) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      searchAdminUsers(trimmed, 8, controller.signal)
        .then((res) => setResults(res.items))
        .catch((e) => {
          if (controller.signal.aborted) return;
          setError(e instanceof AdminApiError ? e.message : "Erreur de recherche.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);
    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selected]);

  function pick(u: AdminUserSummary) {
    setSelected(u);
    setResults([]);
    setQuery("");
    setError(null);
    setSuccess(null);
  }

  function reset() {
    setSelected(null);
    setDob("");
    setReason("");
    setQuery("");
    setResults([]);
    setError(null);
  }

  async function submit() {
    if (!selected) return;
    if (!dob) {
      setError("Renseigne la date de naissance (gate 18+).");
      return;
    }
    if (!reason.trim()) {
      setError("Indique un motif (tracé pour l'audit).");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await manualApproveIdentity(selected.id, dob, reason.trim());
      setSuccess(`Identité de ${fullNameSummary(selected)} vérifiée manuellement.`);
      reset();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec de la vérification.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="mt-0.5 text-[#E05206]">
          <UserCheck size={20} strokeWidth={2} aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[#1A0F0A]">
            Vérifier un utilisateur sans pièce
          </h3>
          <p className="text-sm text-[#8A6B4D] mt-0.5">
            Réservé aux admins. Valide l&apos;identité d&apos;un membre sans document
            (vérifié par un canal de confiance). La date de naissance et le motif
            sont obligatoires.
          </p>
        </div>
      </div>

      {success ? (
        <div
          role="status"
          className="mb-4 bg-[#E7F6EC] border border-[#BEE7CC] text-[#1E6B3A] rounded-lg px-4 py-3 text-sm"
        >
          {success}
        </div>
      ) : null}

      {selected ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-[#E8DFD3] bg-[#FDFBF7] px-3 py-2">
            <Avatar src={selected.avatarUrl} name={fullNameSummary(selected)} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-[#1A0F0A] truncate">
                  {fullNameSummary(selected)}
                </span>
                {selected.identityStatus === "approved" ? (
                  <StatusChip tone="green">déjà vérifié</StatusChip>
                ) : null}
              </div>
              <div className="text-sm text-[#5A4634] truncate">{selected.email}</div>
            </div>
            <GhostButton onClick={reset} disabled={submitting}>
              Changer
            </GhostButton>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div>
              <label
                htmlFor="manual-dob"
                className="block text-sm font-semibold text-[#1A0F0A] mb-1"
              >
                Date de naissance
              </label>
              <input
                id="manual-dob"
                type="date"
                value={dob}
                max={today}
                onChange={(e) => setDob(e.target.value)}
                disabled={submitting}
                className="border border-[#E8DFD3] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#E05206] disabled:opacity-50"
              />
              <p className="text-xs text-[#8A6B4D] mt-1">18+ requis (gate proximité).</p>
            </div>
            <div className="flex-1">
              <label
                htmlFor="manual-reason"
                className="block text-sm font-semibold text-[#1A0F0A] mb-1"
              >
                Motif
              </label>
              <textarea
                id="manual-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                disabled={submitting}
                className="w-full border border-[#E8DFD3] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#E05206] disabled:opacity-50"
                placeholder="Ex. vérifié en personne lors d'un événement communautaire…"
              />
            </div>
          </div>

          {error ? <ErrorBanner message={error} /> : null}

          <div className="flex gap-2">
            <PrimaryButton
              onClick={() => void submit()}
              disabled={submitting || !dob || !reason.trim()}
            >
              {submitting ? "Vérification…" : "Vérifier manuellement"}
            </PrimaryButton>
            <GhostButton onClick={reset} disabled={submitting}>
              Annuler
            </GhostButton>
          </div>
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A6B4D]" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSuccess(null);
              }}
              placeholder="Rechercher un membre (nom ou email)…"
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] placeholder-[#B59B82] focus:outline-none focus:border-[#E05206]"
            />
          </div>

          {error ? (
            <div className="mt-3">
              <ErrorBanner message={error} />
            </div>
          ) : null}

          {searching ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : results.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => pick(u)}
                    className="w-full flex items-center gap-3 rounded-lg border border-[#E8DFD3] bg-white px-3 py-2 text-left hover:border-[#E05206] hover:bg-[#FDFBF7] transition-colors"
                  >
                    <Avatar src={u.avatarUrl} name={fullNameSummary(u)} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[#1A0F0A] truncate">
                          {fullNameSummary(u)}
                        </span>
                        {u.identityStatus === "approved" ? (
                          <BadgeCheck
                            className="w-4 h-4 text-emerald-600 shrink-0"
                            aria-label="Déjà vérifié"
                          />
                        ) : null}
                      </div>
                      <div className="text-xs text-[#8A6B4D] truncate">{u.email}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim().length >= 2 ? (
            <p className="mt-3 text-sm text-[#8A6B4D]">Aucun membre trouvé.</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function IdentityQueue() {
  const [items, setItems] = useState<IdentitySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPendingIdentity(signal);
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
      title="Vérification d'identité"
      subtitle="Pièces en attente de validation"
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
            <BadgeCheck size={28} strokeWidth={1.75} aria-hidden="true" />
            <span>Aucune pièce en attente</span>
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
        {items.map((item) => (
          <IdentityCard key={item.id} item={item} onResolved={removeItem} />
        ))}
      </div>
    </div>
  );
}

export default function IdentitySection() {
  return (
    <div className="space-y-8">
      <ManualVerifyPanel />
      <IdentityQueue />
    </div>
  );
}
