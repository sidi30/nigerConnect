import { useState } from 'react';
import {
  Alert,
  Pressable,
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
import { api } from '@/services/api';
import { pickAndUploadImage } from '@/services/uploadService';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';

export default function NewStoryScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const [caption, setCaption] = useState('');
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!mediaUrl) throw new Error('Choisis une image');
      const { data } = await api.post('/stories', {
        content: caption.trim() || undefined,
        media: { mediaUrl, mediaType: 'image' },
      });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stories'] });
      router.back();
    },
    onError: (e) => {
      const err = e as { message?: string; response?: { data?: { message?: string } } };
      Alert.alert('Erreur', err.response?.data?.message ?? err.message ?? 'Impossible de publier');
    },
  });

  const [uploading, setUploading] = useState(false);
  async function pickPhoto(source: 'library' | 'camera' = 'library') {
    setUploading(true);
    try {
      const url = await pickAndUploadImage('photo', source);
      if (url) setMediaUrl(url);
    } catch (error) {
      Alert.alert('Upload impossible', (error as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Nouvelle story</Text>
        <Pressable
          onPress={() => mut.mutate()}
          disabled={!mediaUrl || mut.isPending}
          style={[styles.publish, (!mediaUrl || mut.isPending) && { opacity: 0.4 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.publishLabel}>{mut.isPending ? '…' : 'Publier'}</Text>
        </Pressable>
      </View>

      <View style={styles.canvas}>
        {mediaUrl ? (
          <>
            <Image source={{ uri: mediaUrl }} style={styles.image} contentFit="cover" />
            <View style={styles.captionWrap}>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Écris une légende…"
                placeholderTextColor="rgba(255,255,255,0.7)"
                style={styles.caption}
                maxLength={500}
              />
            </View>
            <Pressable onPress={() => setMediaUrl(null)} style={styles.removeBtn}>
              <Text style={styles.removeLabel}>✕</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => pickPhoto()} disabled={uploading} style={styles.placeholder}>
            <Text style={styles.placeholderEmoji}>📷</Text>
            <Text style={styles.placeholderText}>Touche pour choisir une image</Text>
            <Text style={styles.placeholderHint}>
              Ta story sera visible par tes amis pendant 24h
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.brown },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  cancel: { color: 'rgba(255,255,255,0.9)', fontSize: Typography.sizes.md, fontWeight: '600' },
  title: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.white },
  publish: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 8,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  publishLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  canvas: {
    flex: 1,
    margin: Spacing.lg,
    borderRadius: Radii.xxl,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  captionWrap: {
    position: 'absolute',
    bottom: Spacing.xl,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radii.md,
    padding: Spacing.md,
  },
  caption: {
    color: Colors.white,
    fontSize: Typography.sizes.md,
    fontWeight: '600',
  },
  removeBtn: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeLabel: { color: Colors.white, fontSize: 18, fontWeight: '700' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: Spacing.xl,
  },
  placeholderEmoji: { fontSize: 56 },
  placeholderText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: Typography.sizes.lg,
    fontWeight: '700',
  },
  placeholderHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: Typography.sizes.sm,
    textAlign: 'center',
  },
});
