/**
 * Cible du retour OAuth Google : com.nigerconnect.app:/oauthredirect?code=...
 *
 * Sur Android, expo-web-browser n'a pas de session d'auth native : le retour
 * du Custom Tab arrive comme un deep link ordinaire. expo-auth-session le
 * consomme via son propre listener Linking (c'est lui qui résout promptAsync),
 * mais expo-router reçoit le MÊME lien — sans cette route, il affichait sa vue
 * « Unmatched Route ». L'écran ne lit donc volontairement rien du lien : il
 * couvre l'échange de tokens en cours, et l'AuthGate (_layout.tsx) redirige
 * vers (tabs) dès que la session est établie. iOS n'est pas concerné
 * (ASWebAuthenticationSession capte le callback au niveau OS, le lien
 * n'atteint jamais le router).
 */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { Colors, Spacing, Typography } from '@/constants/theme';

export default function OAuthRedirectScreen() {
  const router = useRouter();

  // Filet de sécurité : si l'échange n'a pas abouti au bout de 3 s (échange
  // échoué, ou cold start sans promptAsync en attente), retour au login. Le
  // timer est nettoyé au démontage — si l'AuthGate a déjà redirigé, il ne
  // tire jamais.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!useAuthStore.getState().isAuthenticated) {
        router.replace('/(auth)/login');
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View style={styles.root}>
      <ActivityIndicator size="large" color={Colors.orange} />
      <Text style={styles.label}>Connexion en cours…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  label: {
    fontSize: Typography.sizes.md,
    color: Colors.tan500,
  },
});
