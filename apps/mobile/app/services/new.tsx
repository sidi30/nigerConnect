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
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { servicesApi } from '@/services/servicesApi';
import {
  Colors,
  CountryNames,
  Flags,
  Gradients,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';
import type { ServiceCategory, ServiceUrgency } from '@nigerconnect/shared-types';

const CATEGORIES: Array<{ id: ServiceCategory; icon: string; label: string }> = [
  { id: 'logement', icon: '🏠', label: 'Logement' },
  { id: 'transport', icon: '✈️', label: 'Transport' },
  { id: 'admin_category', icon: '📋', label: 'Admin' },
  { id: 'sante', icon: '🏥', label: 'Santé' },
  { id: 'emploi', icon: '💼', label: 'Emploi' },
  { id: 'business', icon: '💰', label: 'Business' },
  { id: 'education', icon: '🎓', label: 'Éducation' },
  { id: 'autre', icon: '📦', label: 'Autre' },
];

export default function NewServiceScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [urgency, setUrgency] = useState<ServiceUrgency>('normal');
  const [budget, setBudget] = useState('');
  const [city, setCity] = useState('');
  const [countryCode, setCountryCode] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      servicesApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        category: category!,
        urgency,
        budget: budget.trim() || undefined,
        city: city.trim() || undefined,
        countryCode: countryCode || undefined,
      }),
    onSuccess: (svc) => {
      void qc.invalidateQueries({ queryKey: ['services'] });
      router.replace(`/services/${svc.id}` as never);
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string } } };
      Alert.alert('Erreur', err.response?.data?.message ?? 'Impossible de publier');
    },
  });

  const canPublish =
    title.trim().length > 0 && category !== null && !mut.isPending;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>‹ Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Nouvelle demande</Text>
        <Pressable
          onPress={() => mut.mutate()}
          disabled={!canPublish}
          style={[styles.publish, !canPublish && { opacity: 0.4 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.publishLabel}>{mut.isPending ? '…' : 'Publier'}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Catégorie</Text>
          <View style={styles.catGrid}>
            {CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCategory(c.id)}
                  style={[styles.catCard, active && styles.catCardActive]}
                >
                  <Text style={styles.catIcon}>{c.icon}</Text>
                  <Text style={[styles.catLabel, active && { color: Colors.orange }]}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>Urgence</Text>
          <View style={styles.urgencyRow}>
            {(
              [
                { id: 'urgent' as const, label: '🔴 Urgent', color: Colors.warningDark, bg: Colors.warningSoft },
                { id: 'normal' as const, label: '🟢 Normal', color: Colors.tan600, bg: Colors.tan100 },
              ] as const
            ).map((u) => {
              const active = urgency === u.id;
              return (
                <Pressable
                  key={u.id}
                  onPress={() => setUrgency(u.id)}
                  style={[
                    styles.urgencyPill,
                    active && { backgroundColor: u.bg, borderColor: u.color },
                  ]}
                >
                  <Text style={[styles.urgencyLabel, active && { color: u.color }]}>
                    {u.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>Titre</Text>
          <TextInput
            style={styles.input}
            placeholder="Cherche logement à Paris pour 2 mois"
            placeholderTextColor={Colors.tan400}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
          />

          <Text style={styles.section}>Description</Text>
          <TextInput
            style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
            placeholder="Donne les détails (dates, besoins, contexte…)"
            placeholderTextColor={Colors.tan400}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={5000}
          />

          <Text style={styles.section}>Budget (facultatif)</Text>
          <TextInput
            style={styles.input}
            placeholder="500-700€/mois ou À discuter"
            placeholderTextColor={Colors.tan400}
            value={budget}
            onChangeText={setBudget}
            maxLength={50}
          />

          <Text style={styles.section}>Localisation</Text>
          <TextInput
            style={styles.input}
            placeholder="Ville"
            placeholderTextColor={Colors.tan400}
            value={city}
            onChangeText={setCity}
          />
          <View style={styles.countryGrid}>
            {Object.keys(Flags)
              .filter((c) => c !== 'NE')
              .map((code) => {
                const active = countryCode === code;
                return (
                  <Pressable
                    key={code}
                    onPress={() => setCountryCode(active ? '' : code)}
                    style={[styles.countryCard, active && styles.countryCardActive]}
                  >
                    <Text style={styles.flag}>{Flags[code]}</Text>
                    <Text style={styles.countryName}>{CountryNames[code]}</Text>
                  </Pressable>
                );
              })}
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
  section: {
    fontSize: Typography.sizes.xs,
    fontWeight: '800',
    color: Colors.tan500,
    letterSpacing: 1,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
  },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catCard: {
    flexBasis: '23%',
    padding: Spacing.md - 2,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    alignItems: 'center',
  },
  catCardActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  catIcon: { fontSize: 22 },
  catLabel: {
    fontSize: Typography.sizes.xxs,
    fontWeight: '700',
    color: Colors.tan600,
    marginTop: 2,
  },
  urgencyRow: { flexDirection: 'row', gap: 8 },
  urgencyPill: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    alignItems: 'center',
  },
  urgencyLabel: { fontSize: Typography.sizes.sm, fontWeight: '700', color: Colors.tan600 },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md + 2,
    fontSize: Typography.sizes.md,
    backgroundColor: Colors.white,
    color: Colors.brown,
  },
  countryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  countryCard: {
    flexBasis: '48%',
    padding: Spacing.sm + 2,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  countryCardActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  flag: { fontSize: 20 },
  countryName: { fontSize: Typography.sizes.sm, fontWeight: '600', color: Colors.brown, marginTop: 2 },
});
