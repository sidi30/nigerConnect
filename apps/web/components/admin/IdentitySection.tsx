"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchPendingIdentity,
  reviewIdentity,
  AdminApiError,
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
  Spinner,
} from "./ui";

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
  const [error, setError] = useState<string | null>(null);

  const name = fullName(item.user);
  const loc = location(item.user);

  async function approve() {
    setPending("approve");
    setError(null);
    try {
      await reviewIdentity(item.userId, "approved");
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
          <dl className="mt-4 text-sm space-y-1">
            {loc ? (
              <div className="flex justify-between gap-4">
                <dt className="text-[#8A6B4D]">Localisation</dt>
                <dd className="text-[#1A0F0A] text-right">{loc}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-[#8A6B4D]">Type de pièce</dt>
              <dd className="text-[#1A0F0A] text-right">{item.documentType}</dd>
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
          <div className="flex gap-2">
            <PrimaryButton onClick={() => void approve()} disabled={busy}>
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

export default function IdentitySection() {
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

  if (loading && items.length === 0)
    return <Spinner label="Chargement des pièces d'identité…" />;
  if (error && items.length === 0)
    return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (items.length === 0)
    return <EmptyState>Aucune pièce en attente</EmptyState>;

  return (
    <div className="space-y-4">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {items.map((item) => (
        <IdentityCard key={item.id} item={item} onResolved={removeItem} />
      ))}
    </div>
  );
}
