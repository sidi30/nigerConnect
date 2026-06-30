/**
 * ReactionBar — Facebook/Instagram-style reaction picker. Long-press the like
 * button to pop a row of quick reactions (each bounces in with a stagger), with
 * a "+" that opens the full emoji keyboard (rn-emoji-keyboard) so any emoji can
 * be used — a step beyond IG/FB's fixed set.
 *
 * Pure JS (reanimated + rn-emoji-keyboard) → OTA-safe.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { ZoomIn } from 'react-native-reanimated';
import EmojiPicker from 'rn-emoji-keyboard';
import { Colors, Radii, Spacing } from '@/constants/theme';

const QUICK = ['❤️', '😂', '😮', '😢', '🙏', '👏'];

interface Props {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function ReactionBar({ visible, onSelect, onClose }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function pick(emoji: string) {
    onSelect(emoji);
    onClose();
  }

  return (
    <>
      {visible ? (
        <>
          {/* Tap-outside catcher to dismiss the bar. */}
          <Pressable style={styles.backdrop} onPress={onClose} />
          <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.bar}>
            {QUICK.map((e, i) => (
              <Animated.View key={e} entering={ZoomIn.delay(i * 35).springify().damping(12)}>
                <Pressable hitSlop={4} onPress={() => pick(e)} style={styles.emojiBtn}>
                  <Text style={styles.emoji}>{e}</Text>
                </Pressable>
              </Animated.View>
            ))}
            <Pressable hitSlop={4} onPress={() => setPickerOpen(true)} style={styles.plusBtn}>
              <Feather name="plus" size={18} color={Colors.tan600} />
            </Pressable>
          </Animated.View>
        </>
      ) : null}

      <EmojiPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          onClose();
        }}
        onEmojiSelected={(e) => {
          setPickerOpen(false);
          pick(e.emoji);
        }}
        enableSearchBar
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: -1000,
    bottom: -1000,
    left: -1000,
    right: -1000,
    zIndex: 40,
  },
  bar: {
    position: 'absolute',
    bottom: 34,
    left: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    backgroundColor: Colors.white,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.tan200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 10,
  },
  emojiBtn: { paddingHorizontal: 3 },
  emoji: { fontSize: 28 },
  plusBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.tan100,
    marginLeft: 2,
  },
});
