"use client";

// Carte Leaflet + tuiles OpenStreetMap. Chargé uniquement côté client
// (next/dynamic ssr:false depuis MapSection) : Leaflet touche `window` dès
// l'évaluation du module, un rendu serveur casserait le build.
//
// L'instance vit dans une ref et n'est créée qu'une fois : on ne recrée jamais
// la carte, seuls les marqueurs sont reconstruits dans leur LayerGroup. Au
// démontage, `map.remove()` — sinon Leaflet lève « Map container is already
// initialized » au retour sur l'onglet.

import { useEffect, useRef } from "react";
// `import * as` et pas un import par défaut : @types/leaflet n'expose pas de
// default export, seul le namespace donne accès aux types (L.Map, L.Marker…).
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapPositionSource, MapUser } from "@/lib/adminApi";
import { palette } from "../ui";
import {
  clusterByScreenGrid,
  withPosition,
  type PositionedUser,
} from "./clusters";
import { placeLabel } from "./countryNames";

// Vue par défaut : Afrique de l'Ouest + Europe dans le même cadre, la diaspora
// nigérienne vit essentiellement sur cet axe.
const DEFAULT_CENTER: L.LatLngExpression = [20, 4];
const DEFAULT_ZOOM = 3;

// Au-delà, les tuiles OSM n'existent plus.
const MAX_ZOOM = 19;

// Recadrage automatique : on ne colle jamais plus près que ça, sinon un membre
// isolé enverrait la carte au ras du sol et l'admin perdrait le contexte.
const FIT_MAX_ZOOM = 12;

export interface MapCanvasProps {
  users: MapUser[];
  selectedId: string | null;
  onSelect: (userId: string) => void;
  /**
   * Groupe que le zoom ne peut plus séparer (membres exactement superposés, ou
   * zoom maximal atteint) : à charge de l'appelant de proposer la liste, sinon
   * ces membres seraient inatteignables.
   */
  onStack: (userIds: string[]) => void;
  /**
   * Change de valeur quand le jeu de résultats change (nouveaux filtres) :
   * c'est le signal de recadrer la carte sur les points. Inchangé = la vue de
   * l'admin est préservée (chargement d'une page suivante, ouverture d'une fiche).
   */
  fitKey: string;
}

export default function MapCanvas({
  users,
  selectedId,
  onSelect,
  onStack,
  fitKey,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  // Le rendu des marqueurs est déclenché par des évènements Leaflet (zoom,
  // déplacement) : il doit lire les props courantes, jamais celles capturées
  // au moment où le handler a été posé.
  const propsRef = useRef({ users, selectedId, onSelect, onStack });
  propsRef.current = { users, selectedId, onSelect, onStack };
  const drawRef = useRef<() => void>(() => {});

  // ── Création / destruction de la carte (une seule fois) ────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      worldCopyJump: true,
      zoomControl: true,
    });

    // Attribution OSM : c'est la condition de leur licence, elle ne se retire pas.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: MAX_ZOOM,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const redraw = () => drawRef.current();
    map.on("zoomend", redraw);
    map.on("moveend", redraw);

    // Le conteneur change de taille quand le panneau latéral s'ouvre/se ferme.
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => map.invalidateSize());
    observer?.observe(container);

    drawRef.current();

    return () => {
      observer?.disconnect();
      map.off("zoomend", redraw);
      map.off("moveend", redraw);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // ── Rendu des marqueurs (regroupés en clusters d'écran) ────────────────────
  drawRef.current = () => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const {
      users: current,
      selectedId: selected,
      onSelect: select,
      onStack: stack,
    } = propsRef.current;
    layer.clearLayers();

    const positioned = withPosition(current);
    for (const cluster of clusterByScreenGrid(map, positioned)) {
      if (cluster.members.length === 1) {
        layer.addLayer(
          buildSingleMarker(cluster.members[0], selected, select),
        );
      } else {
        layer.addLayer(
          buildClusterMarker(
            cluster.lat,
            cluster.lng,
            cluster.members,
            cluster.hasPrecise,
            map,
            stack,
          ),
        );
      }
    }
  };

  useEffect(() => {
    drawRef.current();
  }, [users, selectedId]);

  // ── Recadrage sur les résultats quand les filtres changent ─────────────────
  // Une fois par fitKey, au premier lot de points non vide : au montage la
  // liste est encore vide (la requête part après), et une page suivante ne doit
  // pas voler la vue à l'admin.
  const fittedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fittedKeyRef.current === fitKey) return;
    const positioned = withPosition(users);
    if (positioned.length === 0) return;
    fittedKeyRef.current = fitKey;
    map.fitBounds(
      L.latLngBounds(positioned.map((u) => [u.lat, u.lng] as [number, number])),
      { padding: [48, 48], maxZoom: FIT_MAX_ZOOM },
    );
  }, [fitKey, users]);

  // ── Amener le membre sélectionné dans le cadre s'il est hors écran ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const target = users.find(
      (u) => u.id === selectedId && u.lat !== null && u.lng !== null,
    );
    if (!target || target.lat === null || target.lng === null) return;
    const latLng = L.latLng(target.lat, target.lng);
    if (!map.getBounds().contains(latLng)) {
      map.panTo(latLng, { animate: true });
    }
  }, [selectedId, users]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Carte des membres. Utilise la tabulation pour parcourir les marqueurs."
      className="h-full w-full bg-[#F1E9DD]"
    />
  );
}

// ---------------------------------------------------------------------------
// Marqueurs — divIcon en styles en ligne (aucune dépendance à Tailwind, ce HTML
// n'est pas scanné par le compilateur de classes) et aucune donnée utilisateur
// injectée dans le HTML : les noms passent par l'attribut `title`/`aria-label`,
// posés par Leaflet via setAttribute.
// ---------------------------------------------------------------------------

function displayNameOf(user: MapUser): string {
  const name =
    user.displayName ??
    [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || "Membre sans nom";
}

/** Position GPS réelle : contour pointillé ambre + point central. */
function preciseDecoration(): string {
  return "outline:2px dashed #B45309;outline-offset:3px;";
}

/**
 * Une échelle de confiance en quatre crans, lisible sans la couleur — le
 * remplissage se vide à mesure que la position devient floue :
 *
 *   GPS réel  → disque ambre + contour pointillé + point blanc central
 *   'stored'  → disque orange plein     (coordonnée portée par le compte)
 *   'city'    → disque atténué          (déduite de la ville déclarée)
 *   'country' → anneau creux            (on ne sait que le pays)
 *
 * `precision` et `positionSource` sont deux axes distincts : un point GPS l'emporte
 * sur la provenance, tout le reste est classé par provenance.
 */
function singleIconHtml(
  precise: boolean,
  source: MapPositionSource | null,
  selected: boolean,
): string {
  const size = selected ? 24 : 18;
  const ring = selected ? `0 0 0 4px ${palette.ink}` : "0 0 0 2px #FFFFFF";

  let fill: string;
  if (precise) {
    fill = `background:${palette.amber};`;
  } else if (source === "country") {
    fill = `background:transparent;border:${selected ? 4 : 3}px solid ${palette.primary};`;
  } else if (source === "city") {
    fill = `background:${palette.primary};opacity:0.55;`;
  } else {
    fill = `background:${palette.primary};`;
  }

  return [
    `<span style="box-sizing:border-box;display:block;width:${size}px;height:${size}px;border-radius:9999px;`,
    fill,
    `box-shadow:${ring},0 2px 6px rgba(26,15,10,0.45);`,
    precise ? preciseDecoration() : "",
    `"></span>`,
    precise
      ? `<span style="position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:9999px;background:#FFFFFF;"></span>`
      : "",
  ].join("");
}

/** Ce que vaut le point, en toutes lettres — pour le title et l'aria-label. */
function positionWording(
  precise: boolean,
  source: MapPositionSource | null,
): string {
  if (precise) return "position GPS précise";
  if (source === "country") return "position déduite du pays";
  if (source === "city") return "position déduite de la ville déclarée";
  return "position approximative";
}

function buildSingleMarker(
  user: PositionedUser,
  selectedId: string | null,
  onSelect: (id: string) => void,
): L.Marker {
  const selected = user.id === selectedId;
  const size = selected ? 24 : 18;
  const precise = user.precision === "gps";
  const name = displayNameOf(user);
  const place = placeLabel(user.city, user.countryCode);
  const label = `${name}${place ? ` — ${place}` : ""} (${positionWording(
    precise,
    user.positionSource,
  )})`;

  const marker = L.marker([user.lat, user.lng], {
    title: label,
    keyboard: true,
    riseOnHover: true,
    zIndexOffset: selected ? 1000 : 0,
    icon: L.divIcon({
      className: "",
      html: `<span style="position:relative;display:block;">${singleIconHtml(precise, user.positionSource, selected)}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    }),
  });

  // Leaflet transforme déjà Entrée en clic sur un marqueur focalisé
  // (option keyboard) : un seul handler suffit pour souris et clavier.
  marker.on("click", () => onSelect(user.id));
  marker.on("add", () => marker.getElement()?.setAttribute("aria-label", label));
  return marker;
}

function buildClusterMarker(
  lat: number,
  lng: number,
  members: PositionedUser[],
  hasPrecise: boolean,
  map: L.Map,
  onStack: (userIds: string[]) => void,
): L.Marker {
  const count = members.length;
  const size = count < 10 ? 34 : count < 100 ? 42 : 50;
  const label = `${count} membres regroupés ici. Activer pour les séparer.`;

  const marker = L.marker([lat, lng], {
    title: label,
    keyboard: true,
    icon: L.divIcon({
      className: "",
      html:
        `<span style="display:flex;align-items:center;justify-content:center;` +
        `width:${size}px;height:${size}px;border-radius:9999px;` +
        `background:${palette.primary};color:#FFFFFF;font-weight:700;` +
        `font-size:${count < 100 ? 13 : 12}px;font-family:inherit;` +
        `box-shadow:0 0 0 4px rgba(224,82,6,0.25),0 2px 6px rgba(26,15,10,0.35);` +
        (hasPrecise ? preciseDecoration() : "") +
        `">${count}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    }),
  });

  const expand = () => {
    const bounds = L.latLngBounds(
      members.map((m) => [m.lat, m.lng] as [number, number]),
    );
    // Deux impasses où zoomer ne sépare rien : des membres exactement au même
    // point (centroïde de ville non bruité, plusieurs habitants de la même
    // ville sans coordonnée à eux) et le zoom maximal déjà atteint. Dans les
    // deux cas on rend la main à l'admin sous forme de liste, sinon ces
    // membres sont tout simplement inatteignables à la souris.
    const degenerate = bounds.getNorthEast().equals(bounds.getSouthWest());
    if (degenerate || map.getZoom() >= MAX_ZOOM) {
      onStack(members.map((m) => m.id));
      return;
    }
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: MAX_ZOOM });
  };

  marker.on("click", expand);
  marker.on("add", () => marker.getElement()?.setAttribute("aria-label", label));
  return marker;
}
