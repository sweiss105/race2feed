/**
 * The console's Appearance preference: Automatic (follow the device), Light or Dark.
 * Kept per browser in localStorage; tokens.css reads the `theme-light` / `theme-dark` class on <html>.
 */
export type Theme = 'auto' | 'light' | 'dark';

export const THEME_KEY = 'prc.theme';

function defaultStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

function defaultRoot(): HTMLElement | undefined {
  return typeof document === 'undefined' ? undefined : document.documentElement;
}

/** The stored preference; anything missing, unknown or unreadable is `auto`. */
export function getTheme(storage: Storage | undefined = defaultStorage()): Theme {
  try {
    const v = storage?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function applyClass(theme: Theme, root: HTMLElement | undefined) {
  if (!root) return;
  root.classList.toggle('theme-light', theme === 'light');
  root.classList.toggle('theme-dark', theme === 'dark');
}

/** Remembers the choice (if storage allows) and applies it to the page at once. */
export function setTheme(theme: Theme, storage: Storage | undefined = defaultStorage(), root: HTMLElement | undefined = defaultRoot()) {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch { /* blocked storage: the choice lasts until the page reloads */ }
  applyClass(theme, root);
}

/** Applies the stored preference; call before the first render. */
export function applyTheme(storage: Storage | undefined = defaultStorage(), root: HTMLElement | undefined = defaultRoot()) {
  applyClass(getTheme(storage), root);
}
