import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors, CountryNames, Flags, Radii, Spacing, Typography } from '@/constants/theme';
import { searchCities } from '@/constants/cities';

interface Props {
  city: string;
  countryCode: string;
  onChange: (city: string, countryCode: string) => void;
  label?: string;
}

const COUNTRY_OPTIONS = Object.keys(Flags);

/**
 * City autocomplete with auto-filled country.
 *
 * Typing filters the embedded city list (accent/case-insensitive). Picking a
 * suggestion sets both `city` and `countryCode` in one `onChange`. A city that
 * isn't listed can still be used via the "Utiliser « … »" row, which then asks
 * the user to pick the country from the flag grid — so the API always receives
 * a resolved ISO-2 `countryCode` alongside the free-text city.
 */
export function CitySearchField({ city, countryCode, onChange, label }: Props) {
  // The query is what the user types; while empty we mirror the committed city.
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  // Free-text mode: city typed but no country resolved yet → show flag grid.
  const [pickingCountry, setPickingCountry] = useState(false);

  const suggestions = useMemo(() => (focused ? searchCities(query) : []), [focused, query]);

  const trimmed = query.trim();
  // Only offer the free-text row when the typed value doesn't exactly match a suggestion.
  const showFreeText =
    focused &&
    trimmed.length > 1 &&
    !suggestions.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());

  function selectCity(name: string, code: string) {
    onChange(name, code);
    setQuery('');
    setFocused(false);
    setPickingCountry(false);
  }

  function useFreeText() {
    // Keep the city, defer country choice to the flag grid below.
    onChange(trimmed, '');
    setFocused(false);
    setPickingCountry(true);
  }

  const hasSelection = !!city && !focused;

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <TextInput
        value={focused ? query : city}
        onChangeText={(v) => {
          setQuery(v);
          if (!focused) setFocused(true);
        }}
        onFocus={() => {
          setFocused(true);
          setQuery('');
          setPickingCountry(false);
        }}
        onBlur={() => setFocused(false)}
        placeholder="Ex : Paris"
        placeholderTextColor={Colors.tan400}
        autoCorrect={false}
        style={styles.input}
      />

      {hasSelection && countryCode ? (
        <Text style={styles.selectionHint}>
          {Flags[countryCode] ?? '📍'} {city} — {CountryNames[countryCode] ?? countryCode}
        </Text>
      ) : null}

      {(suggestions.length > 0 || showFreeText) && (
        <View style={styles.dropdown}>
          {suggestions.map((s) => (
            <Pressable
              key={`${s.country}:${s.name}`}
              onPress={() => selectCity(s.name, s.country)}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <Text style={styles.optionFlag}>{Flags[s.country]}</Text>
              <Text style={styles.optionText}>
                {s.name} <Text style={styles.optionCountry}>— {CountryNames[s.country]}</Text>
              </Text>
            </Pressable>
          ))}
          {showFreeText ? (
            <Pressable
              onPress={useFreeText}
              style={({ pressed }) => [styles.option, styles.freeTextOption, pressed && styles.optionPressed]}
            >
              <Text style={styles.optionFlag}>📍</Text>
              <Text style={styles.optionText}>
                Utiliser «&nbsp;{trimmed}&nbsp;» comme ville
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {pickingCountry && !!city && (
        <View style={styles.countrySection}>
          <Text style={styles.countryPrompt}>Dans quel pays se trouve «&nbsp;{city}&nbsp;» ?</Text>
          <View style={styles.countryGrid}>
            {COUNTRY_OPTIONS.map((code) => {
              const active = countryCode === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => {
                    onChange(city, code);
                    setPickingCountry(false);
                  }}
                  style={[styles.countryCard, active && styles.countryCardActive]}
                >
                  <Text style={styles.countryFlag}>{Flags[code]}</Text>
                  <Text style={styles.countryName}>{CountryNames[code]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  label: {
    fontSize: Typography.sizes.sm,
    fontWeight: '600',
    color: Colors.brown,
    marginBottom: 6,
  },
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
  selectionHint: {
    marginTop: 6,
    fontSize: Typography.sizes.sm,
    color: Colors.tan600,
    fontWeight: '600',
  },
  dropdown: {
    marginTop: 6,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    backgroundColor: Colors.white,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan100,
  },
  optionPressed: { backgroundColor: Colors.peach50 },
  freeTextOption: { borderBottomWidth: 0, backgroundColor: Colors.tan50 },
  optionFlag: { fontSize: 20 },
  optionText: { flex: 1, fontSize: Typography.sizes.md, color: Colors.brown, fontWeight: '500' },
  optionCountry: { color: Colors.tan500, fontWeight: '400' },
  countrySection: { marginTop: Spacing.md },
  countryPrompt: {
    fontSize: Typography.sizes.sm,
    fontWeight: '600',
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  countryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  countryCard: {
    flexBasis: '48%',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  countryCardActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  countryFlag: { fontSize: 22, marginBottom: 4 },
  countryName: { fontSize: Typography.sizes.sm, fontWeight: '600', color: Colors.brown },
});
