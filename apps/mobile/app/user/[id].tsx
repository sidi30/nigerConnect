import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { profileApi } from '@/services/profileApi';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Colors, Spacing, Typography } from '@/constants/theme';

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: user, isLoading } = useQuery({
    queryKey: ['user', id],
    queryFn: () => profileApi.getById(id!),
    enabled: !!id,
  });

  if (isLoading || !user) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loading}>Chargement…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: Spacing.xl }}>
        <View style={styles.header}>
          <Avatar uri={user.avatarUrl} name={user.displayName} size={96} />
          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.meta}>
            {user.city ? `${user.city}, ` : ''}
            {user.countryCode ?? ''}
          </Text>
        </View>
        {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
        <View style={{ gap: Spacing.md, marginTop: Spacing.xl }}>
          <Button label="Envoyer un message" />
          <Button label="Ajouter en ami" variant="outline" />
          <Button label="Retour" variant="ghost" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: { alignItems: 'center', marginBottom: Spacing.lg },
  name: { fontSize: Typography.sizes.xl, fontWeight: '700', color: Colors.brown, marginTop: Spacing.md },
  meta: { fontSize: Typography.sizes.sm, color: Colors.gray500, marginTop: 4 },
  bio: { fontSize: Typography.sizes.md, color: Colors.brown, lineHeight: 22, textAlign: 'center' },
  loading: { padding: Spacing.xl, textAlign: 'center', color: Colors.gray500 },
});
