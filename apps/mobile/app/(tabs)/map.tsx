import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, CountryNames, Flags, Radii, Spacing, Typography } from '@/constants/theme';
import { geoApi, type MapMarker } from '@/services/geoApi';

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
  .leaflet-marker-icon{background:none;border:none}
  .leaflet-container{background:#E8F4F8}
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const worldBounds = L.latLngBounds([[-85, -180], [85, 180]]);
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: false,
    worldCopyJump: false,
    maxBounds: worldBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 2,
  }).setView([20, 10], 3);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { subdomains:'abcd', maxZoom: 19, noWrap: true, bounds: worldBounds }).addTo(map);
  const markerLayer = L.layerGroup().addTo(map);

  function post(msg){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }

  function boundsChanged(){
    const b = map.getBounds();
    post({ type:'bounds', north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest(), zoom: map.getZoom() });
  }

  map.on('moveend zoomend', boundsChanged);
  setTimeout(boundsChanged, 300);

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
          if (m.kind === 'country') map.setView([m.lat, m.lon], 5);
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

  const markersQuery = useQuery({
    queryKey: ['geo', 'members', bounds, filter],
    queryFn: () => geoApi.members({ ...bounds, type: filter }),
  });
  const statsQuery = useQuery({ queryKey: ['geo', 'stats'], queryFn: () => geoApi.stats() });

  useEffect(() => {
    if (webReady && markersQuery.data && webRef.current) {
      const q = search.trim().toLowerCase();
      const filtered = q
        ? markersQuery.data.filter((m) => {
            if (m.kind === 'individual') return (m.name ?? '').toLowerCase().includes(q);
            if (m.kind === 'association') return m.name.toLowerCase().includes(q);
            // Hide aggregate clusters (country/city) while searching by name
            return false;
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
      </View>

      {markersQuery.isLoading && (
        <View style={styles.loader}>
          <ActivityIndicator color={Colors.orange} />
        </View>
      )}

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
        />
      )}
    </SafeAreaView>
  );
}

function SelectedSheet({
  marker,
  onClose,
  onOpenProfile,
}: {
  marker: MapMarker;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  if (marker.kind === 'individual') {
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
      </View>
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
      </View>
    );
  }

  const title =
    marker.kind === 'country'
      ? CountryNames[marker.countryCode] ?? marker.countryCode
      : marker.city;
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetTop}>
        <View style={styles.sheetIcon}>
          <Text style={{ fontSize: 22 }}>{Flags[marker.countryCode] ?? '🌍'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetName}>{title}</Text>
          <Text style={styles.sheetMeta}>{marker.count} membres</Text>
        </View>
        <Pressable onPress={onClose} style={styles.sheetClose}>
          <Text style={{ fontSize: 16, color: Colors.tan500 }}>✕</Text>
        </Pressable>
      </View>
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
  loader: {
    position: 'absolute',
    top: 130,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 10,
    borderRadius: Radii.full,
  },
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
});
