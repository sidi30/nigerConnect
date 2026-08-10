"use client";

// Carte des membres — repérer quelqu'un sur le terrain et agir tout de suite.
//
// Tuiles OpenStreetMap via Leaflet : pas de service à clé ni à quota, la carte
// reste gratuite et libre. Le composant Leaflet lui-même est chargé en
// dynamique sans rendu serveur (il touche `window` à l'import).
//
// Deux garde-fous portés par l'interface :
//  1. les positions sont approximatives par défaut (centroïde de ville +
//     décalage) — jamais présentées comme une adresse ;
//  2. voir les positions GPS réelles demande un bris de glace explicite
//     (code authenticator + motif, 30 min, tracé).

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Info, Layers, MapIcon, RefreshCw, Users, X } from "lucide-react";
import {
  AdminApiError,
  closePreciseLocationWindow,
  fetchMapFacets,
  fetchMapUsers,
  fetchPreciseLocationWindow,
  type AdminRole,
  type MapFacets,
  type MapUser,
  type PreciseLocationWindow,
} from "@/lib/adminApi";
import {
  Avatar,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  GhostButton,
  Skeleton,
} from "./ui";
import { placeLabel } from "./map/countryNames";
import MapFilters, {
  DEFAULT_MAP_FILTERS,
  toQuery,
  type MapFilterState,
} from "./map/MapFilters";
import {
  PreciseLocationBanner,
  PreciseLocationDialog,
  PreciseLocationToggle,
  useRemainingSeconds,
} from "./map/PreciseLocation";
import UserPanel from "./map/UserPanel";

// Leaflet ne survit pas au rendu serveur : import client uniquement.
const MapCanvas = dynamic(() => import("./map/MapCanvas"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

const PAGE_SIZE = 200;
const FILTER_DEBOUNCE_MS = 300;

export default function MapSection({
  role,
  onOpenUsersSection,
}: {
  role: AdminRole | null;
  onOpenUsersSection?: (userId: string) => void;
}) {
  const isAdmin = role === "admin";

  const [filters, setFilters] = useState<MapFilterState>(DEFAULT_MAP_FILTERS);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const [items, setItems] = useState<MapUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [withoutPosition, setWithoutPosition] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<MapFacets | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Membres d'un groupe que le zoom ne peut pas séparer — présentés en liste.
  const [stackedIds, setStackedIds] = useState<string[] | null>(null);

  const [preciseWindow, setPreciseWindow] = useState<PreciseLocationWindow>({
    active: false,
    until: null,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Sérialisation des filtres : sert de clé de dépendance ET de signal de
  // recadrage de la carte (nouveaux filtres = nouveau cadrage).
  const query = useMemo(() => toQuery(filters), [filters]);
  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  // La fenêtre GPS fait partie de la requête : quand elle s'ouvre ou se ferme,
  // l'API ne renvoie pas les mêmes coordonnées.
  const preciseKey = preciseWindow.active ? "gps" : "city";

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      fetchMapUsers({ ...query, limit: PAGE_SIZE }, signal)
        .then((res) => {
          setItems(res.items);
          setCursor(res.nextCursor);
          setTotal(res.total);
          setWithoutPosition(res.withoutPosition);
          setStackedIds(null);
          // Une fiche ouverte sur un membre sorti du filtre n'a plus de sens.
          setSelectedId((current) =>
            current && res.items.some((u) => u.id === current) ? current : null,
          );
        })
        .catch((e) => {
          if (signal?.aborted) return;
          setError(
            e instanceof AdminApiError
              ? e.message
              : "Chargement de la carte impossible.",
          );
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [query],
  );

  useEffect(() => {
    const controller = new AbortController();
    const id = window.setTimeout(
      () => load(controller.signal),
      FILTER_DEBOUNCE_MS,
    );
    return () => {
      controller.abort();
      window.clearTimeout(id);
    };
  }, [load, preciseKey]);

  // Facettes : ce que les listes déroulantes doivent proposer, compté en base.
  // Chaque facette ignore le filtre qu'elle pilote côté API, donc choisir un
  // pays ne fait pas disparaître les autres pays de la liste.
  useEffect(() => {
    const controller = new AbortController();
    const id = window.setTimeout(() => {
      fetchMapFacets(query, controller.signal)
        .then(setFacets)
        .catch(() => {
          /* listes vides plutôt qu'un écran en erreur : les filtres texte et
             les autres critères restent utilisables */
        });
    }, FILTER_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(id);
    };
  }, [query]);

  // État initial du bris de glace : une fenêtre peut déjà être ouverte (autre
  // onglet, rechargement de page).
  useEffect(() => {
    const controller = new AbortController();
    fetchPreciseLocationWindow(controller.signal)
      .then(setPreciseWindow)
      .catch(() => {
        /* l'endpoint peut être fermé au rôle : on reste en position ville */
      });
    return () => controller.abort();
  }, []);

  const handleExpire = useCallback(() => {
    // Retour automatique en position ville, sans rechargement manuel.
    setPreciseWindow({ active: false, until: null });
  }, []);

  const remaining = useRemainingSeconds(
    preciseWindow.active ? preciseWindow.until : null,
    handleExpire,
  );

  async function revoke() {
    setRevoking(true);
    try {
      await closePreciseLocationWindow();
    } catch {
      /* même en cas d'échec réseau on repasse en ville côté écran */
    } finally {
      setPreciseWindow({ active: false, until: null });
      setRevoking(false);
    }
  }

  function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    fetchMapUsers({ ...query, limit: PAGE_SIZE, cursor })
      .then((res) => {
        setItems((prev) => [...prev, ...res.items]);
        setCursor(res.nextCursor);
        setTotal(res.total);
        setWithoutPosition(res.withoutPosition);
      })
      .catch((e) =>
        setError(
          e instanceof AdminApiError ? e.message : "Chargement impossible.",
        ),
      )
      .finally(() => setLoadingMore(false));
  }

  const selected = selectedId
    ? (items.find((u) => u.id === selectedId) ?? null)
    : null;
  const stacked = stackedIds
    ? items.filter((u) => stackedIds.includes(u.id))
    : null;
  const onMap = items.filter((u) => u.lat !== null && u.lng !== null).length;

  function select(userId: string) {
    setSelectedId(userId);
    setStackedIds(null);
  }

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-[#1A0F0A]">Carte</h2>
        <p className="text-sm text-[#8A6B4D] mt-0.5">
          Où vivent les membres, qui est actif, et qui a besoin d&apos;une
          intervention. Fond de carte OpenStreetMap.
        </p>
      </div>

      <div className="space-y-4">
        {preciseWindow.active ? (
          <PreciseLocationBanner
            remaining={remaining}
            onRevoke={revoke}
            revoking={revoking}
          />
        ) : null}

        <MapFilters
          value={filters}
          onChange={setFilters}
          onReset={() => setFilters(DEFAULT_MAP_FILTERS)}
          expanded={filtersExpanded}
          onToggleExpanded={() => setFiltersExpanded((v) => !v)}
          facets={facets}
        />

        {error ? <ErrorBanner message={error} onRetry={() => load()} /> : null}

        <Card className="p-4">
          <CardHeader
            title="Membres géolocalisés"
            subtitle={
              loading
                ? "Chargement…"
                : `${onMap.toLocaleString("fr-FR")} membre(s) affiché(s) sur ${total.toLocaleString(
                    "fr-FR",
                  )} — dont ${withoutPosition.toLocaleString("fr-FR")} sans position connue, absent(s) de la carte.`
            }
            icon={Users}
            right={
              <div className="flex items-center gap-1.5">
                <GhostButton onClick={() => load()} disabled={loading}>
                  <RefreshCw
                    className={`w-4 h-4 inline ${loading ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="sr-only">Rafraîchir</span>
                </GhostButton>
                {isAdmin ? (
                  <PreciseLocationToggle
                    active={preciseWindow.active}
                    onOpen={() => setDialogOpen(true)}
                    onRevoke={revoke}
                    busy={revoking}
                  />
                ) : null}
              </div>
            }
          />

          <p className="flex items-start gap-1.5 text-xs text-[#8A6B4D] mb-2">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            Aucun de ces points n&apos;est une adresse. Le remplissage du
            marqueur dit ce qu&apos;il vaut :
          </p>
          <MapLegend showPrecise={preciseWindow.active} />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4">
            <div className="relative h-[60vh] min-h-[24rem] rounded-xl overflow-hidden border border-[#E8DFD3]">
              <MapCanvas
                users={items}
                selectedId={selectedId}
                onSelect={select}
                onStack={setStackedIds}
                fitKey={`${queryKey}|${preciseKey}`}
              />
              {/* Au-dessus des contrôles Leaflet (z-index max 1000) et calé à
                  droite pour ne pas masquer les boutons de zoom. */}
              {loading ? (
                <div className="absolute top-2 right-2 z-[1100] rounded-full border border-[#E8DFD3] bg-[#FFF8F3]/95 px-3 py-1 text-xs font-semibold text-[#8A6B4D] shadow-sm">
                  Chargement des membres…
                </div>
              ) : null}
            </div>

            <div className="min-w-0">
              {selected ? (
                <UserPanel
                  user={selected}
                  isAdmin={isAdmin}
                  onClose={() => setSelectedId(null)}
                  onChanged={(patch) =>
                    setItems((prev) =>
                      prev.map((u) =>
                        u.id === patch.id ? { ...u, ...patch } : u,
                      ),
                    )
                  }
                  onOpenFullProfile={(id) => onOpenUsersSection?.(id)}
                />
              ) : stacked && stacked.length > 0 ? (
                <StackedList
                  users={stacked}
                  onSelect={select}
                  onClose={() => setStackedIds(null)}
                />
              ) : loading ? (
                <Skeleton className="h-64 w-full rounded-2xl" />
              ) : items.length === 0 ? (
                <EmptyState>
                  <p className="font-semibold text-[#1A0F0A]">Aucun membre</p>
                  <p className="text-sm mt-1">
                    Aucun compte ne correspond à ces filtres.
                  </p>
                </EmptyState>
              ) : (
                <Card className="p-6 text-center">
                  <MapIcon
                    className="w-6 h-6 mx-auto text-[#8A6B4D]"
                    aria-hidden="true"
                  />
                  <p className="mt-2 font-semibold text-[#1A0F0A]">
                    Sélectionne un membre
                  </p>
                  <p className="text-sm text-[#8A6B4D] mt-1">
                    Clique un point de la carte pour ouvrir sa fiche et agir.
                    Les nombres dans les ronds regroupent plusieurs membres :
                    clique dessus pour zoomer.
                  </p>
                </Card>
              )}
            </div>
          </div>

          {cursor ? (
            <div className="flex justify-center pt-4">
              <GhostButton onClick={loadMore} disabled={loadingMore}>
                {loadingMore
                  ? "Chargement…"
                  : `Charger ${PAGE_SIZE} membres de plus`}
              </GhostButton>
            </div>
          ) : null}
        </Card>
      </div>

      {dialogOpen ? (
        <PreciseLocationDialog
          onClose={() => setDialogOpen(false)}
          onOpened={(win) => {
            setPreciseWindow(win);
            setDialogOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Membres empilés sur un point que le zoom ne sépare pas (même centroïde de
 * ville, par exemple). Sans cette liste ils resteraient hors de portée du clic.
 */
function StackedList({
  users,
  onSelect,
  onClose,
}: {
  users: MapUser[];
  onSelect: (userId: string) => void;
  onClose: () => void;
}) {
  return (
    <Card className="p-4">
      <CardHeader
        title={`${users.length} membres au même point`}
        subtitle="Ils partagent la même position connue : zoomer ne les sépare pas."
        icon={Layers}
        right={
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la liste"
            className="grid place-items-center w-8 h-8 rounded-lg text-[#5A4634] hover:bg-[#F1E9DD]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        }
      />
      <ul className="divide-y divide-[#E8DFD3] max-h-80 overflow-y-auto">
        {users.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => onSelect(u.id)}
              className="flex items-center gap-2.5 w-full text-left px-1 py-2 hover:bg-[#FDFBF7] rounded-lg"
            >
              <Avatar src={u.avatarUrl} name={memberName(u)} size={32} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[#1A0F0A] truncate">
                  {memberName(u)}
                </span>
                <span className="block text-xs text-[#8A6B4D] truncate">
                  {placeLabel(u.city, u.countryCode) || "Ville inconnue"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function memberName(u: MapUser): string {
  const n = u.displayName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");
  return n || "Membre sans nom";
}

/**
 * Légende des marqueurs — les pastilles reprennent exactement les styles en
 * ligne de MapCanvas. Le remplissage se vide à mesure que la position devient
 * floue, la couleur n'est jamais le seul signal (le texte le dit aussi).
 */
function MapLegend({ showPrecise }: { showPrecise: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3 text-xs text-[#5A4634]">
      {showPrecise ? (
        <LegendItem
          label="GPS réel du membre"
          swatch={
            <span
              className="block w-3 h-3 rounded-full"
              style={{
                background: "#B45309",
                outline: "2px dashed #B45309",
                outlineOffset: 2,
              }}
            />
          }
        />
      ) : null}
      <LegendItem
        label="Position enregistrée (ville + décalage)"
        swatch={
          <span
            className="block w-3 h-3 rounded-full"
            style={{ background: "#E05206" }}
          />
        }
      />
      <LegendItem
        label="Déduite de la ville déclarée"
        swatch={
          <span
            className="block w-3 h-3 rounded-full"
            style={{ background: "#E05206", opacity: 0.55 }}
          />
        }
      />
      <LegendItem
        label="Déduite du pays seul"
        swatch={
          <span
            className="block w-3 h-3 rounded-full box-border"
            style={{ border: "2px solid #E05206" }}
          />
        }
      />
      <LegendItem
        label="Membres regroupés — cliquer pour zoomer"
        swatch={
          <span
            className="grid place-items-center w-4 h-4 rounded-full text-[9px] font-bold text-white"
            style={{ background: "#E05206" }}
          >
            9
          </span>
        }
      />
    </ul>
  );
}

function LegendItem({
  swatch,
  label,
}: {
  swatch: React.ReactNode;
  label: string;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="shrink-0 grid place-items-center w-5" aria-hidden="true">
        {swatch}
      </span>
      {label}
    </li>
  );
}
