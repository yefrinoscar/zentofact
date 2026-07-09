export type AppTheme = 'light' | 'dark';

const THEME_KEY = 'zentofact.theme';

function isTheme(value: string | null): value is AppTheme {
  return value === 'light' || value === 'dark';
}

export function getStoredTheme(): AppTheme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_KEY);
  return isTheme(stored) ? stored : 'light';
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export function setStoredTheme(theme: AppTheme) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}
