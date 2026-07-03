import { useState } from 'react';
import {
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
import { Feather } from '@expo/vector-icons';
import { Colors, CountryNames, Flags, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { COMMUNITY_PRICE_TYPE_LABELS } from '@/constants/lookups';
import { ratesApi, describeCommunityPriceError, type CommunityPriceInput } from '@/services/ratesApi';
import { toast } from '@/stores/toastStore';
import type { CommunityPriceType } from '@nigerconnect/shared-types';

const TYPES: Array<{ id: CommunityPriceType; label: string }> = [
  { id: 'billet_avion', label: COMMUNITY_PRICE_TYPE_LABELS.billet_avion! },
  { id: 'transfert_argent', label: COMMUNITY_PRICE_TYPE_LABELS.transfert_argent! },
  { id: 'colis_kg', label: COMMUNITY_PRICE_TYPE_LABELS.colis_kg! },
];

// Mirrors apps/api/src/rates/dto/rate.dto.ts createCommunityPriceSchema — kept
// in sync manually (mobile has no zod dep; validate the same rules inline so
// the user sees the error before hitting the 400).
interface FormErrors {
  type?: string;
  amount?: string;
  currency?: string;
  originCountry?: string;
  destCountry?: string;
  note?: string;
}

function validate(input: {
  type: CommunityPriceType | null;
  amount: string;
  currency: string;
  originCountry: string;
  destCountry: string;
  note: string;
}): FormErrors {
  const errors: FormErrors = {};
  if (!input.type) errors.type = 'Choisis un type de prix.';

  const amountNum = Number(input.amount.replace(',', '.'));
  if (!input.amount.trim() || !Number.isFinite(amountNum) || amountNum <= 0) {
    errors.amount = 'Montant invalide.';
  } else if (amountNum > 100_000_000) {
    errors.amount = 'Montant trop élevé.';
  }

  if (input.currency.trim().length !== 3) {
    errors.currency = 'Code devise à 3 lettres (ex. EUR).';
  }

  if (input.originCountry && input.originCountry.length !== 2) {
    errors.originCountry = 'Code pays à 2 lettres.';
  }
  if (input.destCountry && input.destCountry.length !== 2) {
    errors.destCountry = 'Code pays à 2 lettres.';
  }
  if (input.note.length > 280) {
    errors.note = 'Note trop longue (280 caractères max).';
  }
  return errors;
}

export default function NewCommunityPriceScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const [type, setType] = useState<CommunityPriceType | null>(null);
  const [originCity, setOriginCity] = useState('');
  const [originCountry, setOriginCountry] = useState('');
  const [destCity, setDestCity] = useState('');
  const [destCountry, setDestCountry] = useState('');
  const [provider, setProvider] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  function runValidation(): FormErrors {
    const next = validate({ type, amount, currency, originCountry, destCountry, note });
    setErrors(next);
    return next;
  }

  function markTouched(field: string) {
    setTouched((t) => ({ ...t, [field]: true }));
    runValidation();
  }

  const mut = useMutation({
    mutationFn: () => {
      const input: CommunityPriceInput = {
        type: type!,
        amount: Number(amount.replace(',', '.')),
        currency: currency.trim().toUpperCase(),
        originCity: originCity.trim() || undefined,
        originCountry: originCountry ? originCountry.toUpperCase() : undefined,
        destCity: destCity.trim() || undefined,
        destCountry: destCountry ? destCountry.toUpperCase() : undefined,
        provider: provider.trim() || undefined,
        note: note.trim() || undefined,
      };
      return ratesApi.create(input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['community-prices'] });
      void qc.invalidateQueries({ queryKey: ['rates', 'banner'] });
      toast.success('Prix signalé, merci pour ta contribution !');
      router.back();
    },
    onError: (e) => toast.error(describeCommunityPriceError(e)),
  });

  function handleSubmit() {
    setTouched({ type: true, amount: true, currency: true, originCountry: true, destCountry: true, note: true });
    const currentErrors = runValidation();
    if (Object.keys(currentErrors).length > 0) return;
    mut.mutate();
  }

  const canSubmit = !mut.isPending;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>‹ Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Signaler un prix</Text>
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={[styles.publish, !canSubmit && { opacity: 0.4 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.publishLabel}>{mut.isPending ? '…' : 'Publier'}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Type de prix</Text>
          <View style={styles.typeRow}>
            {TYPES.map((t) => {
              const active = type === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    setType(t.id);
                    setTouched((tt) => ({ ...tt, type: true }));
                  }}
                  style={[styles.typeCard, active && styles.typeCardActive]}
                >
                  <Text style={[styles.typeLabel, active && { color: Colors.orange }]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {touched.type && errors.type ? <Text style={styles.errorText}>{errors.type}</Text> : null}

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.section}>Montant</Text>
              <TextInput
                style={styles.input}
                placeholder="200"
                placeholderTextColor={Colors.tan400}
                value={amount}
                onChangeText={setAmount}
                onBlur={() => markTouched('amount')}
                keyboardType="decimal-pad"
              />
              {touched.amount && errors.amount ? <Text style={styles.errorText}>{errors.amount}</Text> : null}
            </View>
            <View style={{ width: 100 }}>
              <Text style={styles.section}>Devise</Text>
              <TextInput
                style={styles.input}
                placeholder="EUR"
                placeholderTextColor={Colors.tan400}
                value={currency}
                onChangeText={(v) => setCurrency(v.toUpperCase())}
                onBlur={() => markTouched('currency')}
                autoCapitalize="characters"
                maxLength={3}
              />
              {touched.currency && errors.currency ? <Text style={styles.errorText}>{errors.currency}</Text> : null}
            </View>
          </View>

          <Text style={styles.section}>Prestataire (optionnel)</Text>
          <TextInput
            style={styles.input}
            placeholder="Air France, Wave, Western Union…"
            placeholderTextColor={Colors.tan400}
            value={provider}
            onChangeText={setProvider}
            maxLength={100}
          />

          <Text style={styles.section}>Départ</Text>
          <TextInput
            style={styles.input}
            placeholder="Ville de départ (optionnel)"
            placeholderTextColor={Colors.tan400}
            value={originCity}
            onChangeText={setOriginCity}
            maxLength={100}
          />
          <View style={styles.countryGrid}>
            {Object.keys(Flags).map((code) => {
              const active = originCountry === code;
              return (
                <Pressable
                  key={`origin-${code}`}
                  onPress={() => setOriginCountry(active ? '' : code)}
                  style={[styles.countryCard, active && styles.countryCardActive]}
                >
                  <Text style={styles.flag}>{Flags[code]}</Text>
                  <Text style={styles.countryName}>{CountryNames[code]}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>Arrivée</Text>
          <TextInput
            style={styles.input}
            placeholder="Ville d’arrivée (optionnel)"
            placeholderTextColor={Colors.tan400}
            value={destCity}
            onChangeText={setDestCity}
            maxLength={100}
          />
          <View style={styles.countryGrid}>
            {Object.keys(Flags).map((code) => {
              const active = destCountry === code;
              return (
                <Pressable
                  key={`dest-${code}`}
                  onPress={() => setDestCountry(active ? '' : code)}
                  style={[styles.countryCard, active && styles.countryCardActive]}
                >
                  <Text style={styles.flag}>{Flags[code]}</Text>
                  <Text style={styles.countryName}>{CountryNames[code]}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>Note (optionnel)</Text>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            placeholder="Précisions utiles (frais inclus, date, palier de poids…)"
            placeholderTextColor={Colors.tan400}
            value={note}
            onChangeText={setNote}
            onBlur={() => markTouched('note')}
            multiline
            maxLength={280}
          />
          {touched.note && errors.note ? <Text style={styles.errorText}>{errors.note}</Text> : null}

          <View style={styles.hintBox}>
            <Feather name="info" size={14} color={Colors.tan500} />
            <Text style={styles.hintText}>
              Max 5 signalements par jour. Sois précis : ça aide toute la communauté.
            </Text>
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
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeCard: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  typeCardActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  typeLabel: { fontSize: Typography.sizes.sm, fontWeight: '700', color: Colors.tan600 },
  row2: { flexDirection: 'row', gap: Spacing.md },
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
  errorText: { fontSize: Typography.sizes.xs, color: Colors.danger, marginTop: 4, fontWeight: '600' },
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
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan50,
  },
  hintText: { flex: 1, fontSize: Typography.sizes.xs + 1, color: Colors.tan500, lineHeight: 17 },
});
