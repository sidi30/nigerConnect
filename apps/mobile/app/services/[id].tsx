import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { servicesApi } from '@/services/servicesApi';
import { chatApi } from '@/services/chatApi';
import { useAuthStore } from '@/stores/authStore';
import {
  Colors,
  CountryNames,
  Flags,
  Gradients,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';
import { colorForId, relativeTime, SERVICE_CATEGORY_LABELS } from '@/constants/lookups';

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  open: { bg: Colors.peach50, color: Colors.orange, label: 'Ouvert' },
  in_progress: { bg: Colors.infoSoft, color: Colors.info, label: 'En cours' },
  resolved: { bg: Colors.successSoft, color: Colors.successDark, label: 'Résolu' },
  closed: { bg: Colors.tan100, color: Colors.tan500, label: 'Fermé' },
};

export default function ServiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyMsg, setReplyMsg] = useState('');

  const svcQuery = useQuery({
    queryKey: ['service', id],
    queryFn: () => servicesApi.get(id!),
    enabled: !!id,
  });

  const svc = svcQuery.data;
  const isAuthor = !!(me && svc && me.id === svc.author.id);

  const responsesQuery = useQuery({
    queryKey: ['service', id, 'responses'],
    queryFn: () => servicesApi.responses(id!),
    enabled: isAuthor,
  });

  const respondMut = useMutation({
    mutationFn: (message: string) => servicesApi.respond(id!, message),
    onSuccess: () => {
      setReplyOpen(false);
      setReplyMsg('');
      void qc.invalidateQueries({ queryKey: ['service', id] });
      Alert.alert('Réponse envoyée', 'Ta réponse a été transmise à l\u2019auteur.');
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string } } };
      Alert.alert('Erreur', err.response?.data?.message ?? 'Impossible de répondre');
    },
  });

  const resolveMut = useMutation({
    mutationFn: () => servicesApi.resolve(id!),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['service', id] }),
  });

  const openConvoMut = useMutation({
    mutationFn: (userId: string) => chatApi.createConversation([userId]),
    onSuccess: (c) => router.push(`/chat/${c.id}`),
  });

  if (svcQuery.isLoading || !svc) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.orange} style={{ marginTop: Spacing.xxl }} />
      </SafeAreaView>
    );
  }

  const status = STATUS_STYLES[svc.status]!;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={15}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Demande</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.card}>
          <Pressable
            onPress={() => router.push(`/user/${svc.author.id}`)}
            style={styles.authorRow}
            hitSlop={4}
          >
            <Avatar
              uri={svc.author.avatarUrl}
              name={svc.author.displayName ?? 'N'}
              size={52}
              borderColor={colorForId(svc.author.id)}
            />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.authorName}>{svc.author.displayName}</Text>
                {svc.author.identityStatus === 'approved' && <VerifiedBadge size={13} />}
              </View>
              <Text style={styles.authorMeta}>
                {Flags[svc.author.countryCode ?? ''] ?? '🌍'} {svc.author.city ?? ''} ·{' '}
                {relativeTime(svc.createdAt)}
              </Text>
            </View>
          </Pressable>

          <View style={styles.badgeRow}>
            <View style={styles.catBadge}>
              <Text style={styles.catBadgeLabel}>
                {SERVICE_CATEGORY_LABELS[svc.category] ?? svc.category}
              </Text>
            </View>
            {svc.urgency === 'urgent' && (
              <View style={styles.urgentBadge}>
                <Text style={styles.urgentLabel}>🔴 Urgent</Text>
              </View>
            )}
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>

          <Text style={styles.svcTitle}>{svc.title}</Text>
          {svc.description ? <Text style={styles.svcDesc}>{svc.description}</Text> : null}

          <View style={styles.infoGrid}>
            {svc.budget ? (
              <InfoTile emoji="💰" label="Budget" value={svc.budget} />
            ) : null}
            {svc.city ? (
              <InfoTile emoji="📍" label="Lieu" value={`${svc.city}${svc.countryCode ? `, ${CountryNames[svc.countryCode] ?? svc.countryCode}` : ''}`} />
            ) : null}
            <InfoTile
              emoji="💬"
              label="Réponses"
              value={`${svc.responseCount} ${svc.responseCount === 1 ? 'reçue' : 'reçues'}`}
            />
          </View>
        </View>

        {isAuthor ? (
          <View style={styles.responsesSection}>
            <Text style={styles.sectionTitle}>
              Réponses reçues ({responsesQuery.data?.length ?? 0})
            </Text>
            {responsesQuery.isLoading ? (
              <ActivityIndicator color={Colors.orange} />
            ) : (responsesQuery.data ?? []).length === 0 ? (
              <Text style={styles.emptyResponses}>Aucune réponse encore.</Text>
            ) : (
              responsesQuery.data!.map((r) => (
                <View key={r.id} style={styles.responseCard}>
                  <Avatar
                    uri={r.responder.avatarUrl}
                    name={r.responder.displayName ?? 'N'}
                    size={40}
                    borderColor={colorForId(r.responder.id)}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.responseName}>{r.responder.displayName}</Text>
                    <Text style={styles.responseMeta}>{relativeTime(r.createdAt)}</Text>
                    <Text style={styles.responseText}>{r.message}</Text>
                    <Pressable
                      onPress={() => openConvoMut.mutate(r.responder.id)}
                      style={styles.contactBtn}
                    >
                      <Text style={styles.contactLabel}>💬 Discuter</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {isAuthor ? (
          svc.status === 'open' ? (
            <Pressable
              onPress={() =>
                Alert.alert('Marquer comme résolu', 'Cette demande sera marquée comme traitée.', [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Marquer résolu', onPress: () => resolveMut.mutate() },
                ])
              }
              style={styles.resolveBtn}
            >
              <LinearGradient colors={[Colors.green, '#3DCC51']} style={StyleSheet.absoluteFill} />
              <Text style={styles.primaryLabel}>✓ Marquer comme résolu</Text>
            </Pressable>
          ) : (
            <View style={[styles.resolveBtn, { backgroundColor: Colors.tan100 }]}>
              <Text style={[styles.primaryLabel, { color: Colors.tan600 }]}>
                {status.label}
              </Text>
            </View>
          )
        ) : svc.status === 'open' ? (
          <Pressable onPress={() => setReplyOpen(true)} style={styles.respondBtn}>
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            <Text style={styles.primaryLabel}>💬 Répondre à la demande</Text>
          </Pressable>
        ) : (
          <View style={[styles.resolveBtn, { backgroundColor: Colors.tan100 }]}>
            <Text style={[styles.primaryLabel, { color: Colors.tan600 }]}>
              Demande {status.label.toLowerCase()}
            </Text>
          </View>
        )}
      </View>

      <Modal
        visible={replyOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setReplyOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReplyOpen(false)} />
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Répondre à {svc.author.displayName}</Text>
            <Text style={styles.modalHint}>
              Propose ton aide. La personne pourra ensuite démarrer une conversation avec toi.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Exemple : J'habite à Paris et j'ai un studio disponible…"
              placeholderTextColor={Colors.tan400}
              value={replyMsg}
              onChangeText={setReplyMsg}
              multiline
              maxLength={1000}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setReplyOpen(false)} style={styles.modalCancel}>
                <Text style={styles.modalCancelLabel}>Annuler</Text>
              </Pressable>
              <Pressable
                onPress={() => respondMut.mutate(replyMsg.trim())}
                disabled={!replyMsg.trim() || respondMut.isPending}
                style={[
                  styles.modalSend,
                  (!replyMsg.trim() || respondMut.isPending) && { opacity: 0.5 },
                ]}
              >
                <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                <Text style={styles.modalSendLabel}>
                  {respondMut.isPending ? '…' : 'Envoyer'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function InfoTile({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <View style={styles.infoTile}>
      <Text style={styles.infoEmoji}>{emoji}</Text>
      <View>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
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
  back: { fontSize: 26, color: Colors.brown, width: 34 },
  title: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  card: {
    margin: Spacing.lg,
    padding: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  authorName: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  authorMeta: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 2 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing.md },
  catBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.tan100,
  },
  catBadgeLabel: { fontSize: Typography.sizes.xxs, fontWeight: '700', color: Colors.tan600 },
  urgentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.warningSoft,
  },
  urgentLabel: { fontSize: Typography.sizes.xxs, fontWeight: '700', color: Colors.warningDark },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusLabel: { fontSize: Typography.sizes.xxs, fontWeight: '700' },
  svcTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: '800',
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  svcDesc: { fontSize: Typography.sizes.md, color: Colors.brownSoft, lineHeight: 22 },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: Colors.tan50,
    borderRadius: Radii.md,
  },
  infoTile: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: '45%' },
  infoEmoji: { fontSize: 20 },
  infoLabel: { fontSize: Typography.sizes.xxs, color: Colors.tan500, fontWeight: '700' },
  infoValue: { fontSize: Typography.sizes.sm, color: Colors.brown, fontWeight: '600' },
  responsesSection: {
    marginHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  sectionTitle: { fontSize: Typography.sizes.md + 1, fontWeight: '800', color: Colors.brown },
  emptyResponses: {
    textAlign: 'center',
    color: Colors.tan500,
    fontSize: Typography.sizes.sm,
    padding: Spacing.xl,
  },
  responseCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  responseName: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.brown },
  responseMeta: { fontSize: Typography.sizes.xxs, color: Colors.tan500 },
  responseText: {
    fontSize: Typography.sizes.sm,
    color: Colors.brownSoft,
    marginTop: 6,
    lineHeight: 19,
  },
  contactBtn: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
    backgroundColor: Colors.peach50,
  },
  contactLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '700', color: Colors.orange },
  footer: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.tan200,
    backgroundColor: Colors.cream,
  },
  respondBtn: {
    height: 54,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resolveBtn: {
    height: 54,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: Colors.cream,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  modalTitle: { fontSize: Typography.sizes.lg, fontWeight: '800', color: Colors.brown },
  modalHint: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    marginTop: 4,
    marginBottom: Spacing.md,
    lineHeight: 19,
  },
  modalInput: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    fontSize: Typography.sizes.md,
    minHeight: 120,
    textAlignVertical: 'top',
    backgroundColor: Colors.white,
    color: Colors.brown,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  modalCancel: {
    flex: 1,
    height: 48,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelLabel: { color: Colors.tan600, fontWeight: '600', fontSize: Typography.sizes.md },
  modalSend: {
    flex: 1,
    height: 48,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSendLabel: { color: Colors.white, fontWeight: '700', fontSize: Typography.sizes.md },
});
