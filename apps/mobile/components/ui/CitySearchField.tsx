import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { searchCities as searchCitiesLocal } from '@/constants/cities';
import { countryFlag, countryName, searchCountries } from '@/constants/countries';
import { geoApi } from '@/services/geoApi';
import type { CityResult } from '@/services/geoApi';

interface Props {
  city: string;
  countryCode: string;
  /**
   * Called whenever the city/country selection changes.
   * `lat` and `lng` are provided when the user picks from the API suggestions
   * (so the server stores precise world coordinates instead of guessing from
   * the city name). They are `undefined` when the user types free-text and
   * chooses the country from the flag grid — the server geocoder then resolves
   * the best match.
   */
  onChange: (city: string, countryCode: string, lat?: number, lng?: number) => void;
  label?: string;
}

/** Debounce delay in milliseconds before firing the API search. */
const DEBOUNCE_MS = 250;

/**
 * City autocomplete backed by the GET /geo/cities API endpoint (worldwide,
 * ~135k cities with coordinates).
 *
 * Flow:
 *   1. User types → debounced API call after 250 ms.
 *   2. API results shown in dropdown; selecting one fires onChange with coords.
 *   3. If the API returns nothing or the user ignores suggestions, the offline
 *      diaspora list (constants/cities.ts) is shown as a fallback.
 *   4. "Utiliser «…»" free-text row appears when no suggestion matches
 *      exactly; it opens the flag grid so the user picks the country. In this
 *      case lat/lng are undefined and the server geocoder resolves them.
 */
export function CitySearchField({ city, countryCode, onChange, label }: Props) {
  // The query is what the user currently types; while not focused we show the
  // committed city name.
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  // API results; reset to empty on each new query.
  const [apiResults, setApiResults] = useState<CityResult[]>([]);
  const [apiLoading, setApiLoading] = useState(false);

  // Free-text mode: the user typed a city not in the suggestions and clicked
  // "Utiliser «…»" — we show a searchable country list so they can pick the
  // country (any of the ~246, not just the diaspora shortlist).
  const [pickingCountry, setPickingCountry] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');

  // Ref to the pending debounce timer so we can cancel it on the next
  // keystroke.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trigger the debounced API search whenever the focused query changes.
  useEffect(() => {
    if (!focused) return;
    const trimmed = query.trim();

    // Clear previous timer
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // The server enforces a 2-char minimum (a single letter would scan the whole
    // ~135k-city dataset), so don't bother firing below that threshold.
    if (trimmed.length < 2) {
      setApiResults([]);
      return;
    }

    // Last-write guard: a slow earlier response must not overwrite a newer one.
    // `active` is flipped false by this effect's cleanup when `query` changes, so
    // any in-flight resolution for a stale query is ignored.
    let active = true;

    debounceRef.current = setTimeout(() => {
      setApiLoading(true);
      geoApi
        .searchCities(trimmed, { limit: 10 })
        .then((results) => {
          if (active) setApiResults(results);
        })
        .catch(() => {
          // API unreachable (e.g. offline, dev server down) — fall back silently
          // to the local list; the UI will surface the offline suggestions below.
          if (active) setApiResults([]);
        })
        .finally(() => {
          if (active) setApiLoading(false);
        });
    }, DEBOUNCE_MS);

    // Cleanup on re-render before the timeout fires: cancel the pending timer and
    // mark any in-flight request stale so its resolution is discarded.
    return () => {
      active = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, focused]);

  const trimmed = query.trim();

  // Offline fallback: use the embedded diaspora list when API has no results
  // yet (e.g. first keystroke before the debounce fires) or when offline.
  const offlineResults = focused && trimmed.length >= 1 ? searchCitiesLocal(trimmed) : [];

  // Merge: prefer API results, supplement with offline ones if API is sparse.
  // We cap at 10 total to keep the dropdown short.
  const suggestions: Array<{ name: string; country: string; lat?: number; lng?: number }> =
    apiResults.length > 0
      ? apiResults.slice(0, 10).map((r) => ({
          name: r.name,
          country: r.countryCode,
          lat: r.lat,
          lng: r.lng,
        }))
      : offlineResults.slice(0, 10).map((r) => ({ name: r.name, country: r.country }));

  // Only offer the free-text row when the typed value doesn't exactly match
  // a suggestion and we're not still loading the first result.
  const showFreeText =
    focused &&
    trimmed.length > 1 &&
    !apiLoading &&
    !suggestions.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());

  function selectCity(name: string, code: string, lat?: number, lng?: number) {
    onChange(name, code, lat, lng);
    setQuery('');
    setFocused(false);
    setPickingCountry(false);
    setApiResults([]);
  }

  function useFreeText() {
    // Keep the city name but leave lat/lng undefined — the server geocoder
    // will try to resolve coordinates from the name + countryCode chosen below.
    onChange(trimmed, '');
    setFocused(false);
    setPickingCountry(true);
    setCountryQuery('');
    setApiResults([]);
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
          {countryFlag(countryCode)} {city} — {countryName(countryCode)}
        </Text>
      ) : null}

      {(suggestions.length > 0 || showFreeText) && (
        <View style={styles.dropdown}>
          {suggestions.map((s) => (
            <Pressable
              key={`${s.country}:${s.name}`}
              onPress={() => selectCity(s.name, s.country, s.lat, s.lng)}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <Text style={styles.optionFlag}>{countryFlag(s.country)}</Text>
              <Text style={styles.optionText}>
                {s.name}{' '}
                <Text style={styles.optionCountry}>
                  — {countryName(s.country)}
                </Text>
              </Text>
            </Pressable>
          ))}
          {showFreeText ? (
            <Pressable
              onPress={useFreeText}
              style={({ pressed }) => [
                styles.option,
                styles.freeTextOption,
                pressed && styles.optionPressed,
              ]}
            >
              <Text style={styles.optionFlag}>📍</Text>
              <Text style={styles.optionText}>
                Utiliser &laquo;&nbsp;{trimmed}&nbsp;&raquo; comme ville
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {pickingCountry && !!city && (
        <View style={styles.countrySection}>
          <Text style={styles.countryPrompt}>
            Dans quel pays se trouve &laquo;&nbsp;{city}&nbsp;&raquo; ?
          </Text>
          <TextInput
            value={countryQuery}
            onChangeText={setCountryQuery}
            placeholder="Rechercher un pays…"
            placeholderTextColor={Colors.tan400}
            autoCorrect={false}
            style={styles.input}
          />
          <View style={styles.countryList}>
            {searchCountries(countryQuery, 40).map((c) => {
              const active = countryCode === c.code;
              return (
                <Pressable
                  key={c.code}
                  onPress={() => {
                    // No coords available in the free-text + manual-country path;
                    // the server geocoder resolves them from name + country.
                    onChange(city, c.code);
                    setPickingCountry(false);
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    active && styles.optionPressed,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Text style={styles.optionFlag}>{c.flag}</Text>
                  <Text style={styles.optionText}>{c.name}</Text>
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
  countryList: {
    marginTop: 6,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    backgroundColor: Colors.white,
    overflow: 'hidden',
  },
});
