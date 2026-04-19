import { StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing, Typography } from '@/constants/theme';

export default function FeedTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fil d&apos;actualité</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: Typography.sizes.xl,
    color: Colors.brown,
    padding: Spacing.lg,
  },
});
