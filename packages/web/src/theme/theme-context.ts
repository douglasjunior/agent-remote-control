import { createContext, useContext } from 'react';


export type Theme = 'light' | 'dark' | 'system';

export const THEMES: readonly Theme[] = ['light', 'dark', 'system'];
export const THEME_STORAGE_KEY = 'arc.theme';

export type ThemeContextValue = {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}
