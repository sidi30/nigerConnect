import { StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { Colors } from '@/constants/theme';

interface Props {
  size?: number;
}

// Badge du compte OFFICIEL NigerConnect. Bleu, cerclé de blanc, et posé
// uniquement par la console admin : c'est la seule marque que personne d'autre
// ne peut obtenir, donc la seule qui puisse valoir garantie. Volontairement
// distinct du vert « identité vérifiée » (que des milliers de membres portent)
// et de l'or « ambassadeur ». Un compte officiel n'affiche que ce badge-là.
const OFFICIAL_BLUE = '#1D4ED8';

export function OfficialBadge({ size = 14 }: Props) {
  const reduce = useReducedMotion();
  return (
    <Animated.View
      entering={reduce ? undefined : ZoomIn.springify().damping(8).stiffness(180)}
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, borderWidth: Math.max(1, size * 0.08) },
      ]}
      accessibilityRole="image"
      accessibilityLabel="Compte officiel NigerConnect"
    >
      <Feather name="check" size={size * 0.66} color={Colors.white} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: OFFICIAL_BLUE,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 3,
  },
});
