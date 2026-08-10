/**
 * « Nous contacter » — partenariat, demande d'info, signalement d'un souci.
 *
 * Deux voies volontairement offertes : le formulaire (le message atterrit dans
 * la console admin ET part par email) et les coordonnées directes, pour qui
 * préfère son propre client mail ou WhatsApp. Un partenaire potentiel ne doit
 * jamais buter sur un formulaire cassé faute d'alternative.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { contactApi, type ContactTopic } from '@/services/contactApi';
import { describeError } from '@/services/apiError';
import { toast } from '@/stores/toastStore';
import { useAuthStore } from '@/stores/authStore';

const CONTACT_EMAIL = 'contact@nigerconnect.app';
/** Format international : requis par le lien wa.me, qui refuse le 0 national. */
const CONTACT_PHONE = '+33685218270';
const CONTACT_PHONE_LABEL = '+33 6 85 21 82 70';

const TOPICS: Array<{ key: ContactTopic; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { key: 'partnership', label: 'Partenariat', icon: 'briefcase' },
  { key: 'info', label: 'Information', icon: 'help-circle' },
  { key: 'problem', label: 'Un souci', icon: 'alert-triangle' },
  { key: 'other', label: 'Autre', icon: 'more-horizontal' },
];

// Mêmes bornes que le schéma Zod côté API : l'utilisateur voit l'erreur avant
// l'aller-retour réseau, l'API reste seule juge.
const SUBJECT_MIN = 3;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;

export default function ContactScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [topic, setTopic] = useState<ContactTopic>('info');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const canSend =
    email.trim().length > 3 &&
    subject.trim().length >= SUBJECT_MIN &&
    message.trim().length >= MESSAGE_MIN;

  const send = useMutation({
    mutationFn: () =>
      contactApi.send({
        topic,
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        subject: subject.trim(),
        message: message.trim(),
      }),
    onSuccess: () => {
      toast.success('Message envoyé — on te répond vite.');
      router.back();
    },
    onError: (err) => toast.error(describeError(err, "Envoi impossible.")),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Feather name="arrow-left" size={22} color={Colors.brown} />
        </Pressable>
        <Text style={styles.title}>Nous contacter</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.directCard}>
            <Text style={styles.directTitle}>Nous joindre directement</Text>
            <Pressable
              style={styles.directRow}
              onPress={() => void Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
              accessibilityRole="button"
              accessibilityLabel={`Écrire à ${CONTACT_EMAIL}`}
            >
              <View style={styles.directIcon}>
                <Feather name="mail" size={17} color={Colors.orange} />
              </View>
              <Text style={styles.directValue}>{CONTACT_EMAIL}</Text>
              <Feather name="chevron-right" size={20} color={Colors.tan400} />
            </Pressable>
            <Pressable
              style={styles.directRow}
              onPress={() => void Linking.openURL(`https://wa.me/${CONTACT_PHONE.replace('+', '')}`)}
              accessibilityRole="button"
              accessibilityLabel={`Écrire sur WhatsApp au ${CONTACT_PHONE_LABEL}`}
            >
              <View style={styles.directIcon}>
                <Feather name="message-circle" size={17} color={Colors.orange} />
              </View>
              <Text style={styles.directValue}>WhatsApp {CONTACT_PHONE_LABEL}</Text>
              <Feather name="chevron-right" size={20} color={Colors.tan400} />
            </Pressable>
            <Pressable
              style={styles.directRow}
              onPress={() => void Linking.openURL(`tel:${CONTACT_PHONE}`)}
              accessibilityRole="button"
              accessibilityLabel={`Appeler le ${CONTACT_PHONE_LABEL}`}
            >
              <View style={styles.directIcon}>
                <Feather name="phone" size={17} color={Colors.orange} />
              </View>
              <Text style={styles.directValue}>Appeler {CONTACT_PHONE_LABEL}</Text>
              <Feather name="chevron-right" size={20} color={Colors.tan400} />
            </Pressable>
          </View>

          <Text style={styles.formIntro}>…ou écris-nous ici, on reçoit tout au même endroit.</Text>

          <Text style={styles.label}>Motif</Text>
          <View style={styles.topics}>
            {TOPICS.map((t) => {
              const active = topic === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTopic(t.key)}
                  style={[styles.topic, active && styles.topicActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t.label}
                >
                  <Feather
                    name={t.icon}
                    size={15}
                    color={active ? Colors.white : Colors.brown}
                  />
                  <Text style={[styles.topicLabel, active && styles.topicLabelActive]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Email de réponse</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="toi@exemple.com"
            placeholderTextColor={Colors.tan400}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
          />

          <Text style={styles.label}>Téléphone (facultatif)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+227 90 00 00 00"
            placeholderTextColor={Colors.tan400}
            keyboardType="phone-pad"
            maxLength={32}
          />

          <Text style={styles.label}>Sujet</Text>
          <TextInput
            style={styles.input}
            value={subject}
            onChangeText={setSubject}
            placeholder="En quelques mots"
            placeholderTextColor={Colors.tan400}
            maxLength={140}
          />

          <Text style={styles.label}>Message</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={message}
            onChangeText={setMessage}
            placeholder="Dis-nous tout"
            placeholderTextColor={Colors.tan400}
            multiline
            textAlignVertical="top"
            maxLength={MESSAGE_MAX}
          />
          <Text style={styles.counter}>
            {message.trim().length}/{MESSAGE_MAX}
          </Text>

          <Pressable
            style={[styles.submit, (!canSend || send.isPending) && styles.submitDisabled]}
            onPress={() => send.mutate()}
            disabled={!canSend || send.isPending}
            accessibilityRole="button"
            accessibilityLabel="Envoyer le message"
          >
            {send.isPending ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <>
                <Feather name="send" size={17} color={Colors.white} />
                <Text style={styles.submitLabel}>Envoyer</Text>
              </>
            )}
          </Pressable>
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
  back: { width: 40 },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
  },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },

  directCard: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  directTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: '800',
    color: Colors.brown,
    marginBottom: Spacing.xs,
  },
  directRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
  },
  directIcon: {
    width: 34,
    height: 34,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directValue: { flex: 1, fontSize: Typography.sizes.sm, color: Colors.brown, fontWeight: '600' },

  formIntro: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
  },
  label: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
    fontSize: Typography.sizes.xs,
    fontWeight: '700',
    color: Colors.brown,
  },
  input: {
    backgroundColor: Colors.white,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.tan200,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    fontSize: Typography.sizes.sm,
    color: Colors.brown,
  },
  textarea: { minHeight: 140 },
  counter: {
    alignSelf: 'flex-end',
    marginTop: 4,
    fontSize: Typography.sizes.xxs,
    color: Colors.tan400,
  },

  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  topic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  topicActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  topicLabel: { fontSize: Typography.sizes.xs, fontWeight: '700', color: Colors.brown },
  topicLabelActive: { color: Colors.white },

  submit: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.orange,
    borderRadius: Radii.full,
    paddingVertical: Spacing.md + 2,
  },
  submitDisabled: { opacity: 0.5 },
  submitLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '800' },
});
