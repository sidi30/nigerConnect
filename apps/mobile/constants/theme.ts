export const Colors = {
  orange: '#E05206',
  green: '#0DB02B',
  cream: '#FDFBF7',
  brown: '#1A0F0A',
  white: '#FFFFFF',
  black: '#000000',

  gray50: '#F9F7F4',
  gray100: '#F0EDE8',
  gray200: '#E5E0D8',
  gray300: '#C9C3B8',
  gray400: '#8A8578',
  gray500: '#5C5749',
  gray600: '#3D382C',

  success: '#0DB02B',
  warning: '#F5A524',
  danger: '#E5484D',
} as const;

export const Radii = {
  sm: 8,
  md: 14,
  lg: 18,
  xl: 24,
  full: 9999,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Typography = {
  fontFamily: {
    regular: 'DMSans_400Regular',
    medium: 'DMSans_500Medium',
    bold: 'DMSans_700Bold',
  },
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    xxxl: 34,
  },
} as const;

export const Shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;
