/**
 * Écran de repli pour tout lien profond que le routeur n'a pas su résoudre.
 *
 * Sans ce fichier, expo-router affiche sa vue « Unmatched Route » (fond noir,
 * « Page could not be found »). Des membres Android la voyaient une fois sur
 * deux avec l'URL `nigerconnect:///` — le schéma nu, sans chemin : l'app est
 * bien lancée par un lien, mais il ne désigne aucune route. L'AuthGate est
 * censé rattraper le segment `+not-found`, sauf tant que la session n'est pas
 * hydratée (course au démarrage à froid) : le membre restait alors bloqué sur
 * le 404 d'expo-router, sans même un bouton retour utile.
 *
 * On ne montre donc jamais cet écran : on renvoie vers `/`, qui décide de la
 * destination (feed si session, accueil sinon) une fois l'hydratation faite.
 */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Redirect, usePathname } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { Colors } from '@/constants/theme';

export default function NotFoundScreen() {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const pathname = usePathname();

  // Trace l'URL fautive : sans elle on ne peut pas savoir QUI ouvre l'app sur
  // un lien vide (notification, retour OAuth, raccourci…). Visible en
  // `adb logcat` sur un build de dev/preview.
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      // eslint-disable-next-line no-console
      console.warn(`[deep-link] non résolu: ${url ?? 'inconnu'} (pathname=${pathname})`);
    });
  }, [pathname]);

  // Tant que la session n'est pas restaurée, `/` ne saurait pas où aller.
  if (!isHydrated) {
    return (
      <View style={styles.root}>
        <ActivityIndicator size="large" color={Colors.orange} />
      </View>
    );
  }

  return <Redirect href="/" />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cream,
  },
});
