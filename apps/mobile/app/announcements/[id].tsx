import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Loader } from '@/components/ui/Loader';
import { announcementApi } from '@/services/announcementApi';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { relativeTime } from '@/constants/lookups';

/**
 * Lecture d'une annonce de l'équipe.
 *
 * La notification ne transporte qu'un aperçu de 140 caractères, lui-même
 * tronqué à deux lignes dans la liste : sans cet écran, une annonce de
 * plusieurs milliers de signes arrivait sans que personne puisse la lire.
 *
 * On rend `bodyText`, pas `bodyHtml` : le corps est écrit dans un éditeur
 * riche côté console, et afficher du HTML arbitraire dans l'app coûterait une
 * dépendance et une surface d'injection pour un gain d'affichage mince.
 */
export default function AnnouncementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['announcement', id],
    queryFn: () => announcementApi.get(id!),
    enabled: !!id,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Annonce' }} />
      {isLoading ? (
        <Loader />
      ) : isError || !data ? (
        <View style={styles.empty}>
          <Feather name="volume-2" size={32} color={Colors.tan500} />
          <Text style={styles.emptyText}>Cette annonce n'est plus disponible.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.badge}>
            <Feather name="volume-2" size={14} color={Colors.orange} />
            <Text style={styles.badgeText}>Annonce de l'équipe</Text>
          </View>
          <Text style={styles.subject}>{data.subject}</Text>
          <Text style={styles.date}>{relativeTime(data.sentAt)}</Text>
          <Text style={styles.body}>{data.bodyText}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.cream },
  content: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxxl },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
  },
  badgeText: { fontSize: Typography.sizes.xs, fontWeight: '700', color: Colors.orange },
  subject: { fontSize: Typography.sizes.xl, fontWeight: '800', color: Colors.brown },
  date: { fontSize: Typography.sizes.xs, color: Colors.tan500 },
  body: {
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    lineHeight: 24,
    marginTop: Spacing.sm,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  emptyText: { fontSize: Typography.sizes.sm, color: Colors.tan500 },
});
