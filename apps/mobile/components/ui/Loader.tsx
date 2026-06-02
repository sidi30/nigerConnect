import { ActivityIndicator, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/constants/theme-provider';

interface Props {
  /** Indicator size. Defaults to 'large'. */
  size?: 'small' | 'large';
  /** Indicator color. Defaults to the theme accent color. */
  color?: string;
  /** When true, fills the available space and centers the indicator (flex:1). */
  fullScreen?: boolean;
  /** Style passthrough, merged after the variant style. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Generic loading indicator for the app.
 *
 * - Default variant: a centered indicator with a top margin (the dominant
 *   inline-loading pattern across screens).
 * - `fullScreen`: a flex:1 container that centers the indicator.
 */
export function Loader({ size = 'large', color, fullScreen, style }: Props) {
  const theme = useTheme();
  const indicatorColor = color ?? theme.colors.accent.primary;

  return (
    <View style={[fullScreen ? styles.fullScreen : styles.inline, style]}>
      <ActivityIndicator size={size} color={indicatorColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  inline: {
    marginTop: Spacing.xxl,
  },
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
