import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Gradients, palette, Radii, Spacing, Typography } from '@/constants/theme';
import { CitySearchField } from '@/components/ui/CitySearchField';
import { profileApi } from '@/services/profileApi';
import { useAuthStore } from '@/stores/authStore';

/**
 * Onboarding step shown after an OAuth (Google/Apple) signup, which doesn't
 * provide a city/country. Without a location the user can't appear on the map,
 * so we collect it here before letting them into the app. Reuses the same
 * worldwide city autocomplete as registration.
 */
export default function CompleteProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [city, setCity] = useState(user?.city ?? '');
  const [countryCode, setCountryCode] = useState(user?.countryCode ?? '');
  const [coords, setCoords] = useState<{ lat?: number; lng?: number }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!city.trim() || !countryCode) {
      setError('Choisis ta ville pour continuer.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await profileApi.updateMe({
        city: city.trim(),
        countryCode,
        ...(coords.lat !== undefined && coords.lng !== undefined
          ? { latitude: coords.lat, longitude: coords.lng }
          : {}),
      } as never);
      setUser(updated);
      router.replace('/(tabs)' as never);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err.response?.data?.message ?? err.message ?? 'Impossible d’enregistrer. Réessaie.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Feather name="map-pin" size={48} color={Colors.orange} style={styles.emoji} />
          <Text style={styles.title}>Complète ton profil</Text>
          <Text style={styles.subtitle}>
            {user?.firstName ? `Bienvenue ${user.firstName} ! ` : ''}Dernière étape : indique ta
            ville pour apparaître sur la carte et trouver la diaspora autour de toi.
          </Text>

          {error ? (
            <View style={styles.errorBanner}>
              <Feather name="alert-triangle" size={16} color={palette.errorText} style={styles.errorIcon} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <CitySearchField
            label="Ta ville"
            city={city}
            countryCode={countryCode}
            onChange={(nextCity, nextCountry, lat, lng) => {
              setCity(nextCity);
              setCountryCode(nextCountry);
              setCoords({ lat, lng });
              if (error) setError(null);
            }}
          />

          <Pressable
            onPress={handleSubmit}
            disabled={loading || !city.trim() || !countryCode}
            style={({ pressed }) => [
              styles.submit,
              (loading || pressed || !city.trim() || !countryCode) && { opacity: 0.85 },
            ]}
          >
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            <Text style={styles.submitLabel}>{loading ? 'Enregistrement…' : 'Continuer'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  scroll: { flexGrow: 1, padding: Spacing.xl },
  emoji: { alignSelf: 'center', marginVertical: Spacing.lg },
  title: {
    fontSize: Typography.sizes.display,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.sizes.md,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  submit: {
    height: 56,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xl,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  submitLabel: { color: Colors.white, fontSize: Typography.sizes.lg, fontWeight: '700' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: palette.errorBg,
    borderWidth: 1,
    borderColor: palette.errorBorder,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  errorIcon: { fontSize: 16 },
  errorText: { flex: 1, color: palette.errorText, fontSize: Typography.sizes.sm },
});
