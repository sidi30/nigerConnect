import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Avatar } from '../ui/Avatar';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId } from '@/constants/lookups';
import type { FriendRequest } from '@/services/friendsApi';

interface Props {
  requests: FriendRequest[];
  onAccept?: (friendshipId: string) => void;
  onDecline?: (friendshipId: string) => void;
}

export function FriendRequestsBanner({ requests, onAccept, onDecline }: Props) {
  if (requests.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Feather name="user-plus" size={15} color={Colors.orange} />
        <Text style={styles.title}>Demandes d&apos;amitié ({requests.length})</Text>
      </View>
      {requests.map((r) => {
        const p = r.requester;
        return (
          <View key={r.id} style={styles.row}>
            <Avatar
              uri={p.avatarUrl}
              name={p.displayName ?? p.firstName ?? 'N'}
              size={42}
              borderColor={colorForId(p.id)}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {p.displayName ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {p.city ? `${p.city} · ` : ''}
                {p.countryCode ?? ''}
              </Text>
            </View>
            <Pressable
              onPress={() => onAccept?.(r.id)}
              style={({ pressed }) => [styles.accept, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.acceptLabel}>Accepter</Text>
            </Pressable>
            <Pressable
              onPress={() => onDecline?.(r.id)}
              style={({ pressed }) => [styles.decline, pressed && { opacity: 0.85 }]}
            >
              <Feather name="x" size={16} color={Colors.tan500} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    backgroundColor: Colors.peach50,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.peach100,
    padding: Spacing.md + 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
    color: Colors.orange,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md - 2, marginBottom: Spacing.sm },
  name: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.brown },
  meta: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 2 },
  accept: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 7,
    borderRadius: Radii.md,
    backgroundColor: Colors.orange,
  },
  acceptLabel: { color: Colors.white, fontSize: Typography.sizes.sm - 1, fontWeight: '700' },
  decline: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
});
