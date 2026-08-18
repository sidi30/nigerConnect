import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import type { FeedCountry } from '@nigerconnect/shared-types';

/** Valeur courante du filtre : `undefined` = mon pays (le défaut serveur). */
export type CountrySelection = string | undefined | 'all';

interface Props {
  countries: FeedCountry[];
  /** Mon pays, pour marquer la pastille correspondante. */
  ownCountry: string | null;
  value: CountrySelection;
  onChange: (next: CountrySelection) => void;
}

/**
 * Drapeau emoji depuis un code ISO-3166-1 alpha-2, par décalage vers les
 * Regional Indicator Symbols. Évite d'embarquer une table de 250 drapeaux —
 * et un code inconnu retombe naturellement sur deux lettres, pas sur un vide.
 */
function flagOf(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Noms des pays où vit réellement la diaspora. Le reste tombe sur son code. */
const NAMES: Record<string, string> = {
  NE: 'Niger',
  FR: 'France',
  TR: 'Turquie',
  MA: 'Maroc',
  US: 'États-Unis',
  CA: 'Canada',
  ES: 'Espagne',
  BE: 'Belgique',
  CH: 'Suisse',
  NL: 'Pays-Bas',
  DE: 'Allemagne',
  GB: 'Royaume-Uni',
  IT: 'Italie',
  CN: 'Chine',
  RU: 'Russie',
  TN: 'Tunisie',
  DZ: 'Algérie',
  CI: "Côte d'Ivoire",
  SN: 'Sénégal',
  BF: 'Burkina Faso',
  BJ: 'Bénin',
  GN: 'Guinée',
  ML: 'Mali',
  TG: 'Togo',
  CZ: 'Tchéquie',
  CY: 'Chypre',
  IN: 'Inde',
};

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      hitSlop={4}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Barre de pays au-dessus du fil. Elle ne défile pas avec le contenu : le
 * membre doit pouvoir changer de pays sans remonter tout son fil.
 *
 * Rien ne s'affiche quand il n'y a qu'un seul pays à proposer — c'est le cas
 * d'un membre au Niger, dont la séparation diaspora borne déjà le fil à un seul
 * côté : deux pastilles qui donnent le même fil ne sont pas un choix.
 */
export const CountryFilterBar = memo(function CountryFilterBar({
  countries,
  ownCountry,
  value,
  onChange,
}: Props) {
  if (countries.length <= 1) return null;

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Chip label="🌍  Tous" active={value === 'all'} onPress={() => onChange('all')} />
        {countries.map((c) => {
          // `undefined` (défaut) et le code de mon pays désignent le même fil :
          // les deux doivent allumer la même pastille, sinon on donne
          // l'impression qu'aucun filtre n'est actif au premier lancement.
          const isOwn = c.countryCode === ownCountry;
          const active = value === c.countryCode || (value === undefined && isOwn);
          return (
            <Chip
              key={c.countryCode}
              label={`${flagOf(c.countryCode)}  ${NAMES[c.countryCode] ?? c.countryCode}`}
              active={active}
              onPress={() => onChange(c.countryCode)}
            />
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.tan200,
    backgroundColor: Colors.white,
  },
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.full,
    backgroundColor: Colors.tan100,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: {
    backgroundColor: Colors.peach50,
    borderColor: Colors.orange,
  },
  chipText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.sizes.sm,
    color: Colors.brown,
  },
  chipTextActive: {
    fontFamily: Typography.fontFamily.semibold,
    color: Colors.orange,
  },
});
