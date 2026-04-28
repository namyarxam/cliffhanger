import { createContext, useContext, useEffect, useState, useMemo, useCallback, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  THEMES,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemeName,
} from '@/src/lib/theme';
import { silentCatch } from '@/src/lib/errorLog';

interface ThemeControl {
  theme: Theme;
  themeName: ThemeName;
  setThemeName: (name: ThemeName) => void;
  // false until the AsyncStorage read resolves; lets the root layout block
  // its first paint to avoid a flash of the default palette before the
  // user's saved choice loads.
  ready: boolean;
}

const ThemeContext = createContext<ThemeControl>({
  theme: THEMES[DEFAULT_THEME],
  themeName: DEFAULT_THEME,
  setThemeName: () => {},
  ready: false,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState<ThemeName>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then(saved => {
        if (saved && saved in THEMES) setThemeNameState(saved as ThemeName);
      })
      .catch(silentCatch('theme:load'))
      .finally(() => setReady(true));
  }, []);

  const setThemeName = useCallback((name: ThemeName) => {
    if (!(name in THEMES)) return;
    setThemeNameState(name);
    AsyncStorage.setItem(THEME_STORAGE_KEY, name).catch(silentCatch('theme:save'));
  }, []);

  const value = useMemo<ThemeControl>(() => ({
    theme: THEMES[themeName],
    themeName,
    setThemeName,
    ready,
  }), [themeName, setThemeName, ready]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemeControl(): ThemeControl {
  return useContext(ThemeContext);
}
