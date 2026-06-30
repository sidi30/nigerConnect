/**
 * MapCanvas — native map renderer (react-native-maps) behind the feature flag,
 * a drop-in alternative to the Leaflet WebView. Encapsulates the map engine so
 * it stays swappable (react-native-maps ↔ Mapbox) per ADR-001.
 *
 * Renders the SAME server-computed markers (clustering stays server-side for
 * privacy) as the WebView: avatar pins (with a story ring P-04 + online dot),
 * cluster bubbles, association/page bubbles, plus the "you are here" marker and
 * its proximity zone circle. iOS uses Apple Maps (no API key).
 *
 * NOTE: a first native version — validate on the 1.8.0 dev build. Avatar markers
 * keep tracksViewChanges on until the image loads (correctness first); a later
 * pass can flip it off per-marker for max perf.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, type Region } from 'react-native-maps';
import type { MapMarker } from '@/services/geoApi';
import { Colors, Flags } from '@/constants/theme';
import { colorForId } from '@/constants/lookups';

export interface MapCanvasHandle {
  /** Animate the camera to a point at an approximate Leaflet-style zoom. */
  animateTo: (lat: number, lon: number, zoom?: number) => void;
}

interface Props {
  markers: MapMarker[];
  me: { lat: number; lon: number } | null;
  zoneRadiusKm: number;
  onReady: () => void;
  onBounds: (b: { north: number; south: number; east: number; west: number; zoom: number }) => void;
  onSelect: (m: MapMarker) => void;
}

const INITIAL_REGION: Region = {
  latitude: 20,
  longitude: 10,
  latitudeDelta: 80,
  longitudeDelta: 80,
};

/** Leaflet-style zoom → a region longitude delta (z grows → world shrinks). */
function deltaForZoom(zoom: number): number {
  return Math.max(0.01, 360 / Math.pow(2, zoom));
}

/** A region's longitude span → an approximate Leaflet zoom integer. */
function zoomForRegion(r: Region): number {
  return Math.round(Math.log2(360 / Math.max(r.longitudeDelta, 0.0001)));
}

function initials(name: string | null): string {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return (((p[0] ?? '')[0] ?? '') + ((p[1] ?? '')[0] ?? '')).toUpperCase() || '?';
}

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { markers, me, zoneRadiusKm, onReady, onBounds, onSelect },
  ref,
) {
  const mapRef = useRef<MapView>(null);

  useImperativeHandle(ref, () => ({
    animateTo: (lat, lon, zoom = 11) => {
      const d = deltaForZoom(zoom);
      mapRef.current?.animateToRegion(
        { latitude: lat, longitude: lon, latitudeDelta: d, longitudeDelta: d },
        700,
      );
    },
  }));

  function handleRegion(r: Region) {
    onBounds({
      north: r.latitude + r.latitudeDelta / 2,
      south: r.latitude - r.latitudeDelta / 2,
      east: r.longitude + r.longitudeDelta / 2,
      west: r.longitude - r.longitudeDelta / 2,
      zoom: zoomForRegion(r),
    });
  }

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={INITIAL_REGION}
      onMapReady={onReady}
      onRegionChangeComplete={handleRegion}
      showsUserLocation={false}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
    >
      {me ? (
        <>
          <Circle
            center={{ latitude: me.lat, longitude: me.lon }}
            radius={zoneRadiusKm * 1000}
            strokeColor="rgba(30,136,229,0.6)"
            fillColor="rgba(30,136,229,0.08)"
            strokeWidth={1.5}
          />
          <Marker coordinate={{ latitude: me.lat, longitude: me.lon }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.me} />
          </Marker>
        </>
      ) : null}

      {markers.map((m) => {
        if (m.kind === 'individual') {
          return (
            <Marker
              key={'i:' + m.userId}
              coordinate={{ latitude: m.lat, longitude: m.lon }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => onSelect(m)}
            >
              <AvatarPin
                name={m.name}
                avatarUrl={m.avatarUrl}
                ringColor={m.hasActiveStory ? Colors.orange : colorForId(m.userId)}
                story={!!m.hasActiveStory}
                online={!!m.activeRecently}
              />
            </Marker>
          );
        }
        if (m.kind === 'association' || m.kind === 'page') {
          const verified = 'isVerified' in m && m.isVerified;
          return (
            <Marker
              key={(m.kind === 'association' ? 'a:' + m.associationId : 'p:' + m.pageId)}
              coordinate={{ latitude: m.lat, longitude: m.lon }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => onSelect(m)}
            >
              <View style={[styles.entity, m.kind === 'association' ? styles.assoc : styles.page]}>
                <Text style={styles.entityEmoji}>{m.kind === 'association' ? '🏛️' : '📣'}</Text>
                {verified ? <View style={styles.verif}><Text style={styles.verifText}>✓</Text></View> : null}
              </View>
            </Marker>
          );
        }
        // country / city cluster
        const flag = Flags[m.countryCode] ?? '🌍';
        return (
          <Marker
            key={'c:' + m.kind + ':' + m.lat.toFixed(2) + ':' + m.lon.toFixed(2)}
            coordinate={{ latitude: m.lat, longitude: m.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => onSelect(m)}
          >
            <View style={[styles.cluster, m.kind === 'country' ? styles.clusterCountry : styles.clusterCity]}>
              <Text style={styles.clusterCount}>{m.count}</Text>
              <Text style={styles.clusterFlag}>{flag}</Text>
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
});

function AvatarPin({
  name,
  avatarUrl,
  ringColor,
  story,
  online,
}: {
  name: string | null;
  avatarUrl: string | null;
  ringColor: string;
  story: boolean;
  online: boolean;
}) {
  return (
    <View style={styles.pinWrap}>
      <View style={[styles.avatarRing, { borderColor: ringColor, borderWidth: story ? 3 : 2.5 }]}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
        ) : (
          <View style={styles.avatarInitials}>
            <Text style={styles.avatarInitialsText}>{initials(name)}</Text>
          </View>
        )}
      </View>
      {online ? <View style={styles.onlineDot} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  me: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1E88E5',
    borderWidth: 3,
    borderColor: '#fff',
  },
  pinWrap: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  avatarRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F5EDE0',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitials: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitialsText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  onlineDot: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: Colors.green,
    borderWidth: 2,
    borderColor: '#fff',
  },
  entity: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  assoc: { backgroundColor: '#1565C0' },
  page: { backgroundColor: Colors.orange },
  entityEmoji: { fontSize: 20 },
  verif: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  verifText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  cluster: {
    backgroundColor: '#fff',
    borderWidth: 2.5,
    borderColor: Colors.orange,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterCountry: { width: 60, height: 60 },
  clusterCity: { width: 50, height: 50 },
  clusterCount: { color: Colors.orange, fontWeight: '900', fontSize: 14 },
  clusterFlag: { fontSize: 12 },
});
