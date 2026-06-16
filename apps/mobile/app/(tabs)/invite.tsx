import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors, Radii, Spacing, Typography, palette } from '@/constants/theme';
import { invitationsApi, type InvitationItem } from '@/services/invitationsApi';
import { relativeTime } from '@/constants/lookups';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

const STATUS_LABELS: Record<InvitationItem['status'], string> = {
  pending: 'En attente',
  accepted: 'Acceptée',
  revoked: 'Révoquée',
  expired: 'Expirée',
};

const STATUS_COLORS: Record<InvitationItem['status'], string> = {
  pending: Colors.orange,
  accepted: Colors.green,
  revoked: Colors.tan500,
  expired: Colors.tan400,
};

/** Basic RFC-5322-inspired email check — same heuristic as the server Zod schema. */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function InviteScreen() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // ── Email form state ────────────────────────────────────────────────────────
  const [emailValue, setEmailValue] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const emailInputRef = useRef<TextInput>(null);

  // ── Link state ──────────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['invitations', 'list'],
    queryFn: () => invitationsApi.list(),
    enabled: !!user,
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => invitationsApi.revoke(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invitations', 'list'] });
    },
    onError: (e: unknown) => {
      const apiMsg = (e as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      Alert.alert('Erreur', apiMsg ?? 'Impossible de révoquer cette invitation.');
    },
  });

  // ── Guard shared by all actions ─────────────────────────────────────────────
  function checkEmailVerified(): boolean {
    if (!user?.emailVerified) {
      Alert.alert(
        'Email non vérifié',
        'Tu dois vérifier ton adresse email avant de pouvoir inviter des amis.',
      );
      return false;
    }
    return true;
  }

  // ── Email invite ────────────────────────────────────────────────────────────
  function validateEmail(value: string): string | null {
    if (!value.trim()) return 'Adresse email requise.';
    if (!isValidEmail(value)) return 'Adresse email invalide.';
    return null;
  }

  async function handleEmailInvite() {
    setEmailTouched(true);
    const err = validateEmail(emailValue);
    setEmailError(err);
    if (err) {
      emailInputRef.current?.focus();
      return;
    }
    if (!checkEmailVerified()) return;

    const trimmed = emailValue.trim().toLowerCase();
    setEmailSending(true);
    try {
      await invitationsApi.create({ email: trimmed });
      void qc.invalidateQueries({ queryKey: ['invitations', 'list'] });
      toast.success(`Invitation envoyée à ${trimmed}`);
      setEmailValue('');
      setEmailTouched(false);
      setEmailError(null);
    } catch (e: unknown) {
      const apiMsg = (e as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      toast.error(apiMsg ?? 'Impossible d\'envoyer l\'invitation. Réessaie.');
    } finally {
      setEmailSending(false);
    }
  }

  // ── Single-use link invite (one code, one signup) ────────────────────────────
  async function handleGenerate() {
    if (!checkEmailVerified()) return;
    setGenError(null);
    setGenerating(true);
    try {
      const inv = await invitationsApi.create();
      void qc.invalidateQueries({ queryKey: ['invitations', 'list'] });
      await Share.share({
        message: `Rejoins-moi sur NigerConnect, le réseau de la diaspora nigérienne ! Utilise mon lien d'invitation : ${inv.url}`,
        url: inv.url,
      });
    } catch (e: unknown) {
      const apiMsg = (e as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      // Share.share rejects when the user dismisses the sheet — don't show an error.
      if ((e as { message?: string })?.message !== 'The operation was canceled.') {
        setGenError(apiMsg ?? 'Impossible de générer un lien. Réessaie.');
      }
    } finally {
      setGenerating(false);
    }
  }

  // ── Reusable mass link (one link, N signups) — gated on `canBulkInvite` ──────
  async function handleGenerateBulk() {
    if (!checkEmailVerified()) return;
    setBulkError(null);
    setBulkGenerating(true);
    try {
      const inv = await invitationsApi.create({ kind: 'reusable' });
      void qc.invalidateQueries({ queryKey: ['invitations', 'list'] });
      await Share.share({
        message: `Rejoins la communauté NigerConnect, le réseau de la diaspora nigérienne ! Inscris-toi avec mon lien : ${inv.url}`,
        url: inv.url,
      });
    } catch (e: unknown) {
      const apiMsg = (e as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      if ((e as { message?: string })?.message !== 'The operation was canceled.') {
        setBulkError(apiMsg ?? 'Impossible de générer un lien de masse. Réessaie.');
      }
    } finally {
      setBulkGenerating(false);
    }
  }

  function confirmRevoke(id: string) {
    Alert.alert(
      'Révoquer cette invitation ?',
      'Le lien ne fonctionnera plus pour les nouvelles inscriptions.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Révoquer',
          style: 'destructive',
          onPress: () => revokeMut.mutate(id),
        },
      ],
    );
  }

  const canBulkInvite = data?.canBulkInvite ?? false;
  const invites = data?.invites ?? [];
  const actionsDisabled = !user?.emailVerified;

  // Inline email validation feedback once the field has been touched
  const showEmailError = emailTouched && !!emailError;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inviter des amis</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Intro card */}
        <View style={styles.quotaCard}>
          <View style={styles.quotaIconWrap}>
            <Feather name="gift" size={26} color={Colors.orange} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quotaHeading}>Fais grandir le réseau</Text>
            <Text style={styles.quotaSubtext}>
              Invite autant d&apos;amis que tu veux à rejoindre la diaspora nigérienne.
            </Text>
          </View>
        </View>

        {!user?.emailVerified ? (
          <View style={styles.warningBanner}>
            <Feather name="alert-circle" size={14} color={Colors.warningDark} />
            <Text style={styles.warningText}>
              Vérifie ton adresse email pour activer les invitations.
            </Text>
          </View>
        ) : null}

        {/* ── Invite par email ─────────────────────────────────────────────── */}
        <View style={styles.methodCard}>
          <View style={styles.methodHeader}>
            <View style={styles.methodIconWrap}>
              <Feather name="mail" size={18} color={Colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>Par email</Text>
              <Text style={styles.methodSubtitle}>
                On envoie l&apos;invitation directement à la personne.
              </Text>
            </View>
          </View>

          <View style={[styles.inputWrap, showEmailError && styles.inputWrapError]}>
            <Feather
              name="at-sign"
              size={16}
              color={showEmailError ? palette.errorText : Colors.tan400}
              style={styles.inputIcon}
            />
            <TextInput
              ref={emailInputRef}
              style={styles.input}
              placeholder="ami@exemple.com"
              placeholderTextColor={Colors.tan400}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
              value={emailValue}
              onChangeText={(v) => {
                setEmailValue(v);
                if (emailTouched) setEmailError(validateEmail(v));
              }}
              onBlur={() => {
                setEmailTouched(true);
                setEmailError(validateEmail(emailValue));
              }}
              onSubmitEditing={() => void handleEmailInvite()}
              editable={!emailSending && !actionsDisabled}
              accessibilityLabel="Adresse email du destinataire"
            />
          </View>

          {showEmailError ? (
            <Text style={styles.fieldError}>{emailError}</Text>
          ) : null}

          <Pressable
            onPress={() => void handleEmailInvite()}
            disabled={emailSending || actionsDisabled}
            style={({ pressed }) => [
              styles.emailBtn,
              (emailSending || actionsDisabled || pressed) && { opacity: 0.72 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Envoyer l'invitation par email"
          >
            {emailSending ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <>
                <Feather name="send" size={16} color={Colors.white} />
                <Text style={styles.emailBtnLabel}>Envoyer l&apos;invitation</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* ── Séparateur ───────────────────────────────────────────────────── */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>ou</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* ── Invite par lien ──────────────────────────────────────────────── */}
        <View style={styles.methodCard}>
          <View style={styles.methodHeader}>
            <View style={styles.methodIconWrap}>
              <Feather name="share-2" size={18} color={Colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>Par lien / téléphone</Text>
              <Text style={styles.methodSubtitle}>
                Génère un lien et partage-le toi-même via WhatsApp, SMS…
              </Text>
            </View>
          </View>

          {genError ? (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <Feather name="alert-triangle" size={14} color={palette.errorText} />
              <Text style={styles.errorText}>{genError}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => void handleGenerate()}
            disabled={generating || actionsDisabled}
            style={({ pressed }) => [
              styles.generateBtn,
              (generating || actionsDisabled || pressed) && { opacity: 0.72 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Générer un lien d'invitation"
          >
            {generating ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <>
                <Feather name="link-2" size={18} color={Colors.white} />
                <Text style={styles.generateBtnLabel}>Générer un lien</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* ── Lien de masse (droit accordé) ────────────────────────────────── */}
        {canBulkInvite ? (
          <View style={styles.methodCard}>
            <View style={styles.methodHeader}>
              <View style={styles.methodIconWrap}>
                <Feather name="users" size={18} color={Colors.orange} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodTitle}>Lien d&apos;invitation de masse</Text>
                <Text style={styles.methodSubtitle}>
                  Un seul lien réutilisable, partageable à un groupe entier. Suis le nombre
                  d&apos;inscriptions ci-dessous.
                </Text>
              </View>
            </View>

            {bulkError ? (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Feather name="alert-triangle" size={14} color={palette.errorText} />
                <Text style={styles.errorText}>{bulkError}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={() => void handleGenerateBulk()}
              disabled={bulkGenerating || actionsDisabled}
              style={({ pressed }) => [
                styles.generateBtn,
                (bulkGenerating || actionsDisabled || pressed) && { opacity: 0.72 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Générer un lien d'invitation de masse"
            >
              {bulkGenerating ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <>
                  <Feather name="share" size={18} color={Colors.white} />
                  <Text style={styles.generateBtnLabel}>Générer un lien d&apos;invitation</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}

        {/* Invitations / filleuls list */}
        {invites.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mes invitations & filleuls</Text>
            {invites.map((inv) => (
              <InviteRow
                key={inv.id}
                inv={inv}
                onRevoke={confirmRevoke}
                isRevoking={revokeMut.isPending && revokeMut.variables === inv.id}
              />
            ))}
          </View>
        ) : !isLoading ? (
          <View style={styles.emptyWrap}>
            <Feather name="users" size={40} color={Colors.tan300} style={{ marginBottom: Spacing.md }} />
            <Text style={styles.emptyTitle}>Aucune invitation envoyée</Text>
            <Text style={styles.emptyBody}>
              Envoie une invitation par email ou génère un lien à partager.
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={{ padding: Spacing.xxxl, alignItems: 'center' }}>
            <ActivityIndicator color={Colors.orange} />
          </View>
        ) : null}

        {error ? (
          <Pressable onPress={() => void refetch()} style={styles.retryBtn}>
            <Feather name="refresh-cw" size={14} color={Colors.orange} />
            <Text style={styles.retryLabel}>Réessayer</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InviteRow({
  inv,
  onRevoke,
  isRevoking,
}: {
  inv: InvitationItem;
  onRevoke: (id: string) => void;
  isRevoking: boolean;
}) {
  const statusColor = STATUS_COLORS[inv.status];
  const isReusable = inv.kind === 'reusable';
  const acceptedName = inv.acceptedBy?.displayName ?? null;

  return (
    <View style={styles.inviteRow}>
      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.inviteCodeRow}>
          <Text style={styles.inviteCode}>{inv.code}</Text>
          <View style={styles.kindBadge}>
            <Feather
              name={isReusable ? 'users' : 'user'}
              size={11}
              color={Colors.tan600}
            />
            <Text style={styles.kindBadgeLabel}>
              {isReusable ? 'Lien de masse' : 'Usage unique'}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
            <Text style={[styles.statusLabel, { color: statusColor }]}>
              {STATUS_LABELS[inv.status]}
            </Text>
          </View>
        </View>
        {isReusable ? (
          <Text style={styles.inviteMeta}>
            {inv.signupsCount} inscription{inv.signupsCount !== 1 ? 's' : ''} via ce lien
          </Text>
        ) : acceptedName ? (
          <Text style={styles.inviteMeta}>Rejoint par {acceptedName}</Text>
        ) : null}
        <Text style={styles.inviteDate}>
          Créée {relativeTime(inv.createdAt)}
        </Text>
      </View>
      {inv.status === 'pending' ? (
        <Pressable
          onPress={() => onRevoke(inv.id)}
          disabled={isRevoking}
          hitSlop={10}
          style={[styles.revokeBtn, isRevoking && { opacity: 0.5 }]}
          accessibilityLabel="Révoquer cette invitation"
          accessibilityRole="button"
        >
          {isRevoking ? (
            <ActivityIndicator size="small" color={Colors.danger} />
          ) : (
            <Feather name="x" size={16} color={Colors.danger} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.cream },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md + 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
    backgroundColor: Colors.cream,
  },
  headerTitle: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
  },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },

  // ── Intro card ──────────────────────────────────────────────────────────────
  quotaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.lg,
  },
  quotaIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.peach50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quotaHeading: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: 2,
  },
  quotaSubtext: { fontSize: Typography.sizes.sm, color: Colors.tan500, lineHeight: 19 },

  // ── Method cards ────────────────────────────────────────────────────────────
  methodCard: {
    backgroundColor: Colors.white,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  methodHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  methodIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.peach50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  methodTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: 2,
  },
  methodSubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    lineHeight: 19,
  },

  // ── Email input ─────────────────────────────────────────────────────────────
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan200,
    backgroundColor: Colors.cream,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  inputWrapError: {
    borderColor: palette.errorBorder,
    backgroundColor: palette.errorBg,
  },
  inputIcon: { flexShrink: 0 },
  input: {
    flex: 1,
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    // Minimum 44 pt touch target respected via parent height:48
  },
  fieldError: {
    fontSize: Typography.sizes.xs,
    color: palette.errorText,
    marginTop: -Spacing.sm + 2,
  },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 48,
    borderRadius: Radii.lg,
    backgroundColor: Colors.orange,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 5,
  },
  emailBtnLabel: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.white,
  },

  // ── Divider ─────────────────────────────────────────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.tan200 },
  dividerLabel: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan400,
    fontWeight: '600',
  },

  // ── Generate link button ────────────────────────────────────────────────────
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 56,
    borderRadius: Radii.xl,
    backgroundColor: Colors.orange,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  generateBtnLabel: {
    fontSize: Typography.sizes.lg,
    fontWeight: '700',
    color: Colors.white,
  },

  // ── Shared list ─────────────────────────────────────────────────────────────
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: 4,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.md,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  inviteCodeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  inviteCode: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
    fontFamily: 'monospace',
  },
  kindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radii.full,
    backgroundColor: Colors.tan100,
  },
  kindBadgeLabel: { fontSize: Typography.sizes.xxs, fontWeight: '700', color: Colors.tan600 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  statusLabel: { fontSize: Typography.sizes.xxs, fontWeight: '700' },
  inviteMeta: { fontSize: Typography.sizes.xs, color: Colors.tan600 },
  inviteDate: { fontSize: Typography.sizes.xxs, color: Colors.tan400, marginTop: 2 },
  revokeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Empty / error states ────────────────────────────────────────────────────
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
  },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  emptyBody: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: Spacing.lg,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: palette.errorBg,
    borderWidth: 1,
    borderColor: palette.errorBorder,
    borderRadius: Radii.md,
    padding: Spacing.md,
  },
  errorText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: palette.errorText,
    lineHeight: 19,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.warningSoft,
    borderRadius: Radii.md,
    padding: Spacing.md,
  },
  warningText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.warningDark,
    lineHeight: 19,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  retryLabel: { fontSize: Typography.sizes.sm, color: Colors.orange, fontWeight: '600' },
});
