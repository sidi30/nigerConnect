import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CursorPage } from '@nigerconnect/shared-types';
import { api } from '@/services/api';
import { pickAndUploadImage, UploadError } from '@/services/uploadService';
import { profileApi } from '@/services/profileApi';
import { useAuthStore } from '@/stores/authStore';
import {
  Colors,
  Gradients,
  palette,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';

interface Photo {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  sortOrder: number;
}

export default function PhotosScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [selected, setSelected] = useState<Photo | null>(null);
  const [working, setWorking] = useState<'library' | 'camera' | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );

  const photosQuery = useQuery({
    queryKey: ['profile', 'photos', user?.id],
    queryFn: async () => {
      const { data } = await api.get<CursorPage<Photo>>(`/profile/${user!.id}/photos`);
      return data;
    },
    enabled: !!user?.id,
  });

  const addMut = useMutation({
    mutationFn: async (url: string) => {
      await api.post('/profile/me/photos', { url });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['profile', 'photos', user?.id] });
      setFeedback({ kind: 'success', message: 'Photo ajoutée ✓' });
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setFeedback({
        kind: 'error',
        message: err.response?.data?.message ?? err.message ?? "Échec de l'ajout de la photo.",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (photoId: string) => {
      await api.delete(`/profile/me/photos/${photoId}`);
    },
    onSuccess: () => {
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ['profile', 'photos', user?.id] });
      setFeedback({ kind: 'success', message: 'Photo supprimée' });
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setFeedback({
        kind: 'error',
        message: err.response?.data?.message ?? err.message ?? 'Suppression impossible.',
      });
    },
  });

  const setAvatarMut = useMutation({
    mutationFn: async (url: string) => {
      return profileApi.updateMe({ avatarUrl: url } as never);
    },
    onSuccess: (updated) => {
      setUser(updated);
      setSelected(null);
      void qc.invalidateQueries();
      setFeedback({ kind: 'success', message: 'Nouvel avatar défini ✓' });
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setFeedback({
        kind: 'error',
        message: err.response?.data?.message ?? err.message ?? 'Impossible de changer l’avatar.',
      });
    },
  });

  async function handleUpload(source: 'library' | 'camera') {
    setFeedback(null);
    setWorking(source);
    try {
      const url = await pickAndUploadImage('photo', source);
      if (!url) return;
      addMut.mutate(url);
    } catch (error) {
      const message =
        error instanceof UploadError
          ? error.message
          : (error as Error).message ?? "Échec de l'envoi.";
      setFeedback({ kind: 'error', message });
    } finally {
      setWorking(null);
    }
  }

  async function handleSetAsAvatarFromCameraOrLibrary(source: 'library' | 'camera') {
    setFeedback(null);
    setWorking(source);
    try {
      const url = await pickAndUploadImage('avatar', source);
      if (!url) return;
      setAvatarMut.mutate(url);
    } catch (error) {
      const message =
        error instanceof UploadError
          ? error.message
          : (error as Error).message ?? "Échec de l'envoi.";
      setFeedback({ kind: 'error', message });
    } finally {
      setWorking(null);
    }
  }

  const photos = photosQuery.data?.items ?? [];
  const isBusy = working !== null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.title}>Mes photos</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing.xxxl }}>
        <Text style={styles.hint}>
          Ajoute des photos à ta galerie. Tu peux en définir une comme avatar ou la retirer.
        </Text>

        <View style={styles.actionRow}>
          <Pressable
            onPress={() => handleUpload('library')}
            disabled={isBusy}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.actionIcon}>🖼️</Text>
            <Text style={styles.actionLabel}>
              {working === 'library' ? 'Envoi…' : 'Galerie'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleUpload('camera')}
            disabled={isBusy}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.actionIcon}>📸</Text>
            <Text style={styles.actionLabel}>
              {working === 'camera' ? 'Envoi…' : 'Prendre'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleSetAsAvatarFromCameraOrLibrary('library')}
            disabled={isBusy}
            style={({ pressed }) => [styles.actionPrimary, pressed && { opacity: 0.9 }]}
          >
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            <Text style={styles.actionPrimaryIcon}>✨</Text>
            <Text style={styles.actionPrimaryLabel}>Avatar direct</Text>
          </Pressable>
        </View>

        {feedback ? (
          <View
            style={[
              styles.feedbackBanner,
              feedback.kind === 'success' ? styles.feedbackSuccess : styles.feedbackError,
            ]}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            <Text style={styles.feedbackIcon}>{feedback.kind === 'success' ? '✅' : '⚠️'}</Text>
            <Text
              style={[
                styles.feedbackText,
                feedback.kind === 'success'
                  ? { color: palette.successText }
                  : { color: palette.errorText },
              ]}
            >
              {feedback.message}
            </Text>
          </View>
        ) : null}

        {photosQuery.isLoading ? (
          <ActivityIndicator color={Colors.orange} style={{ marginTop: Spacing.xl }} />
        ) : photos.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📷</Text>
            <Text style={styles.emptyTitle}>Aucune photo</Text>
            <Text style={styles.emptyText}>
              Ajoute ta première photo depuis la galerie ou prends-la en direct.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {photos.map((p) => {
              const isCurrentAvatar = user?.avatarUrl === p.url;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setSelected(p)}
                  style={[styles.tileWrap, isCurrentAvatar && styles.tileWrapActive]}
                >
                  <Image
                    source={{ uri: p.thumbnailUrl ?? p.url }}
                    style={styles.tile}
                    contentFit="cover"
                  />
                  {isCurrentAvatar ? (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>Avatar</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      {selected ? (
        <View style={styles.sheetBackdrop} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSelected(null)}
            accessibilityRole="button"
            accessibilityLabel="Fermer"
          />
          <View style={styles.sheet}>
            <Image source={{ uri: selected.url }} style={styles.sheetImage} contentFit="cover" />
            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => setAvatarMut.mutate(selected.url)}
                disabled={setAvatarMut.isPending || user?.avatarUrl === selected.url}
                style={({ pressed }) => [
                  styles.sheetBtn,
                  styles.sheetPrimary,
                  (pressed || setAvatarMut.isPending) && { opacity: 0.85 },
                  user?.avatarUrl === selected.url && { opacity: 0.5 },
                ]}
              >
                <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                <Text style={styles.sheetPrimaryLabel}>
                  {user?.avatarUrl === selected.url
                    ? '✓ Avatar actuel'
                    : '✨ Définir comme avatar'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => deleteMut.mutate(selected.id)}
                disabled={deleteMut.isPending}
                style={({ pressed }) => [
                  styles.sheetBtn,
                  styles.sheetDanger,
                  (pressed || deleteMut.isPending) && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.sheetDangerLabel}>
                  {deleteMut.isPending ? 'Suppression…' : '🗑️  Supprimer'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setSelected(null)}
                style={({ pressed }) => [styles.sheetBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.sheetCancel}>Annuler</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 22, color: Colors.brown },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: Typography.sizes.md + 1,
    fontWeight: '700',
    color: Colors.brown,
  },
  hint: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  actionRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  action: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    alignItems: 'center',
    gap: 4,
  },
  actionIcon: { fontSize: 22 },
  actionLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '600', color: Colors.brown },
  actionPrimary: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    gap: 4,
  },
  actionPrimaryIcon: { fontSize: 22 },
  actionPrimaryLabel: { color: Colors.white, fontSize: Typography.sizes.xs + 1, fontWeight: '700' },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  feedbackSuccess: { backgroundColor: palette.successBg, borderColor: palette.successBorder },
  feedbackError: { backgroundColor: palette.errorBg, borderColor: palette.errorBorder },
  feedbackIcon: { fontSize: 16, lineHeight: 20 },
  feedbackText: { flex: 1, fontSize: Typography.sizes.sm, fontWeight: '500', lineHeight: 20 },
  empty: {
    alignItems: 'center',
    padding: Spacing.xxl,
    marginTop: Spacing.md,
  },
  emptyIcon: { fontSize: 48, marginBottom: Spacing.sm },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 20,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tileWrap: {
    width: '32.2%',
    aspectRatio: 1,
    borderRadius: Radii.md,
    overflow: 'hidden',
    backgroundColor: Colors.tan100,
  },
  tileWrapActive: {
    borderWidth: 2,
    borderColor: Colors.orange,
  },
  tile: { width: '100%', height: '100%' },
  activeBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: Colors.orange,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activeBadgeText: {
    color: Colors.white,
    fontSize: Typography.sizes.xxs,
    fontWeight: '800',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.overlayMedium,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  sheetImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
  },
  sheetActions: { gap: 8 },
  sheetBtn: {
    height: 50,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sheetPrimary: {},
  sheetPrimaryLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  sheetDanger: {
    backgroundColor: palette.dangerSoft,
    borderWidth: 1,
    borderColor: palette.dangerMuted,
  },
  sheetDangerLabel: { color: Colors.danger, fontSize: Typography.sizes.md, fontWeight: '700' },
  sheetCancel: { color: Colors.tan500, fontSize: Typography.sizes.md, fontWeight: '600' },
});
