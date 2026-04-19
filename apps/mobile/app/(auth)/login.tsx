import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { useAuthStore } from '@/stores/authStore';

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (error) {
      Alert.alert('Connexion impossible', errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>NigerConnect</Text>
          <Text style={styles.tagline}>Restons connectés, où que nous soyons.</Text>
          <View style={styles.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Input
              label="Mot de passe"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
            />
            <Button label="Se connecter" onPress={onSubmit} loading={loading} />
            <Link href="/(auth)/register" asChild>
              <Text style={styles.link}>Pas encore de compte ? S&apos;inscrire</Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function errorMessage(error: unknown): string {
  const err = error as { response?: { data?: { message?: string } }; message?: string };
  return err.response?.data?.message ?? err.message ?? 'Erreur inconnue';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  scroll: { flexGrow: 1, padding: Spacing.xl, justifyContent: 'center' },
  logo: {
    fontSize: Typography.sizes.xxxl,
    fontWeight: '700',
    color: Colors.orange,
    marginBottom: Spacing.xs,
    fontFamily: Typography.fontFamily.bold,
  },
  tagline: { fontSize: Typography.sizes.md, color: Colors.gray600, marginBottom: Spacing.xxl },
  form: { gap: Spacing.md },
  link: {
    textAlign: 'center',
    marginTop: Spacing.lg,
    color: Colors.orange,
    fontSize: Typography.sizes.sm,
  },
});
