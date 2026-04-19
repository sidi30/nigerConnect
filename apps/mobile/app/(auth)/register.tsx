import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { useAuthStore } from '@/stores/authStore';

export default function RegisterScreen() {
  const register = useAuthStore((s) => s.register);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setLoading(true);
    try {
      await register({ firstName, lastName, email: email.trim().toLowerCase(), password });
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      Alert.alert('Inscription impossible', err.response?.data?.message ?? err.message ?? '');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Rejoindre NigerConnect</Text>
          <Text style={styles.subtitle}>Crée ton compte pour retrouver la diaspora.</Text>
          <Input label="Prénom" value={firstName} onChangeText={setFirstName} />
          <Input label="Nom" value={lastName} onChangeText={setLastName} />
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Input
            label="Mot de passe (min 12 car., 1 maj, 1 chiffre, 1 spécial)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <Button label="Créer mon compte" onPress={onSubmit} loading={loading} />
          <Link href="/(auth)/login" asChild>
            <Text style={styles.link}>Déjà un compte ? Se connecter</Text>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  scroll: { flexGrow: 1, padding: Spacing.xl, justifyContent: 'center' },
  title: { fontSize: Typography.sizes.xxl, fontWeight: '700', color: Colors.orange, marginBottom: Spacing.xs },
  subtitle: { fontSize: Typography.sizes.md, color: Colors.gray600, marginBottom: Spacing.xl },
  link: { textAlign: 'center', marginTop: Spacing.lg, color: Colors.orange, fontSize: Typography.sizes.sm },
});
