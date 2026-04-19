import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { feedApi } from '@/services/feedApi';
import { PostCard } from '@/components/PostCard';
import { Colors, Spacing, Typography } from '@/constants/theme';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: post, isLoading } = useQuery({
    queryKey: ['post', id],
    queryFn: () => feedApi.getPost(id!),
    enabled: !!id,
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={15}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Publication</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingVertical: Spacing.md }}>
        {isLoading ? (
          <Text style={styles.loading}>Chargement…</Text>
        ) : post ? (
          <PostCard post={post} />
        ) : (
          <Text style={styles.loading}>Introuvable</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray100,
    backgroundColor: Colors.white,
  },
  back: { fontSize: 32, color: Colors.brown, width: 32 },
  title: { fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  loading: { padding: Spacing.xl, textAlign: 'center', color: Colors.gray500 },
});
