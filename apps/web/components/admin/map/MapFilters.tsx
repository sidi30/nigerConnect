"use client";

// Barre de filtres de la carte. Rien n'est filtré localement : les résultats
// sont paginés côté API, un filtre appliqué au tableau déjà chargé mentirait
// sur les compteurs. Chaque champ part donc en query param.

import { useMemo } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import type {
  IdentityDistStatus,
  MapFacets,
  MapSide,
  MapUserFilters,
  UserStatus,
} from "@/lib/adminApi";
import { Card, GhostButton } from "../ui";
import { compareByCountryName, countryName } from "./countryNames";

/** État affiché par la barre : tout en chaînes, converti au moment de l'appel. */
export interface MapFilterState {
  q: string;
  countryCode: string;
  city: string;
  status: UserStatus | "all";
  identityStatus: IdentityDistStatus | "all";
  ambassador: "all" | "true" | "false";
  side: MapSide | "all";
  /** "" = toute période, sinon un nombre de jours. */
  activeWithinDays: string;
  hasPosition: boolean;
}

export const DEFAULT_MAP_FILTERS: MapFilterState = {
  q: "",
  countryCode: "",
  city: "",
  status: "all",
  identityStatus: "all",
  ambassador: "all",
  side: "all",
  activeWithinDays: "",
  hasPosition: false,
};

/** Traduit l'état de la barre en query params (les valeurs neutres sont omises). */
export function toQuery(state: MapFilterState): MapUserFilters {
  const days = Number(state.activeWithinDays);
  return {
    q: state.q.trim() || undefined,
    countryCode: state.countryCode.trim()
      ? state.countryCode.trim().toUpperCase()
      : undefined,
    city: state.city.trim() || undefined,
    status: state.status === "all" ? undefined : state.status,
    identityStatus:
      state.identityStatus === "all" ? undefined : state.identityStatus,
    ambassador:
      state.ambassador === "all" ? undefined : state.ambassador === "true",
    side: state.side === "all" ? undefined : state.side,
    activeWithinDays:
      Number.isFinite(days) && days >= 1 && days <= 365 ? days : undefined,
    hasPosition: state.hasPosition ? true : undefined,
  };
}

const FIELD =
  "w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50";
const LABEL = "block text-xs font-semibold text-[#8A6B4D] mb-1";

const ACTIVITY_PERIODS: Array<{ value: string; label: string }> = [
  { value: "", label: "Peu importe" },
  { value: "1", label: "24 heures" },
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
  { value: "90", label: "90 jours" },
  { value: "365", label: "1 an" },
];

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Actif",
  suspended: "Suspendu",
  banned: "Banni",
};

export default function MapFilters({
  value,
  onChange,
  onReset,
  expanded,
  onToggleExpanded,
  facets,
}: {
  value: MapFilterState;
  onChange: (next: MapFilterState) => void;
  onReset: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Null tant que les facettes n'ont pas répondu : les listes restent vides. */
  facets: MapFacets | null;
}) {
  function set<K extends keyof MapFilterState>(
    key: K,
    next: MapFilterState[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  const activeCount = countActive(value);

  // Les pays se trient sur le nom français, jamais sur le code : « Allemagne »
  // (DE) doit précéder « Belgique » (BE).
  const countries = useMemo(() => {
    const rows = [...(facets?.countries ?? [])]
      .filter((c) => c.code)
      .sort((a, b) => compareByCountryName(a.code, b.code));
    // Le pays sélectionné a pu sortir de la facette (il n'est calculé qu'avec
    // les AUTRES filtres) : sans ça, le select afficherait du vide alors que le
    // filtre est bel et bien actif.
    const selected = value.countryCode.trim().toUpperCase();
    if (selected && !rows.some((r) => r.code === selected)) {
      rows.push({ code: selected, count: 0 });
    }
    return rows;
  }, [facets, value.countryCode]);

  const cities = useMemo(() => {
    const rows = [...(facets?.cities ?? [])].filter((c) => c.city);
    rows.sort((a, b) => a.city.localeCompare(b.city, "fr"));
    const selected = value.city.trim();
    if (selected && !rows.some((r) => r.city === selected)) {
      rows.push({ city: selected, countryCode: null, count: 0 });
    }
    return rows;
  }, [facets, value.city]);

  const statusCount = useMemo(() => {
    const map = new Map<UserStatus, number>();
    for (const s of facets?.statuses ?? []) map.set(s.value, s.count);
    return map;
  }, [facets]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A6B4D]"
            aria-hidden="true"
          />
          <input
            value={value.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Rechercher un membre (nom, email)…"
            aria-label="Rechercher un membre"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] placeholder-[#B59B82] focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          />
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border ${
              expanded
                ? "bg-[#1A0F0A] text-white border-[#1A0F0A]"
                : "bg-white text-[#5A4634] border-[#E8DFD3] hover:bg-[#FDFBF7]"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
            Filtres
            {activeCount > 0 ? (
              <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[#E05206] text-white text-[11px] font-bold tabular-nums">
                {activeCount}
              </span>
            ) : null}
          </button>
          {activeCount > 0 || value.q ? (
            <GhostButton onClick={onReset}>
              <RotateCcw className="w-4 h-4 inline" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-1">
                Réinitialiser
              </span>
            </GhostButton>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <Card className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block">
              <span className={LABEL}>Pays</span>
              <select
                className={FIELD}
                value={value.countryCode}
                onChange={(e) => set("countryCode", e.target.value)}
              >
                <option value="">Tous les pays</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {countryName(c.code)} ({c.code}) — {c.count}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={LABEL}>Ville</span>
              <select
                className={FIELD}
                value={value.city}
                onChange={(e) => set("city", e.target.value)}
              >
                <option value="">Toutes les villes</option>
                {cities.map((c) => (
                  <option key={`${c.city}|${c.countryCode ?? ""}`} value={c.city}>
                    {c.city}
                    {c.countryCode ? ` (${countryName(c.countryCode)})` : ""} —{" "}
                    {c.count}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={LABEL}>Statut du compte</span>
              <select
                className={FIELD}
                value={value.status}
                onChange={(e) =>
                  set("status", e.target.value as MapFilterState["status"])
                }
              >
                <option value="all">Tous</option>
                {(["active", "suspended", "banned"] as const).map((s) => {
                  const n = statusCount.get(s);
                  return (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                      {n === undefined ? "" : ` — ${n}`}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="block">
              <span className={LABEL}>Statut d&apos;identité</span>
              <select
                className={FIELD}
                value={value.identityStatus}
                onChange={(e) =>
                  set(
                    "identityStatus",
                    e.target.value as MapFilterState["identityStatus"],
                  )
                }
              >
                <option value="all">Tous</option>
                <option value="not_submitted">Non soumise</option>
                <option value="pending">En attente</option>
                <option value="approved">Approuvée</option>
                <option value="rejected">Rejetée</option>
              </select>
            </label>

            <label className="block">
              <span className={LABEL}>Ambassadeur</span>
              <select
                className={FIELD}
                value={value.ambassador}
                onChange={(e) =>
                  set(
                    "ambassador",
                    e.target.value as MapFilterState["ambassador"],
                  )
                }
              >
                <option value="all">Tous</option>
                <option value="true">Ambassadeurs</option>
                <option value="false">Non-ambassadeurs</option>
              </select>
            </label>

            <label className="block">
              <span className={LABEL}>Camp</span>
              <select
                className={FIELD}
                value={value.side}
                onChange={(e) =>
                  set("side", e.target.value as MapFilterState["side"])
                }
              >
                <option value="all">Tous</option>
                <option value="niger">Au Niger</option>
                <option value="diaspora">Diaspora</option>
              </select>
            </label>

            <label className="block">
              <span className={LABEL}>Actif depuis</span>
              <select
                className={FIELD}
                value={value.activeWithinDays}
                onChange={(e) => set("activeWithinDays", e.target.value)}
              >
                {ACTIVITY_PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                checked={value.hasPosition}
                onChange={(e) => set("hasPosition", e.target.checked)}
                className="w-4 h-4 rounded border-[#E5D5C3] text-[#E05206] focus:ring-2 focus:ring-amber-400/50"
              />
              <span className="text-sm font-semibold text-[#5A4634]">
                Avec position seulement
              </span>
            </label>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function countActive(state: MapFilterState): number {
  let n = 0;
  if (state.countryCode.trim()) n += 1;
  if (state.city.trim()) n += 1;
  if (state.status !== "all") n += 1;
  if (state.identityStatus !== "all") n += 1;
  if (state.ambassador !== "all") n += 1;
  if (state.side !== "all") n += 1;
  if (state.activeWithinDays) n += 1;
  if (state.hasPosition) n += 1;
  return n;
}
