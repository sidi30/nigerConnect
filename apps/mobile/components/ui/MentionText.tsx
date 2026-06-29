import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { parseMentions } from '@/utils/mentions';
import { Colors } from '@/constants/theme';

interface Props {
  content: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/**
 * Renders post/comment/message text with `@[Name](uuid)` mention tokens shown as
 * highlighted, tappable names (→ the mentioned user's profile). Plain text when
 * there are no mentions (cheap fast-path).
 */
export function MentionText({ content, style, numberOfLines }: Props) {
  const router = useRouter();
  const parts = parseMentions(content);

  if (parts.length <= 1 && (parts[0]?.type ?? 'text') === 'text') {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {content}
      </Text>
    );
  }

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((p, i) =>
        p.type === 'mention' ? (
          <Text
            key={i}
            style={{ color: Colors.orange, fontWeight: '700' }}
            onPress={() => router.push(`/user/${p.userId}`)}
          >
            {p.text}
          </Text>
        ) : (
          <Text key={i}>{p.text}</Text>
        ),
      )}
    </Text>
  );
}
