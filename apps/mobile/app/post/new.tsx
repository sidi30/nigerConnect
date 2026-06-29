import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { MentionInput } from '@/components/ui/MentionInput';
import { feedApi } from '@/services/feedApi';
import { associationsApi } from '@/services/associationsApi';
import { pickAndUploadImage } from '@/services/uploadService';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';

type Visibility = 'public' | 'friends' | 'association';

const VISIBILITY_OPTIONS: Array<{
  id: Visibility;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  desc: string;
}> = [
  { id: 'public', icon: 'globe', label: 'Public', desc: 'Tout le monde peut voir' },
  { id: 'friends', icon: 'users', label: 'Amis', desc: 'Seulement mes amis' },
];

const MAX_CHARS = 5000;

export default function NewPostScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);

  // When opened from an association page, these params pre-target & lock the
  // post to that association (members-only). Absent for the generic composer.
  const params = useLocalSearchParams<{ associationId?: string; associationName?: string }>();
  const lockedAssoc = params.associationId
    ? { id: params.associationId, name: params.associationName ?? 'mon association' }
    : null;

  const [content, setContent] = useState('');
  // Default to "public" so new posts get discovery in the feed of users who
  // are not yet friends. Users can still scope it down before publishing.
  const [visibility, setVisibility] = useState<Visibility>(lockedAssoc ? 'association' : 'public');
  // The association a post is scoped to when visibility==='association'. Set
  // either from the page param (locked) or via the picker below.
  const [targetAssoc, setTargetAssoc] = useState<{ id: string; name: string } | null>(lockedAssoc);
  const [photos, setPhotos] = useState<Array<{ url: string }>>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Approved memberships drive the association picker (you can only post to an
  // association you belong to — the API enforces this too).
  const mineQuery = useQuery({
    queryKey: ['associations', 'mine'],
    queryFn: () => associationsApi.mine(),
    enabled: pickerOpen,
  });
  const myAssociations = mineQuery.data ?? [];

  const publishMut = useMutation({
    mutationFn: () =>
      feedApi.createPost({
        content: content.trim() || undefined,
        visibility,
        associationId: visibility === 'association' ? targetAssoc?.id : undefined,
        media: photos.map((p) => ({ mediaUrl: p.url, mediaType: 'image' })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed'] });
      if (visibility === 'association' && targetAssoc) {
        void qc.invalidateQueries({ queryKey: ['association', targetAssoc.id, 'posts'] });
      }
      toast.success('Publication envoyée ✨');
      router.back();
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message ?? 'Impossible de publier');
    },
  });

  function selectVisibility(v: Visibility) {
    if (v === 'association') {
      if (lockedAssoc) return; // already locked to the page's association
      setPickerOpen(true);
      return;
    }
    setVisibility(v);
    setTargetAssoc(null);
  }

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

  const canPublish =
    (content.trim().length > 0 || photos.length > 0) &&
    !publishMut.isPending &&
    (visibility !== 'association' || !!targetAssoc);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.cancelBtn}>
          <Feather name="chevron-left" size={20} color={Colors.brown} />
          <Text style={styles.cancel}>Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Nouvelle publication</Text>
        <Pressable
          onPress={() => publishMut.mutate()}
          disabled={!canPublish}
          style={[styles.publish, !canPublish && { opacity: 0.4 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          {publishMut.isPending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.publishLabel}>Publier</Text>
          )}
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
              {lockedAssoc ? (
                <View style={styles.lockedBanner}>
                  <Feather name="lock" size={12} color={Colors.orange} />
                  <Text style={styles.lockedText} numberOfLines={1}>
                    Réservé aux membres de {lockedAssoc.name}
                  </Text>
                </View>
              ) : (
                <View style={styles.visibilityRow}>
                  {VISIBILITY_OPTIONS.map((v) => {
                    const active = visibility === v.id;
                    return (
                      <Pressable
                        key={v.id}
                        onPress={() => selectVisibility(v.id)}
                        style={[styles.visPill, active && styles.visPillActive]}
                      >
                        <Feather
                          name={v.icon}
                          size={13}
                          color={active ? Colors.white : Colors.tan600}
                        />
                        <Text style={[styles.visLabel, active && { color: Colors.white }]}>
                          {v.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    onPress={() => selectVisibility('association')}
                    style={[styles.visPill, visibility === 'association' && styles.visPillActive]}
                  >
                    <Feather
                      name="home"
                      size={13}
                      color={visibility === 'association' ? Colors.white : Colors.tan600}
                    />
                    <Text
                      style={[styles.visLabel, visibility === 'association' && { color: Colors.white }]}
                      numberOfLines={1}
                    >
                      {targetAssoc ? targetAssoc.name : 'Asso'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>

          <MentionInput
            style={styles.textarea}
            placeholder="Que veux-tu partager avec la diaspora ? Tape @ pour mentionner un ami"
            placeholderTextColor={Colors.tan400}
            onChangeContent={setContent}
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
                    <Feather name="x" size={14} color={Colors.white} />
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
              <Feather name="image" size={18} color={Colors.tan600} />
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
              <Feather name="camera" size={18} color={Colors.tan600} />
              <Text style={styles.actionLabel}>Caméra</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Publier dans une association</Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={Colors.brown} />
              </Pressable>
            </View>
            {mineQuery.isLoading ? (
              <ActivityIndicator size="small" color={Colors.orange} style={{ marginTop: Spacing.lg }} />
            ) : myAssociations.length === 0 ? (
              <Text style={styles.pickerHint}>
                Tu n’es membre d’aucune association. Rejoins-en une pour y publier.
              </Text>
            ) : (
              <FlatList
                data={myAssociations}
                keyExtractor={(a) => a.id}
                contentContainerStyle={{ gap: Spacing.sm, paddingVertical: Spacing.sm }}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.assoRow}
                    onPress={() => {
                      setTargetAssoc({ id: item.id, name: item.name });
                      setVisibility('association');
                      setPickerOpen(false);
                    }}
                  >
                    <View style={styles.assoLogo}>
                      {item.logoUrl ? (
                        <Image source={{ uri: item.logoUrl }} style={styles.assoLogoImg} contentFit="cover" />
                      ) : (
                        <Feather name="home" size={18} color={Colors.tan400} />
                      )}
                    </View>
                    <Text style={styles.assoName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {targetAssoc?.id === item.id ? (
                      <Feather name="check" size={18} color={Colors.green} />
                    ) : null}
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
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
  cancelBtn: { flexDirection: 'row', alignItems: 'center' },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  visPillActive: { backgroundColor: Colors.brown, borderColor: Colors.brown },
  visLabel: { fontSize: Typography.sizes.xs, fontWeight: '700', color: Colors.tan600, maxWidth: 120 },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
    backgroundColor: Colors.peach50,
    borderWidth: 1,
    borderColor: Colors.peach100,
    alignSelf: 'flex-start',
  },
  lockedText: { fontSize: Typography.sizes.xs, fontWeight: '700', color: Colors.orange, maxWidth: 220 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    padding: Spacing.lg,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  modalTitle: { fontSize: Typography.sizes.lg, fontWeight: '800', color: Colors.brown },
  pickerHint: { fontSize: Typography.sizes.sm, color: Colors.tan500, marginTop: Spacing.md },
  assoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.sm,
  },
  assoLogo: {
    width: 40,
    height: 40,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  assoLogoImg: { width: '100%', height: '100%' },
  assoName: { flex: 1, fontSize: Typography.sizes.sm + 1, fontWeight: '600', color: Colors.brown },
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
  actionLabel: { fontSize: Typography.sizes.sm, color: Colors.tan600, fontWeight: '700' },
});
