"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Award, BadgeCheck, Search } from "lucide-react";
import {
  searchAdminUsers,
  setAmbassador,
  AdminApiError,
  type AdminUserSummary,
} from "@/lib/adminApi";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorBanner,
  GhostButton,
  PrimaryButton,
  Skeleton,
  StatusChip,
} from "./ui";

function fullName(u: AdminUserSummary): string {
  const name = u.displayName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");
  return name || u.email;
}

function location(u: AdminUserSummary): string {
  return [u.city, u.countryCode].filter(Boolean).join(", ");
}

function UserRow({
  user,
  onChanged,
}: {
  user: AdminUserSummary;
  onChanged: (id: string, value: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const res = await setAmbassador(user.id, !user.isAmbassador);
      onChanged(user.id, res.isAmbassador);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Erreur. Réessaie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Avatar src={user.avatarUrl} name={fullName(user)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[#1A0F0A] truncate">
              {fullName(user)}
            </span>
            {user.identityStatus === "approved" ? (
              <BadgeCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-label="Identité vérifiée" />
            ) : null}
            {user.isAmbassador ? (
              <Award className="w-4 h-4 text-amber-500 shrink-0" aria-label="Ambassadeur" />
            ) : null}
          </div>
          <p className="text-xs text-[#8A6B4D] truncate">
            {user.email}
            {location(user) ? ` · ${location(user)}` : ""}
          </p>
          {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null}
        </div>
        {user.isAmbassador ? (
          <GhostButton onClick={toggle} disabled={pending} tone="danger">
            {pending ? "…" : "Retirer le badge"}
          </GhostButton>
        ) : (
          <PrimaryButton onClick={toggle} disabled={pending}>
            {pending ? "…" : "Nommer ambassadeur"}
          </PrimaryButton>
        )}
      </div>
    </Card>
  );
}

export default function AmbassadorsSection() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback((q: string, signal?: AbortSignal) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setItems([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    searchAdminUsers(trimmed, 20, signal)
      .then((res) => {
        setItems(res.items);
        setSearched(true);
      })
      .catch((e) => {
        if (signal?.aborted) return;
        setError(e instanceof AdminApiError ? e.message : "Erreur de recherche.");
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, []);

  // Debounced search as the admin types (250ms).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const controller = new AbortController();
    debounceRef.current = setTimeout(() => runSearch(query, controller.signal), 250);
    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  function onChanged(id: string, value: boolean) {
    setItems((prev) => prev.map((u) => (u.id === id ? { ...u, isAmbassador: value } : u)));
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-[#1A0F0A]">Ambassadeurs</h2>
          <p className="text-sm text-[#8A6B4D] mt-0.5">
            Attribue un badge ambassadeur (distinct de la vérification d&apos;identité)
            aux membres référents de la communauté.
          </p>
        </div>
        <StatusChip tone="amber">
          <Award className="w-3.5 h-3.5" /> Badge curaté
        </StatusChip>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A6B4D]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un membre (nom ou email)…"
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] placeholder-[#B59B82] focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-3">
          {items.map((u) => (
            <UserRow key={u.id} user={u} onChanged={onChanged} />
          ))}
        </div>
      ) : searched ? (
        <EmptyState>
          <p className="font-semibold text-[#1A0F0A]">Aucun membre trouvé</p>
          <p className="text-sm mt-1">Essaie un autre nom ou email.</p>
        </EmptyState>
      ) : (
        <EmptyState>
          <p className="font-semibold text-[#1A0F0A]">Recherche un membre</p>
          <p className="text-sm mt-1">
            Tape au moins 2 caractères pour trouver un membre à promouvoir.
          </p>
        </EmptyState>
      )}
    </section>
  );
}
