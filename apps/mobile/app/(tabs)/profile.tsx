import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { AmbassadorBadge } from '@/components/ui/AmbassadorBadge';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { profileApi } from '@/services/profileApi';
import { friendsApi } from '@/services/friendsApi';
import { associationsApi } from '@/services/associationsApi';
import { notificationApi } from '@/services/notificationApi';
import { Colors, CountryNames, Flags, Radii, Spacing, Typography } from '@/constants/theme';
import type { CursorPage } from '@nigerconnect/shared-types';

interface Photo {
  id: string;
  url: string;
  thumbnailUrl: string | null;
}

const MENU_ITEMS: Array<{
  icon: keyof typeof Feather.glyphMap;
  label: string;
  href: Href;
  badgeKey?: string;
}> = [
  { icon: 'edit-2', label: 'Modifier profil', href: '/settings/edit-profile' as Href },
  { icon: 'camera', label: 'Mes photos', href: '/settings/photos' as Href },
  { icon: 'check-circle', label: 'Vérification identité', href: '/settings/identity' as Href },
  { icon: 'users', label: 'Amis & Communauté', href: '/friends' as Href },
  { icon: 'home', label: 'Mes associations', href: '/settings/associations' as Href },
  { icon: 'file-text', label: 'Pages', href: '/pages' as Href },
  { icon: 'briefcase', label: 'Mes demandes', href: '/settings/requests' as Href },
  {
    icon: 'bell',
    label: 'Notifications',
    href: '/settings/notifications' as Href,
    badgeKey: 'notifs',
  },
  { icon: 'lock', label: 'Confidentialité', href: '/settings/privacy' as Href },
  { icon: 'globe', label: 'Langue', href: '/settings/language' as Href },
  { icon: 'file-text', label: 'Conditions & confidentialité', href: '/legal' as Href },
  { icon: 'trash-2', label: 'Supprimer mon compte', href: '/settings/delete-account' as Href },
];

export default function ProfileTab() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const friendsQuery = useQuery({
    queryKey: ['friends', 'list'],
    queryFn: () => friendsApi.list(),
    enabled: !!user,
  });
  const photosQuery = useQuery({
    queryKey: ['profile', 'photos', user?.id],
    queryFn: async () => {
      const { data } = await api.get<CursorPage<Photo>>(`/profile/${user!.id}/photos`);
      return data;
    },
    enabled: !!user?.id,
  });
  const assocsQuery = useQuery({
    queryKey: ['associations', 'mine'],
    queryFn: () => associationsApi.mine(),
    enabled: !!user,
  });
  const notifQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationApi.unreadCount(),
    enabled: !!user,
    refetchInterval: 30_000,
  });
  // Referral-network info (sponsor + filleuls) lives on the full /profile/me
  // payload, which the lightweight auth-store user doesn't carry.
  const meQuery = useQuery({
    queryKey: ['profile', 'me', 'network'],
    queryFn: () => profileApi.me(),
    enabled: !!user,
    staleTime: 60_000,
  });

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <Loader />
      </SafeAreaView>
    );
  }

  const displayName =
    user.displayName ||
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
    user.email ||
    'Utilisateur';

  const verified = user.identityStatus === 'approved';
  const friendsCount = friendsQuery.data?.items.length ?? 0;
  const photos = photosQuery.data?.items ?? [];
  const photoUrls = photos.map((p) => p.url);
  const assocsCount = assocsQuery.data?.length ?? 0;
  const unreadNotifs = notifQuery.data ?? 0;
  const invitedBy = meQuery.data?.invitedBy ?? null;
  const inviteesCount = meQuery.data?.inviteesCount ?? 0;

  // Open the shared full-screen pager (same viewer used by the feed, the chat
  // lightbox and other users' profiles) so a tap enlarges the photo.
  const openViewer = (urls: string[], index: number) =>
    router.push({
      pathname: '/photos/viewer',
      params: { photos: JSON.stringify(urls), index: String(index) },
    } as never);

  function handleLogout() {
    Alert.alert('Se déconnecter', 'Voulez-vous vraiment quitter NigerConnect ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => void logout() },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xl }}>
        <View style={styles.hero}>
          <LinearGradient
            colors={[Colors.brown, Colors.brownSoft]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroTop}>
            <Pressable
              onPress={() => user.avatarUrl && openViewer([user.avatarUrl], 0)}
              disabled={!user.avatarUrl}
              hitSlop={6}
              accessibilityRole="imagebutton"
              accessibilityLabel="Voir la photo de profil en grand"
            >
              <Avatar uri={user.avatarUrl} name={displayName} size={68} border={false} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{displayName}</Text>
                {verified && <VerifiedBadge size={18} />}
                {user.isAmbassador && <AmbassadorBadge size={18} />}
              </View>
              <Text style={styles.location}>
                {user.countryCode ? Flags[user.countryCode] ?? '🌍' : '🌍'}{' '}
                {user.city ?? '—'}
                {user.countryCode
                  ? `, ${CountryNames[user.countryCode] ?? user.countryCode}`
                  : ''}
              </Text>
              {user.bio ? (
                <Text style={styles.bio} numberOfLines={2}>
                  {user.bio}
                </Text>
              ) : null}
              {invitedBy ? (
                <Pressable
                  onPress={() => router.push(`/user/${invitedBy.id}`)}
                  hitSlop={6}
                  style={styles.invitedByChip}
                  accessibilityRole="button"
                  accessibilityLabel={`Invité par ${invitedBy.displayName ?? 'un membre'}`}
                >
                  <Feather name="user-plus" size={12} color="rgba(255,255,255,0.85)" />
                  <Text style={styles.invitedByText} numberOfLines={1}>
                    Invité par {invitedBy.displayName ?? 'un membre'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.statsRow}>
            {[
              { n: friendsCount, l: 'Amis' },
              { n: photos.length, l: 'Photos' },
              { n: assocsCount, l: 'Assos' },
              { n: inviteesCount, l: 'Filleuls' },
            ].map((s) => (
              <View key={s.l} style={styles.statCol}>
                <Text style={styles.statNumber}>{s.n}</Text>
                <Text style={styles.statLabel}>{s.l}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Pressable
            style={styles.sectionHeader}
            onPress={() => router.push('/settings/photos')}
            hitSlop={8}
          >
            <View style={styles.sectionTitleRow}>
              <Feather name="camera" size={17} color={Colors.brown} />
              <Text style={styles.sectionTitle}>Mes photos</Text>
            </View>
            <Text style={styles.seeAll}>
              {photos.length > 0 ? 'Gérer' : 'Ajouter'} ›
            </Text>
          </Pressable>
          {photos.length > 0 ? (
            <View style={styles.photoGrid}>
              {photos.slice(0, 6).map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => openViewer(photoUrls, i)}
                  style={styles.photoTile}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Voir la photo en grand"
                >
                  <Image
                    source={{ uri: p.thumbnailUrl ?? p.url }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                </Pressable>
              ))}
            </View>
          ) : (
            <Pressable
              onPress={() => router.push('/settings/photos')}
              style={styles.photoEmpty}
            >
              <Feather name="camera" size={26} color={Colors.tan500} />
              <Text style={styles.photoEmptyLabel}>Ajoute ta première photo</Text>
            </Pressable>
          )}
        </View>

        {verified ? (
          <Pressable style={styles.verifiedCard} onPress={() => router.push('/settings/identity')}>
            <View style={styles.verifiedIcon}>
              <Feather name="check" size={18} color={Colors.white} />
            </View>
            <View>
              <Text style={styles.verifiedTitle}>Identité vérifiée</Text>
              <Text style={styles.verifiedSub}>Diaspora certifiée</Text>
            </View>
          </Pressable>
        ) : (
          <Pressable style={styles.verifyCard} onPress={() => router.push('/settings/identity')}>
            <View style={styles.verifyIcon}>
              <Text style={{ color: Colors.white, fontSize: 16 }}>!</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.verifyTitle}>
                {user.identityStatus === 'pending'
                  ? 'Vérification en cours'
                  : user.identityStatus === 'rejected'
                    ? 'Vérification refusée'
                    : 'Vérifier mon identité'}
              </Text>
              <Text style={styles.verifySub}>
                {user.identityStatus === 'pending'
                  ? 'Nous examinons ton dossier'
                  : 'Débloque toutes les fonctionnalités'}
              </Text>
            </View>
            <Text style={{ color: Colors.tan400, fontSize: 18 }}>›</Text>
          </Pressable>
        )}

        <View style={styles.menu}>
          {MENU_ITEMS.map((item) => (
            <Pressable
              key={item.label}
              style={styles.menuItem}
              onPress={() => router.push(item.href)}
            >
              <View style={styles.menuIcon}>
                <Feather name={item.icon} size={18} color={Colors.orange} />
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
              {item.badgeKey === 'notifs' && unreadNotifs > 0 ? (
                <View style={styles.menuBadge}>
                  <Text style={styles.menuBadgeText}>
                    {unreadNotifs > 99 ? '99+' : unreadNotifs}
                  </Text>
                </View>
              ) : null}
              <Text style={{ color: Colors.tan400, fontSize: 18 }}>›</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={handleLogout} style={styles.logout}>
          <Text style={styles.logoutLabel}>Se déconnecter</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  hero: {
    margin: Spacing.lg,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    overflow: 'hidden',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md + 4,
    marginBottom: Spacing.lg,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.white,
  },
  location: { fontSize: Typography.sizes.sm, color: 'rgba(255,255,255,0.6)', marginTop: 3 },
  bio: { fontSize: Typography.sizes.sm - 1, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  invitedByChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    maxWidth: 200,
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  invitedByText: {
    fontSize: Typography.sizes.xs,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
    flexShrink: 1,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: Radii.lg,
    padding: Spacing.md + 2,
  },
  statCol: { flex: 1, alignItems: 'center' },
  statNumber: { fontSize: Typography.sizes.lg, fontWeight: '800', color: Colors.white },
  statLabel: { fontSize: Typography.sizes.xxs, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  section: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm + 2,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionTitle: { fontSize: Typography.sizes.md + 1, fontWeight: '700', color: Colors.brown },
  seeAll: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '600' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  photoTile: {
    width: '32.5%',
    aspectRatio: 1,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
    overflow: 'hidden',
  },
  photoEmpty: {
    paddingVertical: Spacing.xl,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    alignItems: 'center',
    gap: 6,
  },
  photoEmptyLabel: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    fontWeight: '600',
  },
  verifiedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.successSoft,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md + 2,
    borderRadius: Radii.lg,
  },
  verifiedIcon: {
    width: 38,
    height: 38,
    borderRadius: Radii.md,
    backgroundColor: Colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedTitle: { color: Colors.successDark, fontSize: Typography.sizes.sm, fontWeight: '700' },
  verifiedSub: { color: '#4CAF50', fontSize: Typography.sizes.xs },
  verifyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.peach50,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md + 2,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.peach100,
  },
  verifyIcon: {
    width: 38,
    height: 38,
    borderRadius: Radii.md,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyTitle: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
  verifySub: { color: Colors.tan500, fontSize: Typography.sizes.xs, marginTop: 1 },
  menu: { paddingHorizontal: Spacing.lg, gap: 7 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md + 2,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.md + 1,
  },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: Radii.md,
    backgroundColor: Colors.peach50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  menuBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: Radii.full,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBadgeText: { color: Colors.white, fontSize: Typography.sizes.xxs, fontWeight: '800' },
  logout: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: '#E57373',
    backgroundColor: Colors.white,
    paddingVertical: Spacing.md + 2,
    alignItems: 'center',
  },
  logoutLabel: { color: Colors.danger, fontWeight: '600', fontSize: Typography.sizes.md },
});
