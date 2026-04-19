import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

export default function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: Spacing.xl }}>
        <View style={styles.header}>
          <Avatar uri={user?.avatarUrl} name={user?.displayName ?? user?.firstName} size={96} />
          <Text style={styles.name}>
            {user?.displayName ?? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() ?? 'Utilisateur'}
          </Text>
          <Text style={styles.meta}>
            {user?.city ? `${user.city}, ` : ''}
            {user?.countryCode ?? ''}
          </Text>
          {user?.identityStatus === 'approved' && (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedText}>✓ Vérifié</Text>
            </View>
          )}
        </View>

        {user?.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}

        <View style={{ marginTop: Spacing.xl, gap: Spacing.md }}>
          <Button label="Modifier mon profil" variant="outline" />
          {user?.identityStatus !== 'approved' && (
            <Button label="Vérifier mon identité" variant="secondary" />
          )}
          <Button label="Se déconnecter" variant="ghost" onPress={() => void logout()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: { alignItems: 'center', marginBottom: Spacing.lg },
  name: {
    fontSize: Typography.sizes.xl,
    fontWeight: '700',
    color: Colors.brown,
    marginTop: Spacing.md,
  },
  meta: { fontSize: Typography.sizes.sm, color: Colors.gray500, marginTop: 4 },
  verifiedBadge: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radii.full,
    backgroundColor: Colors.green,
  },
  verifiedText: { color: Colors.white, fontSize: Typography.sizes.xs, fontWeight: '700' },
  bio: {
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
});
