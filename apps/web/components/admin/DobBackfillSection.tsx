"use client";

// DOB backfill — approved accounts verified before the 18+/DOB capture existed
// have no date of birth, so they are proximity-ineligible. Here an admin opens
// the (already-approved) ID image and records the DOB, with no status change.

import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  AdminApiError,
  fetchMissingDob,
  setIdentityDob,
  type MissingDobItem,
} from "@/lib/adminApi";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  formatDate,
  PrimaryButton,
  Skeleton,
} from "./ui";

function fullName(u: MissingDobItem["user"]): string {
  return (
    u.displayName ?? (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email)
  );
}

export default function DobBackfillSection() {
  const [items, setItems] = useState<MissingDobItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback((signal?: AbortSignal) => {
    fetchMissingDob(signal)
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof AdminApiError ? e.message : "Erreur de chargement.");
      });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    reload(ac.signal);
    return () => ac.abort();
  }, [reload]);

  return (
    <Card className="p-5">
      <CardHeader
        icon={CalendarClock}
        title="Backfill date de naissance"
        subtitle="Comptes déjà vérifiés sans DOB — requis pour la proximité (18+)"
      />
      {error && !items ? (
        <ErrorBanner message={error} onRetry={() => reload()} />
      ) : !items ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState>
          Tous les comptes vérifiés ont une date de naissance. ✅
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <DobRow key={item.id} item={item} onDone={() => reload()} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function DobRow({ item, onDone }: { item: MissingDobItem; onDone: () => void }) {
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    if (!dob) {
      setError("Renseigne la date de naissance.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setIdentityDob(item.userId, dob);
      onDone();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec de l'enregistrement.");
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-[#E8DFD3] p-4">
      <div className="flex flex-col md:flex-row gap-4 md:items-center">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[#1A0F0A] truncate">{fullName(item.user)}</div>
          <div className="text-sm text-[#5A4634] truncate">{item.user.email}</div>
          <div className="text-xs text-[#8A6B4D] mt-1">
            {item.documentType} · vérifié, soumis le {formatDate(item.createdAt)}
          </div>
        </div>
        {item.viewUrl ? (
          <a
            href={item.viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-[#E05206] shrink-0"
          >
            Ouvrir la pièce ↗
          </a>
        ) : null}
        <div className="flex items-end gap-2 shrink-0">
          <div>
            <label
              htmlFor={`dob-${item.id}`}
              className="block text-xs font-semibold text-[#5A4634] mb-1"
            >
              Date de naissance
            </label>
            <input
              id={`dob-${item.id}`}
              type="date"
              value={dob}
              max={today}
              disabled={busy}
              onChange={(e) => setDob(e.target.value)}
              className="border border-[#E8DFD3] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#E05206] disabled:opacity-50"
            />
          </div>
          <PrimaryButton onClick={() => void save()} disabled={busy || !dob}>
            {busy ? "…" : "Enregistrer"}
          </PrimaryButton>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-[#B91C1C]">
          {error}
        </p>
      ) : null}
    </li>
  );
}
