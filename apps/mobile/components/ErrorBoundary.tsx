import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, palette, Radii, Spacing, Typography } from '@/constants/theme';

interface Props {
  children: ReactNode;
  /** Optional external reporter (Sentry, etc.). Receives the original error + componentStack. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/**
 * Root-level React error boundary — the last line of defense before a blank white screen.
 * It catches render-time errors in its child tree, renders a friendly fallback, and lets the
 * user retry without killing the process. Async errors (fetch, timers) are NOT caught here;
 * those should be surfaced via mutation states or global crash reporting.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>😕</Text>
          <Text style={styles.title}>Oups, un problème est survenu</Text>
          <Text style={styles.subtitle}>
            Pas d&apos;inquiétude, l&apos;équipe NigerConnect est notifiée. Tu peux réessayer en
            touchant le bouton ci-dessous.
          </Text>
          {__DEV__ ? (
            <View style={styles.debugBox}>
              <Text style={styles.debugLabel}>Détail (dev)</Text>
              <Text style={styles.debugText} selectable>
                {this.state.error.message}
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={this.reset}
            accessibilityRole="button"
            accessibilityLabel="Réessayer"
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.retryLabel}>Réessayer</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
    backgroundColor: Colors.cream,
    gap: Spacing.md,
  },
  emoji: { fontSize: 60 },
  title: {
    fontSize: Typography.sizes.xl,
    fontWeight: '800',
    color: Colors.brown,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  debugBox: {
    alignSelf: 'stretch',
    backgroundColor: palette.errorBg,
    borderWidth: 1,
    borderColor: palette.errorBorder,
    borderRadius: Radii.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  debugLabel: {
    fontSize: Typography.sizes.xxs,
    fontWeight: '800',
    color: palette.errorText,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  debugText: { fontSize: Typography.sizes.xs, color: palette.errorText, fontFamily: undefined },
  retry: {
    marginTop: Spacing.md,
    backgroundColor: Colors.orange,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    borderRadius: Radii.xl,
  },
  retryLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
});
