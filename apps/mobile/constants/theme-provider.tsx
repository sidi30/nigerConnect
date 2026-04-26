import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { darkTheme, defaultTheme, lightTheme, type Theme } from './theme';

type ThemeName = Theme['name'];

interface ThemeContextValue {
  theme: Theme;
  themeName: ThemeName;
  setThemeName: (name: ThemeName) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface Props {
  children: ReactNode;
  /** Preferred initial theme. Defaults to "light". */
  initial?: ThemeName;
}

export function ThemeProvider({ children, initial = defaultTheme.name }: Props) {
  const [themeName, setThemeName] = useState<ThemeName>(initial);

  const value = useMemo<ThemeContextValue>(() => {
    const theme = themeName === 'dark' ? darkTheme : lightTheme;
    return {
      theme,
      themeName,
      setThemeName,
      toggle: () => setThemeName((n) => (n === 'dark' ? 'light' : 'dark')),
    };
  }, [themeName]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Access the active theme. Safe to call outside the provider (returns the light default) —
 * but this should only happen in tests; in app code, always render under <ThemeProvider>.
 */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  return ctx?.theme ?? defaultTheme;
}

export function useThemeControls(): Omit<ThemeContextValue, 'theme'> {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeControls must be used within <ThemeProvider>');
  }
  const { theme: _ignored, ...rest } = ctx;
  return rest;
}
