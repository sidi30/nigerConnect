/**
 * NigerConnect design system — single source of truth.
 *
 * Architecture :
 *   `palette` ────── raw brand values (change here to re-skin the app).
 *   `Spacing/Radii/Typography/Shadows` ─ primitives (layout tokens).
 *   `lightTheme` / `darkTheme` ───── semantic tokens (what a component consumes).
 *   `useTheme()` (see theme-provider.tsx) ─── runtime access, enables dark mode later.
 *
 * Rule for components :
 *   - Prefer `useTheme()` + semantic tokens (`theme.colors.text.primary`,
 *     `theme.feedback.error.bg`) so the app can be re-themed without rewriting screens.
 *   - Fall back to named brand colors (`Colors.orange`) only when the semantic meaning
 *     is literally "the brand orange".
 *   - Never hard-code hex values in a component.
 */

export const palette = {
  // ── Brand ────────────────────────────────────────────────
  orange: '#E05206',
  orangeBright: '#FF6D00',
  orangeLight: '#FF8A50',
  green: '#0DB02B',
  greenSoft: '#E8F5E9',
  greenDark: '#2E7D32',
  greenFresh: '#4CAF50',

  // ── Neutrals (warm "tan" for the cream theme, cool "gray" reserve) ─
  cream: '#FDFBF7',
  brown: '#1A0F0A',
  brownSoft: '#2D1810',
  white: '#FFFFFF',
  black: '#000000',

  tan50: '#F8F3EB',
  tan100: '#F5EDE0',
  tan200: '#F0E6D6',
  tan300: '#E8E0D4',
  tan400: '#C4B8A6',
  tan500: '#8B7355',
  tan600: '#5D4E37',

  gray50: '#F9F7F4',
  gray100: '#F0EDE8',
  gray200: '#E5E0D8',
  gray300: '#C9C3B8',
  gray400: '#8A8578',
  gray500: '#5C5749',
  gray600: '#3D382C',

  // ── Status / feedback ────────────────────────────────────
  warning: '#F57F17',
  warningSoft: '#FFF3E0',
  warningDark: '#E65100',
  danger: '#D32F2F',
  dangerMuted: '#E57373',
  dangerSoft: '#FFEBEE',
  info: '#1565C0',
  infoSoft: '#E3F2FD',
  purple: '#7B1FA2',
  purpleSoft: '#F3E5F5',
  yellow: '#F57F17',
  yellowSoft: '#FFF8E1',

  // ── Accent fills ─────────────────────────────────────────
  peach50: '#FFF5F0',
  peach100: '#FFDCC8',

  // ── Error / success banner skins (feedback inline) ───────
  errorBg: '#FFE8E0',
  errorBorder: '#F6B8A1',
  errorText: '#8A2B0F',
  successBg: '#E4F5E8',
  successBorder: '#A7D8B3',
  successText: '#1F6F2E',

  // ── Overlays ─────────────────────────────────────────────
  overlayDark: 'rgba(0,0,0,0.6)',
  overlayMedium: 'rgba(0,0,0,0.5)',
  overlayLight: 'rgba(0,0,0,0.1)',
  whiteAlpha90: 'rgba(255,255,255,0.9)',
  whiteAlpha70: 'rgba(255,255,255,0.7)',
  whiteAlpha60: 'rgba(255,255,255,0.6)',
  whiteAlpha50: 'rgba(255,255,255,0.5)',
  whiteAlpha40: 'rgba(255,255,255,0.4)',
  whiteAlpha30: 'rgba(255,255,255,0.3)',
  whiteAlpha25: 'rgba(255,255,255,0.25)',
  whiteAlpha15: 'rgba(255,255,255,0.15)',
  whiteAlpha10: 'rgba(255,255,255,0.1)',
  whiteAlpha06: 'rgba(255,255,255,0.06)',
  orangeShadow: 'rgba(224,82,6,0.15)',
} as const;

/**
 * Backwards-compatible `Colors` alias.
 * Keep this as long as legacy screens import it — new code should prefer `useTheme()`.
 */
export const Colors = {
  ...palette,
  success: palette.green,
  successSoft: palette.greenSoft,
  successDark: palette.greenDark,
} as const;

// ── Primitives (layout tokens, platform-neutral) ──────────────

export const Radii = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
  xxl: 22,
  full: 9999,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
} as const;

export const Typography = {
  fontFamily: {
    regular: 'DMSans_400Regular',
    medium: 'DMSans_500Medium',
    semibold: 'DMSans_600SemiBold',
    bold: 'DMSans_700Bold',
    extrabold: 'DMSans_800ExtraBold',
    serif: 'PlayfairDisplay_700Bold',
    serifBold: 'PlayfairDisplay_800ExtraBold',
    serifBlack: 'PlayfairDisplay_900Black',
  },
  sizes: {
    xxs: 10,
    xs: 11,
    sm: 13,
    md: 14,
    lg: 16,
    xl: 18,
    xxl: 22,
    display: 28,
    hero: 34,
  },
} as const;

export const Shadows = {
  sm: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  orange: {
    shadowColor: palette.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
} as const;

export const Gradients = {
  orange: [palette.orange, palette.orangeBright] as const,
  orangeLight: [palette.orange, palette.orangeLight] as const,
  dark: ['#0A1628', palette.brown, palette.brownSoft] as const,
  story: [palette.orange, palette.orangeBright, palette.green] as const,
} as const;

// ── Semantic theme (what components should consume via useTheme()) ─

export interface Theme {
  name: 'light' | 'dark';
  colors: {
    background: { primary: string; secondary: string; elevated: string; inverse: string };
    surface: { primary: string; subtle: string; raised: string };
    border: { primary: string; strong: string; focus: string };
    text: { primary: string; secondary: string; muted: string; inverse: string; link: string };
    accent: { primary: string; secondaryStart: string; secondaryEnd: string };
    overlay: { dark: string; medium: string; light: string };
  };
  feedback: {
    success: { bg: string; border: string; text: string; strong: string };
    error: { bg: string; border: string; text: string; strong: string };
    warning: { bg: string; border: string; text: string; strong: string };
    info: { bg: string; border: string; text: string; strong: string };
  };
  radii: typeof Radii;
  spacing: typeof Spacing;
  typography: typeof Typography;
  shadows: typeof Shadows;
  gradients: typeof Gradients;
}

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    background: {
      primary: palette.cream,
      secondary: palette.tan50,
      elevated: palette.white,
      inverse: palette.brown,
    },
    surface: { primary: palette.white, subtle: palette.tan100, raised: palette.peach50 },
    border: { primary: palette.tan200, strong: palette.tan300, focus: palette.orange },
    text: {
      primary: palette.brown,
      secondary: palette.tan600,
      muted: palette.tan500,
      inverse: palette.white,
      link: palette.orange,
    },
    accent: {
      primary: palette.orange,
      secondaryStart: palette.orange,
      secondaryEnd: palette.orangeBright,
    },
    overlay: {
      dark: palette.overlayDark,
      medium: palette.overlayMedium,
      light: palette.overlayLight,
    },
  },
  feedback: {
    success: {
      bg: palette.successBg,
      border: palette.successBorder,
      text: palette.successText,
      strong: palette.greenDark,
    },
    error: {
      bg: palette.errorBg,
      border: palette.errorBorder,
      text: palette.errorText,
      strong: palette.danger,
    },
    warning: {
      bg: palette.warningSoft,
      border: palette.warning,
      text: palette.warningDark,
      strong: palette.warning,
    },
    info: {
      bg: palette.infoSoft,
      border: palette.info,
      text: palette.info,
      strong: palette.info,
    },
  },
  radii: Radii,
  spacing: Spacing,
  typography: Typography,
  shadows: Shadows,
  gradients: Gradients,
};

export const darkTheme: Theme = {
  ...lightTheme,
  name: 'dark',
  colors: {
    background: {
      primary: palette.brown,
      secondary: palette.brownSoft,
      elevated: palette.gray600,
      inverse: palette.cream,
    },
    surface: {
      primary: palette.gray600,
      subtle: palette.brownSoft,
      raised: palette.whiteAlpha10,
    },
    border: {
      primary: palette.whiteAlpha15,
      strong: palette.whiteAlpha25,
      focus: palette.orangeLight,
    },
    text: {
      primary: palette.white,
      secondary: palette.whiteAlpha90,
      muted: palette.whiteAlpha60,
      inverse: palette.brown,
      link: palette.orangeLight,
    },
    accent: {
      primary: palette.orangeBright,
      secondaryStart: palette.orange,
      secondaryEnd: palette.orangeBright,
    },
    overlay: {
      dark: palette.overlayDark,
      medium: palette.overlayMedium,
      light: palette.whiteAlpha10,
    },
  },
};

export const defaultTheme = lightTheme;

// ── Domain lookups (non-visual — stay here for convenience) ──

export const Flags: Record<string, string> = {
  NE: '🇳🇪',
  FR: '🇫🇷',
  TR: '🇹🇷',
  MA: '🇲🇦',
  CN: '🇨🇳',
  US: '🇺🇸',
  CA: '🇨🇦',
  DE: '🇩🇪',
  BE: '🇧🇪',
  CI: '🇨🇮',
  SN: '🇸🇳',
  BJ: '🇧🇯',
  TG: '🇹🇬',
  SA: '🇸🇦',
  AE: '🇦🇪',
  GB: '🇬🇧',
};

export const CountryNames: Record<string, string> = {
  NE: 'Niger',
  FR: 'France',
  TR: 'Turquie',
  MA: 'Maroc',
  CN: 'Chine',
  US: 'États-Unis',
  CA: 'Canada',
  DE: 'Allemagne',
  BE: 'Belgique',
  CI: "Côte d'Ivoire",
  SN: 'Sénégal',
  BJ: 'Bénin',
  TG: 'Togo',
  SA: 'Arabie Saoudite',
  AE: 'Émirats',
  GB: 'Royaume-Uni',
};

export const PostBadges: Record<string, { bg: string; color: string; label: string }> = {
  entraide: { bg: palette.greenSoft, color: palette.greenDark, label: 'Entraide' },
  association: { bg: palette.infoSoft, color: palette.info, label: 'Association' },
  business: { bg: palette.yellowSoft, color: palette.yellow, label: 'Business' },
  accueil: { bg: palette.purpleSoft, color: palette.purple, label: 'Accueil' },
};
