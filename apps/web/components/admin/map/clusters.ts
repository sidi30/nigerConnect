// Regroupement de marqueurs, fait à la main : une grille en pixels écran.
//
// Pas de leaflet.markercluster ici — la dépendance n'est plus maintenue côté
// types et on n'a besoin que de ça : à un zoom donné, deux membres dont les
// points tombent dans la même cellule se superposent, donc ils fusionnent.
// Le regroupement est recalculé à chaque zoom/déplacement (voir MapCanvas).

import type { Map as LeafletMap } from "leaflet";
import type { MapUser } from "@/lib/adminApi";

/** Un membre dont on sait qu'il a des coordonnées (lat/lng non nuls). */
export type PositionedUser = MapUser & { lat: number; lng: number };

export interface MarkerCluster {
  /** Stable tant que la cellule et son contenu ne changent pas. */
  key: string;
  lat: number;
  lng: number;
  members: PositionedUser[];
  /** Vrai dès qu'au moins un membre du groupe est en position GPS réelle. */
  hasPrecise: boolean;
}

export function withPosition(users: MapUser[]): PositionedUser[] {
  return users.filter(
    (u): u is PositionedUser => u.lat !== null && u.lng !== null,
  );
}

/**
 * Groupe les membres par cellule de `cellPx` pixels à l'écran. Le point du
 * groupe est le barycentre de ses membres, pas le centre de la cellule : un
 * groupe de deux reste posé entre les deux personnes.
 */
export function clusterByScreenGrid(
  map: LeafletMap,
  users: PositionedUser[],
  cellPx = 56,
): MarkerCluster[] {
  const cells = new Map<string, PositionedUser[]>();

  for (const user of users) {
    const point = map.latLngToContainerPoint([user.lat, user.lng]);
    const cellKey = `${Math.floor(point.x / cellPx)}:${Math.floor(point.y / cellPx)}`;
    const bucket = cells.get(cellKey);
    if (bucket) bucket.push(user);
    else cells.set(cellKey, [user]);
  }

  const clusters: MarkerCluster[] = [];
  for (const [cellKey, members] of cells) {
    let sumLat = 0;
    let sumLng = 0;
    let hasPrecise = false;
    for (const m of members) {
      sumLat += m.lat;
      sumLng += m.lng;
      if (m.precision === "gps") hasPrecise = true;
    }
    clusters.push({
      key: `${cellKey}|${members.length}|${members[0].id}`,
      lat: sumLat / members.length,
      lng: sumLng / members.length,
      members,
      hasPrecise,
    });
  }
  return clusters;
}
