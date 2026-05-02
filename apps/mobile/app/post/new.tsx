import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { feedApi } from '@/services/feedApi';
import { pickAndUploadImage } from '@/services/uploadService';
import { useAuthStore } from '@/stores/authStore';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';

type Visibility = 'public' | 'friends' | 'association';

const VISIBILITY_OPTIONS: Array<{ id: Visibility; icon: string; label: string; desc: string }> = [
  { id: 'public', icon: '🌍', label: 'Public', desc: 'Tout le monde peut voir' },
  { id: 'friends', icon: '👥', label: 'Amis', desc: 'Seulement mes amis' },
];

const MAX_CHARS = 5000;

export default function NewPostScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);

  const [content, setContent] = useState('');
  // Default to "public" so new posts get discovery in the feed of users who
  // are not yet friends. Users can still scope it down before publishing.
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [photos, setPhotos] = useState<Array<{ url: string }>>([]);

  const publishMut = useMutation({
    mutationFn: () =>
      feedApi.createPost({
        content: content.trim() || undefined,
        visibility,
        media: photos.map((p) => ({ mediaUrl: p.url, mediaType: 'image' })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed'] });
      router.back();
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string } } };
      Alert.alert('Erreur', err.response?.data?.message ?? 'Impossible de publier');
    },
  });

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  async function addPhoto(source: 'library' | 'camera' = 'library') {
    setUploading(true);
    setUploadProgress(0);
    try {
      const url = await pickAndUploadImage('photo', source, {
        onProgress: setUploadProgress,
      });
      if (url) setPhotos((p) => [...p, { url }]);
    } catch (error) {
      Alert.alert('Upload impossible', (error as Error).message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  const canPublish = (content.trim().length > 0 || photos.length > 0) && !publishMut.isPending;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>‹ Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Nouvelle publication</Text>
        <Pressable
          onPress={() => publishMut.mutate()}
          disabled={!canPublish}
          style={[styles.publish, !canPublish && { opacity: 0.4 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.publishLabel}>
            {publishMut.isPending ? '…' : 'Publier'}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.userRow}>
            <Avatar
              uri={me?.avatarUrl}
              name={me?.displayName ?? 'N'}
              size={44}
              borderColor={Colors.orange}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{me?.displayName ?? 'Moi'}</Text>
              <View style={styles.visibilityRow}>
                {VISIBILITY_OPTIONS.map((v) => {
                  const active = visibility === v.id;
                  return (
                    <Pressable
                      key={v.id}
                      onPress={() => setVisibility(v.id)}
                      style={[styles.visPill, active && styles.visPillActive]}
                    >
                      <Text
                        style={[styles.visLabel, active && { color: Colors.white }]}
                      >
                        {v.icon} {v.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          <TextInput
            style={styles.textarea}
            placeholder="Que veux-tu partager avec la diaspora ?"
            placeholderTextColor={Colors.tan400}
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={MAX_CHARS}
            autoFocus
          />
          <Text style={styles.counter}>
            {content.length} / {MAX_CHARS}
          </Text>

          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosRow}>
              {photos.map((p, i) => (
                <View key={i} style={styles.photoWrap}>
                  <Image source={{ uri: p.url }} style={styles.photo} contentFit="cover" />
                  <Pressable
                    onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                    style={styles.photoRemove}
                  >
                    <Text style={styles.photoRemoveLabel}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={() => addPhoto('library')}
              disabled={uploading}
              style={[styles.actionBtn, uploading && { opacity: 0.5 }]}
            >
              <Text style={styles.actionEmoji}>🖼️</Text>
              <Text style={styles.actionLabel}>
                {uploading
                  ? `Envoi… ${Math.round(uploadProgress * 100)}%`
                  : 'Galerie'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => addPhoto('camera')}
              disabled={uploading}
              style={[styles.actionBtn, uploading && { opacity: 0.5 }]}
            >
              <Text style={styles.actionEmoji}>📸</Text>
              <Text style={styles.actionLabel}>Caméra</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { opacity: 0.4 }]}>
              <Text style={styles.actionEmoji}>🏛️</Text>
              <Text style={styles.actionLabel}>Asso</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    borderBottomColor: Colors.tan200,
  },
  cancel: { color: Colors.brown, fontSize: Typography.sizes.md, fontWeight: '600' },
  title: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  publish: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 8,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  publishLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  userName: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  visibilityRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  visPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  visPillActive: { backgroundColor: Colors.brown, borderColor: Colors.brown },
  visLabel: { fontSize: Typography.sizes.xs, fontWeight: '700', color: Colors.tan600 },
  textarea: {
    minHeight: 120,
    fontSize: Typography.sizes.lg,
    color: Colors.brown,
    textAlignVertical: 'top',
  },
  counter: {
    textAlign: 'right',
    fontSize: Typography.sizes.xxs,
    color: Colors.tan400,
    marginBottom: Spacing.md,
  },
  photosRow: { marginVertical: Spacing.md, flexDirection: 'row' },
  photoWrap: {
    position: 'relative',
    marginRight: Spacing.sm,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
  },
  photoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveLabel: { color: Colors.white, fontSize: 12, fontWeight: '800' },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.tan200,
    marginTop: Spacing.md,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 10,
    borderRadius: Radii.md,
    backgroundColor: Colors.peach50,
  },
  actionEmoji: { fontSize: 18 },
  actionLabel: { fontSize: Typography.sizes.sm, color: Colors.tan600, fontWeight: '700' },
});
