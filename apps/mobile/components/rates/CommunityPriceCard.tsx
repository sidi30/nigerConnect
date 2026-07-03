import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, Flags, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId, COMMUNITY_PRICE_TYPE_LABELS, relativeTime } from '@/constants/lookups';
import type { CommunityPrice } from '@nigerconnect/shared-types';

interface Props {
  price: CommunityPrice;
  isMine: boolean;
  voting: boolean;
  onVote: (value: 1 | -1) => void;
  onPressAuthor: () => void;
  onReport: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function routeLabel(price: CommunityPrice): string | null {
  const origin = [price.originCountry ? Flags[price.originCountry] : null, price.originCity]
    .filter(Boolean)
    .join(' ');
  const dest = [price.destCountry ? Flags[price.destCountry] : null, price.destCity]
    .filter(Boolean)
    .join(' ');
  if (!origin && !dest) return null;
  if (origin && dest) return `${origin} → ${dest}`;
  return origin || dest;
}

export function CommunityPriceCard({
  price,
  isMine,
  voting,
  onVote,
  onPressAuthor,
  onReport,
  onEdit,
  onDelete,
}: Props) {
  const author = price.submitter;
  const route = routeLabel(price);

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.typeTag}>{COMMUNITY_PRICE_TYPE_LABELS[price.type] ?? price.type}</Text>
        {!isMine ? (
          <Pressable onPress={onReport} hitSlop={8} accessibilityLabel="Signaler ce prix">
            <Feather name="flag" size={14} color={Colors.tan400} />
          </Pressable>
        ) : (
          <View style={styles.mineActions}>
            {onEdit ? (
              <Pressable onPress={onEdit} hitSlop={8} accessibilityLabel="Modifier">
                <Feather name="edit-2" size={14} color={Colors.tan500} />
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable onPress={onDelete} hitSlop={8} accessibilityLabel="Supprimer">
                <Feather name="trash-2" size={14} color={Colors.danger} />
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      <Text style={styles.amount}>
        {price.amount} {price.currency}
      </Text>
      {route ? <Text style={styles.route}>{route}</Text> : null}
      {price.provider ? <Text style={styles.provider}>{price.provider}</Text> : null}
      {price.note ? (
        <Text style={styles.note} numberOfLines={3}>
          {price.note}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <Pressable onPress={onPressAuthor} style={styles.authorRow} hitSlop={4}>
          <Avatar
            uri={author.avatarUrl}
            name={author.displayName ?? 'N'}
            size={26}
            borderColor={colorForId(author.id)}
          />
          <Text style={styles.authorName} numberOfLines={1}>
            {author.displayName} · {relativeTime(price.createdAt)}
          </Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <View style={styles.voteRow}>
          <Pressable
            onPress={() => onVote(1)}
            disabled={voting || isMine}
            style={[styles.voteBtn, price.myVote === 1 && styles.voteBtnActiveUp]}
            accessibilityLabel="Fiable"
          >
            <Feather
              name="thumbs-up"
              size={13}
              color={price.myVote === 1 ? Colors.success : Colors.tan500}
            />
          </Pressable>
          <Text style={styles.trustScore}>{price.trustScore}</Text>
          <Pressable
            onPress={() => onVote(-1)}
            disabled={voting || isMine}
            style={[styles.voteBtn, price.myVote === -1 && styles.voteBtnActiveDown]}
            accessibilityLabel="Pas fiable"
          >
            <Feather
              name="thumbs-down"
              size={13}
              color={price.myVote === -1 ? Colors.danger : Colors.tan500}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.md + 2,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md - 2,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mineActions: { flexDirection: 'row', gap: Spacing.md },
  typeTag: {
    fontSize: Typography.sizes.xxs,
    fontWeight: '700',
    color: Colors.tan600,
    backgroundColor: Colors.tan100,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  amount: {
    fontSize: Typography.sizes.lg,
    fontWeight: '800',
    color: Colors.brown,
    marginTop: 8,
  },
  route: { fontSize: Typography.sizes.sm, color: Colors.tan600, marginTop: 3, fontWeight: '600' },
  provider: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
  note: { fontSize: Typography.sizes.sm, color: Colors.tan600, marginTop: 6, lineHeight: 19 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.tan100,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  authorName: { fontSize: Typography.sizes.xxs, color: Colors.tan500, fontWeight: '600' },
  voteRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  voteBtn: {
    width: 30,
    height: 30,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.tan100,
  },
  voteBtnActiveUp: { backgroundColor: Colors.successSoft },
  voteBtnActiveDown: { backgroundColor: Colors.dangerSoft },
  trustScore: {
    fontSize: Typography.sizes.sm,
    fontWeight: '800',
    color: Colors.tan600,
    minWidth: 18,
    textAlign: 'center',
  },
});
