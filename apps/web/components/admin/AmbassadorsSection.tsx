"use client";

// Ambassadeurs — réseau nommé + outil de nomination.
//
// La section ne savait que CHERCHER un membre pour lui poser un badge : aucune
// vue de ceux déjà nommés, donc aucun moyen de relire son propre réseau. Le
// bloc du haut répare ça — l'API savait déjà répondre (`?ambassador=true`),
// personne ne le lui demandait.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Award, BadgeCheck, RefreshCw, Search, UserX } from "lucide-react";
import {
  listAdminUsers,
  searchAdminUsers,
  setAmbassador,
  AdminApiError,
  type AdminUser,
  type AdminUserSummary,
} from "@/lib/adminApi";
import { countryFlag, countryName } from "./map/countryNames";
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

/** Champs communs aux deux sources (recherche et liste filtrée). */
type AnyUser = AdminUserSummary | AdminUser;

function fullName(u: AnyUser): string {
  const name = u.displayName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");
  return name || u.email;
}

function place(u: AnyUser): string {
  return [u.city, u.countryCode ? countryName(u.countryCode) : null]
    .filter(Boolean)
    .join(", ");
}

/** « il y a 3 jours » — repère plus parlant qu'une date pour une activité. */
function sinceLabel(iso: string | null): string {
  if (!iso) return "date inconnue";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "date inconnue";
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} j`;
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
  return `il y a ${Math.floor(days / 365)} an${days >= 730 ? "s" : ""}`;
}

// ---------------------------------------------------------------------------
// Réseau nommé
// ---------------------------------------------------------------------------

function AmbassadorCard({
  user,
  onRemoved,
}: {
  user: AdminUser;
  onRemoved: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await setAmbassador(user.id, false);
      onRemoved(user.id);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Erreur. Réessaie.");
      setPending(false);
    }
  }

  const flag = countryFlag(user.countryCode);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar src={user.avatarUrl} name={fullName(user)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[#1A0F0A] truncate">
              {fullName(user)}
            </span>
            {user.identityStatus === "approved" ? (
              <BadgeCheck
                className="w-4 h-4 text-emerald-600 shrink-0"
                aria-label="Identité vérifiée"
              />
            ) : null}
          </div>

          <p className="text-xs text-[#8A6B4D] truncate">{user.email}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-[#8A6B4D]">
            <span className="inline-flex items-center gap-1 font-medium text-[#1A0F0A]">
              {/* Le drapeau porte l'info d'un coup d'œil ; le nom du pays reste
                  écrit pour les lecteurs d'écran et les codes non traduits. */}
              {flag ? <span aria-hidden="true">{flag}</span> : null}
              {place(user) || "Localisation inconnue"}
            </span>
            <span>
              Nommé{" "}
              <span className="font-medium text-[#1A0F0A]">
                {sinceLabel(user.ambassadorSince)}
              </span>
              {user.ambassadorSince ? ` (${formatDate(user.ambassadorSince)})` : ""}
            </span>
            <span>
              Membre depuis <span className="font-medium">{formatDate(user.createdAt)}</span>
            </span>
            {user.status !== "active" ? (
              <StatusChip tone="red">
                {user.status === "banned" ? "Banni" : "Suspendu"}
              </StatusChip>
            ) : null}
            {user.identityStatus !== "approved" ? (
              <StatusChip tone="amber">Identité non vérifiée</StatusChip>
            ) : null}
          </div>

          {error ? <p className="text-xs text-red-600 mt-1.5">{error}</p> : null}
        </div>

        <GhostButton onClick={remove} disabled={pending} tone="danger">
          {pending ? "…" : "Retirer"}
        </GhostButton>
      </div>
    </Card>
  );
}

function AmbassadorNetwork({
  refreshKey,
  onCount,
}: {
  refreshKey: number;
  onCount: (n: number) => void;
}) {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      listAdminUsers({ ambassador: true, limit: 100 }, signal)
        .then((res) => {
          // Le plus récemment nommé en tête ; les badges antérieurs au suivi de
          // la date (ambassadorSince null) ferment la marche.
          const sorted = [...res.items].sort((a, b) => {
            if (!a.ambassadorSince) return 1;
            if (!b.ambassadorSince) return -1;
            return b.ambassadorSince.localeCompare(a.ambassadorSince);
          });
          setItems(sorted);
          onCount(sorted.length);
        })
        .catch((e) => {
          if (signal?.aborted) return;
          setError(
            e instanceof AdminApiError ? e.message : "Chargement impossible.",
          );
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [onCount],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  // Répartition par pays : c'est la lecture utile d'un réseau de référents —
  // où la diaspora est couverte, et où elle ne l'est pas.
  const byCountry = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of items) {
      const key = u.countryCode?.toUpperCase() ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (error) return <ErrorBanner message={error} onRetry={() => load()} />;

  if (items.length === 0) {
    return (
      <EmptyState>
        <UserX className="w-6 h-6 mx-auto text-[#8A6B4D] mb-2" aria-hidden="true" />
        <p className="font-semibold text-[#1A0F0A]">Aucun ambassadeur nommé</p>
        <p className="text-sm mt-1">
          Cherche un membre ci-dessous pour lui attribuer le badge.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {byCountry.map(([code, count]) => (
          <span
            key={code || "unknown"}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DFD3] bg-[#FFF8F3] px-3 py-1 text-xs font-semibold text-[#1A0F0A]"
          >
            <span aria-hidden="true">{countryFlag(code) || "🏳️"}</span>
            {code ? countryName(code) : "Pays non renseigné"}
            <span className="text-[#8A6B4D]">{count}</span>
          </span>
        ))}
      </div>

      {items.map((u) => (
        <AmbassadorCard
          key={u.id}
          user={u}
          onRemoved={(id) => {
            setItems((prev) => {
              const next = prev.filter((x) => x.id !== id);
              onCount(next.length);
              return next;
            });
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nomination
// ---------------------------------------------------------------------------

function SearchRow({
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

  const flag = countryFlag(user.countryCode);

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
              <BadgeCheck
                className="w-4 h-4 text-emerald-600 shrink-0"
                aria-label="Identité vérifiée"
              />
            ) : null}
            {user.isAmbassador ? (
              <Award className="w-4 h-4 text-amber-500 shrink-0" aria-label="Ambassadeur" />
            ) : null}
          </div>
          <p className="text-xs text-[#8A6B4D] truncate">
            {user.email}
            {place(user) ? ` · ${flag ? `${flag} ` : ""}${place(user)}` : ""}
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
  const [total, setTotal] = useState<number | null>(null);
  // Incrémenté après chaque nomination pour que le réseau se recharge : sans
  // ça, un badge posé depuis la recherche n'apparaissait jamais au-dessus.
  const [refreshKey, setRefreshKey] = useState(0);
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
    setRefreshKey((k) => k + 1);
  }

  const onCount = useCallback((n: number) => setTotal(n), []);

  return (
    <section>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-[#1A0F0A]">Ambassadeurs</h2>
          <p className="text-sm text-[#8A6B4D] mt-0.5">
            Le badge ambassadeur est une distinction curée, indépendante de la
            vérification d&apos;identité.
          </p>
        </div>
        <StatusChip tone="amber">
          <Award className="w-3.5 h-3.5" />
          {total === null ? "Badge curaté" : `${total} nommé${total > 1 ? "s" : ""}`}
        </StatusChip>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-bold text-[#1A0F0A]">Réseau nommé</h3>
          <GhostButton onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCw className="w-3.5 h-3.5" /> Rafraîchir
          </GhostButton>
        </div>
        <AmbassadorNetwork refreshKey={refreshKey} onCount={onCount} />
      </div>

      <h3 className="text-sm font-bold text-[#1A0F0A] mb-3">Nommer un membre</h3>

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
            <SearchRow key={u.id} user={u} onChanged={onChanged} />
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
