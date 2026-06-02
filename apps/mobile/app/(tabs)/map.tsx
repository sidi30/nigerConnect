import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, CountryNames, Flags, Radii, Spacing, Typography } from '@/constants/theme';
import { friendsApi } from '@/services/friendsApi';
import { geoApi, type MapMarker } from '@/services/geoApi';
import { profileApi } from '@/services/profileApi';
import { useAuthStore } from '@/stores/authStore';

type Filter = 'all' | 'people' | 'associations';

const FILTERS: Array<{ id: Filter; label: string; icon: string }> = [
  { id: 'all', label: 'Tous', icon: '🌍' },
  { id: 'people', label: 'Personnes', icon: '👤' },
  { id: 'associations', label: 'Assos', icon: '🏛️' },
];

const INITIAL_BOUNDS = {
  north: 70,
  south: -35,
  east: 60,
  west: -80,
  zoom: 3,
};

// Local-zone defaults: on first load we geolocate the user, draw a ~50km zone
// circle around them and zoom to it so the map opens on "people near me" rather
// than the whole world. ZONE_ZOOM lands between city-cluster (≥9) and the
// individual-marker threshold so nearby people render as avatars right away.
const ZONE_RADIUS_KM = 50;
const ZONE_ZOOM = 11;

const LEAFLET_HTML = `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#E8F4F8;font-family:system-ui}
  .marker-cluster{display:flex;align-items:center;justify-content:center;background:#fff;border:2.5px solid #E05206;border-radius:50%;box-shadow:0 3px 10px rgba(224,82,6,.4);font-weight:900;color:#E05206}
  .marker-cluster.country{width:60px;height:60px;flex-direction:column;font-size:14px}
  .marker-cluster.city{width:50px;height:50px;flex-direction:column;font-size:12px}
  .marker-cluster .flag{font-size:12px;margin-top:1px}
  .marker-ind{width:48px;height:48px;border-radius:50%;border:3px solid #E05206;background-size:cover;background-position:center;box-shadow:0 2px 8px rgba(0,0,0,.35)}
  .marker-assoc{display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:14px;background:#1565C0;border:3px solid #fff;box-shadow:0 3px 10px rgba(21,101,192,.5);font-size:22px;position:relative}
  .marker-assoc .verif{position:absolute;bottom:-3px;right:-3px;width:16px;height:16px;border-radius:50%;background:#0DB02B;color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;border:2px solid #fff}
  .marker-me{width:22px;height:22px;border-radius:50%;background:#1E88E5;border:3px solid #fff;box-shadow:0 0 0 4px rgba(30,136,229,.3),0 2px 6px rgba(0,0,0,.4)}
  .leaflet-marker-icon{background:none;border:none}
  .leaflet-container{background:#E8F4F8}
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const worldBounds = L.latLngBounds([[-85, -180], [85, 180]]);
  const map = L.map('map', {
    // Default zoomControl is top-left, which collides with our filters bar.
    // We add it explicitly bottom-right so the top remains clean.
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: false,
    maxBounds: worldBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 2,
  }).setView([20, 10], 3);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { subdomains:'abcd', maxZoom: 19, noWrap: true, bounds: worldBounds }).addTo(map);
  const markerLayer = L.layerGroup().addTo(map);

  function post(msg){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }

  function boundsChanged(){
    const b = map.getBounds();
    post({ type:'bounds', north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest(), zoom: map.getZoom() });
  }

  map.on('moveend zoomend', boundsChanged);
  setTimeout(boundsChanged, 300);

  window.flyTo = function(lat, lon, zoom){
    map.flyTo([lat, lon], zoom || 9, { duration: 0.8 });
  };

  // "You are here" marker + the local zone circle (radius in km). Drawn in a
  // dedicated layer so re-locating just replaces it without touching members.
  var meLayer = L.layerGroup().addTo(map);
  var meLat = null, meLon = null;
  window.drawMe = function(lat, lon, radiusKm){
    meLat = lat; meLon = lon;
    meLayer.clearLayers();
    L.circle([lat, lon], {
      radius: (radiusKm || 50) * 1000,
      color: '#1E88E5', weight: 1.5, fillColor: '#1E88E5', fillOpacity: 0.08,
    }).addTo(meLayer);
    var icon = L.divIcon({ html: '<div class="marker-me"></div>', className: '', iconSize: [22,22], iconAnchor: [11,11] });
    L.marker([lat, lon], { icon: icon, zIndexOffset: 1000 }).addTo(meLayer);
  };
  window.recenterMe = function(zoom){
    if (meLat !== null) map.flyTo([meLat, meLon], zoom || 11, { duration: 0.8 });
  };

  window.renderMarkers = function(markers){
    markerLayer.clearLayers();
    for (const m of markers) {
      if (m.kind === 'individual') {
        const html = '<div class="marker-ind" style="background-image:url(\\'' + (m.avatarUrl || '') + '\\')"></div>';
        const icon = L.divIcon({ html: html, className: '', iconSize: [48, 48], iconAnchor: [24, 24] });
        const mk = L.marker([m.lat, m.lon], { icon });
        mk.on('click', () => post({ type:'select', marker: m }));
        mk.addTo(markerLayer);
      } else if (m.kind === 'association') {
        const verif = m.isVerified ? '<div class="verif">✓</div>' : '';
        const html = '<div class="marker-assoc">🏛️' + verif + '</div>';
        const icon = L.divIcon({ html: html, className: '', iconSize: [52, 52], iconAnchor: [26, 26] });
        const mk = L.marker([m.lat, m.lon], { icon });
        mk.on('click', () => post({ type:'select', marker: m }));
        mk.addTo(markerLayer);
      } else {
        const cls = 'marker-cluster ' + m.kind;
        const flag = m.flag || '';
        const html = '<div class="' + cls + '"><div>' + m.count + '</div><div class="flag">' + flag + '</div></div>';
        const size = m.kind==='country'?60:50;
        const icon = L.divIcon({ html: html, className: '', iconSize: [size,size], iconAnchor: [size/2,size/2] });
        const mk = L.marker([m.lat, m.lon], { icon });
        mk.on('click', () => {
          // Country clusters jump straight to the individual-marker threshold
          // (zoom 9) so members become tappable avatars; city goes one closer.
          if (m.kind === 'country') map.setView([m.lat, m.lon], 9);
          else if (m.kind === 'city') map.setView([m.lat, m.lon], 10);
          post({ type:'select', marker: m });
        });
        mk.addTo(markerLayer);
      }
    }
  };

  post({ type:'ready' });
</script>
</body></html>`;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function MapTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const [bounds, setBounds] = useState(INITIAL_BOUNDS);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<MapMarker | null>(null);
  const [webReady, setWebReady] = useState(false);
  const [myLocation, setMyLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const located = useRef(false);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  // Ask permission, get a fix, draw the "you are here" marker + zone circle and
  // fly to it. Returns silently on denial/failure so the map just stays on the
  // world view — geolocation is best-effort, never blocking.
  const locateAndDraw = useRef<() => Promise<void>>(async () => {});
  locateAndDraw.current = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      setMyLocation({ lat, lon });
      webRef.current?.injectJavaScript(
        `window.drawMe(${lat}, ${lon}, ${ZONE_RADIUS_KM}); window.flyTo(${lat}, ${lon}, ${ZONE_ZOOM}); true;`,
      );
      // Persist the fresh GPS position so this user shows up on other people's
      // maps at their real spot — but only if they've opted into map visibility.
      // Skipped silently when showOnMap is off (privacy) or the coords barely
      // moved (avoid spamming the API on every recenter).
      void persistMyPosition(lat, lon);
    } catch {
      /* location unavailable — fall back to world view */
    } finally {
      setLocating(false);
    }
  };

  async function persistMyPosition(lat: number, lon: number) {
    if (!user || user.showOnMap === false) return;
    // ~100m threshold: skip the write if we're essentially where the server
    // already has us (0.001° ≈ 111m).
    const moved =
      user.latitude == null ||
      user.longitude == null ||
      Math.abs(user.latitude - lat) > 0.001 ||
      Math.abs(user.longitude - lon) > 0.001;
    if (!moved) return;
    try {
      const updated = await profileApi.updateMe({ latitude: lat, longitude: lon });
      setUser(updated);
    } catch {
      /* non-blocking — position will sync on a later open */
    }
  }

  // On first WebView ready, auto-locate so the map opens on "people near me".
  useEffect(() => {
    if (!webReady || located.current) return;
    located.current = true;
    void locateAndDraw.current();
  }, [webReady]);

  // FAB: recenter on the existing fix, or (re)try locating if we have none yet.
  function recenterOnMe() {
    if (myLocation) {
      webRef.current?.injectJavaScript(`window.recenterMe(${ZONE_ZOOM}); true;`);
    } else {
      void locateAndDraw.current();
    }
  }

  // Global name search via the API — runs only when the search bar is open
  // AND the user typed at least 2 characters. Hits /profile/search regardless
  // of the current map zoom, so people in clustered countries (e.g. Raya in
  // Saudi Arabia) are findable even from the world view.
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const globalSearch = useQuery({
    queryKey: ['profile', 'search', 'map', debouncedSearch],
    queryFn: () => profileApi.search({ q: debouncedSearch, limit: 10 }),
    enabled: searchOpen && debouncedSearch.length >= 2,
  });

  const markersQuery = useQuery({
    queryKey: ['geo', 'members', bounds, filter],
    queryFn: () => geoApi.members({ ...bounds, type: filter }),
  });
  const statsQuery = useQuery({ queryKey: ['geo', 'stats'], queryFn: () => geoApi.stats() });

  useEffect(() => {
    if (webReady && markersQuery.data && webRef.current) {
      const q = search.trim().toLowerCase();
      const matches = (
        ...fields: Array<string | null | undefined>
      ): boolean => fields.some((f) => f && f.toLowerCase().includes(q));
      const filtered = q
        ? markersQuery.data.filter((m) => {
            if (m.kind === 'individual') {
              const country = m.countryCode ? CountryNames[m.countryCode] : null;
              return matches(m.name, m.city, m.countryCode, country);
            }
            if (m.kind === 'association') {
              const country = m.countryCode ? CountryNames[m.countryCode] : null;
              return matches(m.name, m.city, m.countryCode, country);
            }
            // For country / city clusters, match the cluster's own label.
            const country = m.countryCode ? CountryNames[m.countryCode] : null;
            return matches(
              m.kind === 'city' ? m.city : null,
              m.countryCode,
              country,
            );
          })
        : markersQuery.data;
      const payload = filtered.map((m) =>
        m.kind === 'country' || m.kind === 'city'
          ? { ...m, flag: Flags[m.countryCode] ?? '🌍' }
          : m,
      );
      webRef.current.injectJavaScript(
        `window.renderMarkers(${JSON.stringify(payload)}); true;`,
      );
    }
  }, [webReady, markersQuery.data, search]);

  function onMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') setWebReady(true);
      else if (msg.type === 'bounds') {
        setBounds({
          north: msg.north,
          south: msg.south,
          east: msg.east,
          west: msg.west,
          zoom: Math.round(msg.zoom),
        });
      } else if (msg.type === 'select') setSelected(msg.marker);
    } catch {
      /* ignore */
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html: LEAFLET_HTML }}
        onMessage={onMessage}
        style={StyleSheet.absoluteFill}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
      />

      <View style={[styles.topBar, { top: insets.top + Spacing.md }]}>
        <View style={styles.filtersRow}>
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <Pressable
                key={f.id}
                onPress={() => setFilter(f.id)}
                style={[styles.filterPill, active && styles.filterPillActive]}
              >
                <Text style={[styles.filterLabel, active && { color: Colors.white }]}>
                  {f.icon} {f.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setSearchOpen((v) => !v)}
            style={[styles.searchPill, searchOpen && styles.filterPillActive]}
            hitSlop={6}
          >
            <Text style={[styles.filterLabel, searchOpen && { color: Colors.white }]}>🔍</Text>
          </Pressable>
        </View>
        {searchOpen && (
          <View style={styles.searchWrap}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Rechercher par nom…"
              placeholderTextColor={Colors.tan400}
              style={styles.searchInput}
              autoFocus
              returnKeyType="search"
            />
            {search.length > 0 && (
              <Pressable
                onPress={() => setSearch('')}
                hitSlop={10}
                style={styles.searchClose}
              >
                <Text style={{ fontSize: 16, color: Colors.tan500 }}>✕</Text>
              </Pressable>
            )}
          </View>
        )}
        {searchOpen && debouncedSearch.length >= 2 && (
          <View style={styles.resultsCard}>
            {globalSearch.isLoading ? (
              <View style={styles.resultsLoading}>
                <ActivityIndicator color={Colors.orange} />
              </View>
            ) : (globalSearch.data?.items.length ?? 0) === 0 ? (
              <View style={styles.resultsLoading}>
                <Text style={styles.resultsEmpty}>Aucun résultat global</Text>
              </View>
            ) : (
              <FlatList
                data={globalSearch.data?.items ?? []}
                keyExtractor={(u) => u.id}
                style={{ maxHeight: 280 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const name =
                    item.displayName ??
                    `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim() ??
                    'Anonyme';
                  return (
                    <Pressable
                      onPress={() => {
                        setSearch('');
                        setSearchOpen(false);
                        router.push(`/user/${item.id}`);
                      }}
                      style={styles.resultRow}
                      android_ripple={{ color: Colors.tan100 }}
                    >
                      <Avatar
                        uri={item.avatarUrl}
                        name={name}
                        size={36}
                        borderColor={Colors.orange}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.resultName} numberOfLines={1}>
                          {name}
                        </Text>
                        <Text style={styles.resultMeta} numberOfLines={1}>
                          {Flags[item.countryCode ?? ''] ?? '🌍'}{' '}
                          {[item.city, item.countryCode].filter(Boolean).join(', ')}
                        </Text>
                      </View>
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        )}
      </View>

      {markersQuery.isLoading && (
        <View style={styles.loader}>
          <ActivityIndicator color={Colors.orange} />
        </View>
      )}

      <Pressable
        onPress={recenterOnMe}
        style={[styles.recenterFab, { bottom: insets.bottom + 150 }]}
        hitSlop={8}
      >
        {locating ? (
          <ActivityIndicator color={Colors.orange} size="small" />
        ) : (
          <Text style={styles.recenterIcon}>{myLocation ? '📍' : '🧭'}</Text>
        )}
      </Pressable>

      {statsQuery.data && (
        <View style={styles.statsBadge}>
          <Text style={styles.statsText}>
            🌍 {statsQuery.data.totalMembers} membres · {statsQuery.data.countryCounts.length} pays
          </Text>
        </View>
      )}

      {selected && (
        <SelectedSheet
          marker={selected}
          onClose={() => setSelected(null)}
          onOpenProfile={(id) => {
            setSelected(null);
            router.push(`/user/${id}`);
          }}
          onOpenAssociation={(id) => {
            setSelected(null);
            // associations/[id].tsx is being added in parallel; cast until the
            // typed route exists.
            router.push(`/associations/${id}` as never);
          }}
          onZoomToCluster={(lat, lon, zoom) => {
            setSelected(null);
            webRef.current?.injectJavaScript(
              `window.flyTo(${lat}, ${lon}, ${zoom}); true;`,
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function SelectedSheet({
  marker,
  onClose,
  onOpenProfile,
  onOpenAssociation,
  onZoomToCluster,
}: {
  marker: MapMarker;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenAssociation: (associationId: string) => void;
  onZoomToCluster: (lat: number, lon: number, zoom: number) => void;
}) {
  // SelectedSheet branches by marker.kind with early returns, so any hooks must
  // live in a child rendered only for the individual case. Otherwise the hook
  // order would change between an individual and a cluster selection.
  if (marker.kind === 'individual') {
    return (
      <IndividualSheet marker={marker} onClose={onClose} onOpenProfile={onOpenProfile} />
    );
  }

  if (marker.kind === 'association') {
    return (
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetTop}>
          <View style={[styles.sheetIcon, { backgroundColor: Colors.info }]}>
            <Text style={{ fontSize: 22 }}>🏛️</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetName}>
              {marker.name}
              {marker.isVerified ? ' ✓' : ''}
            </Text>
            <Text style={styles.sheetMeta}>
              {Flags[marker.countryCode ?? ''] ?? '🌍'} {marker.city ?? ''}
              {marker.countryCode ? `, ${CountryNames[marker.countryCode] ?? marker.countryCode}` : ''}
            </Text>
            <Text style={styles.sheetMeta}>
              👥 {marker.memberCount} {marker.memberCount > 1 ? 'membres' : 'membre'}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.sheetClose}>
            <Text style={{ fontSize: 16, color: Colors.tan500 }}>✕</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => onOpenAssociation(marker.associationId)}
          style={styles.sheetBtn}
        >
          <Text style={styles.sheetBtnLabel}>Voir l&apos;association</Text>
        </Pressable>
      </View>
    );
  }

  const title =
    marker.kind === 'country'
      ? CountryNames[marker.countryCode] ?? marker.countryCode
      : marker.city;
  // Country clusters zoom to the individual-marker threshold (9); city goes one
  // closer (10) so members surface as tappable avatars.
  const zoom = marker.kind === 'country' ? 9 : 10;
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetTop}>
        <View style={styles.sheetIcon}>
          <Text style={{ fontSize: 22 }}>{Flags[marker.countryCode] ?? '🌍'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetName}>{title}</Text>
          <Text style={styles.sheetMeta}>
            {marker.count} {marker.count > 1 ? 'membres' : 'membre'}
          </Text>
        </View>
        <Pressable onPress={onClose} style={styles.sheetClose}>
          <Text style={{ fontSize: 16, color: Colors.tan500 }}>✕</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => onZoomToCluster(marker.lat, marker.lon, zoom)}
        style={styles.sheetBtn}
      >
        <Text style={styles.sheetBtnLabel}>Voir les membres</Text>
      </Pressable>
    </View>
  );
}

function IndividualSheet({
  marker,
  onClose,
  onOpenProfile,
}: {
  marker: Extract<MapMarker, { kind: 'individual' }>;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  const qc = useQueryClient();
  const relationshipQuery = useQuery({
    queryKey: ['user', marker.userId, 'relationship'],
    queryFn: () => friendsApi.relationship(marker.userId),
  });
  const sendRequestMut = useMutation({
    mutationFn: () => friendsApi.sendRequest(marker.userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user', marker.userId, 'relationship'] });
      void qc.invalidateQueries({ queryKey: ['friends'] });
    },
  });

  const rel = relationshipQuery.data?.status ?? 'none';
  // self / blocked: no friend action. incoming routes to the profile where the
  // request can be accepted with its friendshipId.
  const showFriendBtn = rel !== 'self' && rel !== 'blocked';
  const friendLabel =
    rel === 'friends'
      ? '✓ Amis'
      : rel === 'outgoing'
        ? '⌛ Demande envoyée'
        : rel === 'incoming'
          ? '📩 Accepter la demande'
          : '👤 Ajouter en ami';
  const friendDisabled =
    rel === 'friends' || rel === 'outgoing' || sendRequestMut.isPending;

  function onFriendPress() {
    if (rel === 'none') sendRequestMut.mutate();
    else if (rel === 'incoming') onOpenProfile(marker.userId);
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetTop}>
        <Avatar
          uri={marker.avatarUrl}
          name={marker.name ?? '?'}
          size={56}
          borderColor={Colors.orange}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetName}>{marker.name}</Text>
          <Text style={styles.sheetMeta}>
            {Flags[marker.countryCode ?? ''] ?? '🌍'} {marker.city ?? ''}
            {marker.countryCode ? `, ${CountryNames[marker.countryCode] ?? marker.countryCode}` : ''}
          </Text>
        </View>
        <Pressable onPress={onClose} style={styles.sheetClose}>
          <Text style={{ fontSize: 16, color: Colors.tan500 }}>✕</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => onOpenProfile(marker.userId)} style={styles.sheetBtn}>
        <Text style={styles.sheetBtnLabel}>Voir le profil</Text>
      </Pressable>
      {showFriendBtn ? (
        <Pressable
          onPress={onFriendPress}
          disabled={friendDisabled}
          style={[styles.sheetBtnSecondary, friendDisabled && { opacity: 0.6 }]}
        >
          <Text style={styles.sheetBtnSecondaryLabel}>{friendLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  topBar: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    gap: Spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  searchIcon: { fontSize: 15 },
  searchInput: { flex: 1, fontSize: Typography.sizes.sm, color: Colors.brown, padding: 0 },
  filtersRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  filterPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radii.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  filterPillActive: { backgroundColor: Colors.brown },
  filterLabel: { fontSize: Typography.sizes.xs, fontWeight: '700', color: Colors.tan600 },
  searchPill: {
    width: 36,
    height: 32,
    borderRadius: Radii.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  searchClose: {
    width: 28,
    height: 28,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsCard: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  resultsLoading: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  resultsEmpty: { fontSize: Typography.sizes.sm, color: Colors.tan500 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan100,
  },
  resultName: { fontSize: Typography.sizes.sm, fontWeight: '700', color: Colors.brown },
  resultMeta: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 2 },
  loader: {
    position: 'absolute',
    top: 130,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 10,
    borderRadius: Radii.full,
  },
  recenterFab: {
    position: 'absolute',
    right: Spacing.md,
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 5,
  },
  recenterIcon: { fontSize: 22 },
  statsBadge: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: 'rgba(26,15,10,0.85)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radii.full,
  },
  statsText: { color: Colors.white, fontSize: Typography.sizes.xs + 1, fontWeight: '700' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.tan300,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  sheetTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md + 2 },
  sheetIcon: {
    width: 56,
    height: 56,
    borderRadius: Radii.lg,
    backgroundColor: Colors.peach50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetName: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  sheetMeta: { fontSize: Typography.sizes.sm, color: Colors.tan500, marginTop: 2 },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBtn: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.orange,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md + 2,
    alignItems: 'center',
  },
  sheetBtnLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  sheetBtnSecondary: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.orange,
    paddingVertical: Spacing.md + 2,
    alignItems: 'center',
  },
  sheetBtnSecondaryLabel: {
    color: Colors.orange,
    fontSize: Typography.sizes.md,
    fontWeight: '700',
  },
});
