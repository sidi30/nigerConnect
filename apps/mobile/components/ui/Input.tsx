import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({ label, error, style, ...rest }: Props) {
  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        placeholderTextColor={Colors.gray400}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  label: {
    fontSize: Typography.sizes.sm,
    color: Colors.gray600,
    marginBottom: Spacing.xs,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    backgroundColor: Colors.white,
  },
  inputError: { borderColor: Colors.danger },
  errorText: {
    color: Colors.danger,
    fontSize: Typography.sizes.xs,
    marginTop: Spacing.xs,
  },
});
