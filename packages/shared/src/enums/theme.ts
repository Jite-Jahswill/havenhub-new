export const ThemePreference = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const;

export type ThemePreference = (typeof ThemePreference)[keyof typeof ThemePreference];
