import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import type { PublicUser } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { friendsApi } from '@/services/friendsApi';
import { serializeMentions } from '@/utils/mentions';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

type Mention = { display: string; userId: string };

function displayNameOf(u: PublicUser): string {
  return u.displayName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Anonyme';
}

/** Find the active "@query" the cursor is sitting in (null if none). */
function computeQuery(
  text: string,
  cursor: number,
  mentions: Mention[],
): { q: string; at: number } | null {
  const upto = text.slice(0, cursor);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  // The '@' must start a word (begin of text or after whitespace) — avoids
  // triggering on emails like a@b.com.
  if (at > 0 && !/\s/.test(text[at - 1]!)) return null;
  const between = upto.slice(at + 1);
  if (between.includes('\n') || between.length > 30) return null;
  // A already-completed mention ("@Name " + more text) is not a live query.
  if (mentions.some((m) => between === `${m.display} ` || between.startsWith(`${m.display} `))) {
    return null;
  }
  return { q: between, at };
}

interface Props extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  /** Called with the serialized content (with `@[Name](uuid)` tokens) on change. */
  onChangeContent: (content: string) => void;
  /** Change this number to clear the input (e.g. after sending). */
  resetSignal?: number;
  inputRef?: React.RefObject<TextInput | null>;
  /** Wrapper style — pass `{ flex: 1 }` when used inside a flex row (comment bar). */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * TextInput with Facebook-style @mentions: typing "@" opens an autocomplete of
 * the user's friends; picking one inserts a highlighted name and tags them. The
 * value the parent receives via onChangeContent carries `@[Name](uuid)` tokens.
 */
export function MentionInput({
  onChangeContent,
  resetSignal,
  inputRef,
  style,
  containerStyle,
  ...rest
}: Props) {
  const [text, setText] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const mentionsRef = useRef<Mention[]>([]);
  const [query, setQuery] = useState<{ q: string; at: number } | null>(null);
  const [suggestions, setSuggestions] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear on demand (parent bumps resetSignal after a successful send).
  useEffect(() => {
    if (resetSignal === undefined) return;
    setText('');
    mentionsRef.current = [];
    setQuery(null);
    setSuggestions([]);
    setSelection({ start: 0, end: 0 });
  }, [resetSignal]);

  const emit = useCallback(
    (t: string, mentions: Mention[]) => onChangeContent(serializeMentions(t, mentions)),
    [onChangeContent],
  );

  const handleChange = (t: string) => {
    // Drop mentions whose "@name" the user deleted.
    mentionsRef.current = mentionsRef.current.filter((m) => t.includes(`@${m.display}`));
    setText(t);
    emit(t, mentionsRef.current);
  };

  // Recompute the active @query whenever text or cursor moves.
  useEffect(() => {
    setQuery(computeQuery(text, selection.end, mentionsRef.current));
  }, [text, selection.end]);

  // Debounced friend search for the current query.
  useEffect(() => {
    if (!query || query.q.trim().length < 1) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      friendsApi
        .search(query.q.trim())
        .then((res) => setSuggestions(res))
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function pick(friend: PublicUser) {
    if (!query) return;
    const name = displayNameOf(friend);
    const before = text.slice(0, query.at);
    const after = text.slice(selection.end);
    const insert = `@${name} `;
    const newText = before + insert + after;
    mentionsRef.current = [...mentionsRef.current, { display: name, userId: friend.id }];
    setText(newText);
    setSuggestions([]);
    setQuery(null);
    const cursor = (before + insert).length;
    setSelection({ start: cursor, end: cursor });
    emit(newText, mentionsRef.current);
  }

  const showDropdown = !!query && (loading || suggestions.length > 0);

  return (
    <View style={[styles.wrap, containerStyle]}>
      {showDropdown ? (
        <View style={styles.dropdown}>
          {loading && suggestions.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={Colors.orange} />
            </View>
          ) : (
            suggestions.map((f) => (
              <Pressable key={f.id} style={styles.row} onPress={() => pick(f)}>
                <Avatar uri={f.avatarUrl} name={displayNameOf(f)} size={30} borderColor={Colors.orange} />
                <Text style={styles.name} numberOfLines={1}>
                  {displayNameOf(f)}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
      <TextInput
        ref={inputRef}
        value={text}
        onChangeText={handleChange}
        selection={selection}
        onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
        style={style}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  dropdown: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: 6,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    overflow: 'hidden',
    maxHeight: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  loadingRow: { paddingVertical: Spacing.md, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.tan100,
  },
  name: { flex: 1, fontSize: Typography.sizes.sm, fontWeight: '600', color: Colors.brown },
});
