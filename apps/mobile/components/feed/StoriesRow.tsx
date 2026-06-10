import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import type { PublicUser } from '@nigerconnect/shared-types';

interface StoryGroup {
  author: PublicUser;
  stories: Array<{ id: string; createdAt: string }>;
}

interface Props {
  storyGroups?: StoryGroup[];
  onCreate?: () => void;
  onOpen?: (authorId: string) => void;
}

export function StoriesRow({ storyGroups = [], onCreate, onOpen }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
    >
      <Pressable onPress={onCreate} style={styles.item}>
        <View style={styles.myStory}>
          <Feather name="plus" size={24} color={Colors.orange} />
        </View>
        <Text style={styles.label}>Ma story</Text>
      </Pressable>
      {storyGroups.map((g) => (
        <Pressable key={g.author.id} onPress={() => onOpen?.(g.author.id)} style={styles.item}>
          <LinearGradient
            colors={Gradients.story}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.storyRing}
          >
            {g.author.avatarUrl ? (
              <Image
                source={{ uri: g.author.avatarUrl }}
                style={styles.storyImg}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.storyImg, styles.storyFallback]}>
                <Text style={styles.storyInitials}>
                  {(g.author.displayName ?? '?').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
          </LinearGradient>
          <Text style={styles.label} numberOfLines={1}>
            {(g.author.displayName ?? g.author.firstName ?? '').split(' ')[0]}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.lg, gap: Spacing.md, paddingVertical: Spacing.md },
  item: { alignItems: 'center', width: 68 },
  myStory: {
    width: 58,
    height: 58,
    borderRadius: Radii.xl,
    borderWidth: 2.5,
    borderColor: Colors.orange,
    borderStyle: 'dashed',
    backgroundColor: Colors.peach50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyRing: { width: 60, height: 60, borderRadius: Radii.xl, padding: 2.5 },
  storyImg: {
    width: '100%',
    height: '100%',
    borderRadius: Radii.lg,
    borderWidth: 2.5,
    borderColor: Colors.cream,
    overflow: 'hidden',
  },
  storyFallback: { backgroundColor: Colors.tan100, alignItems: 'center', justifyContent: 'center' },
  storyInitials: { color: Colors.orange, fontSize: 18, fontWeight: '800' },
  label: {
    fontSize: Typography.sizes.xxs,
    marginTop: 4,
    fontWeight: '600',
    color: Colors.tan500,
    maxWidth: 64,
  },
});
