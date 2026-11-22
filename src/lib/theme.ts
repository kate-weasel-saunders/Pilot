/**
 * Appearance preference (per device): follow the system, or force light/dark.
 * Stored in localStorage as a convenience; if storage is unavailable the app
 * simply follows the system.
 */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'pilot-theme';
const THEME_COLOURS = { light: '#fbf3e8', dark: '#1a1511' };

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  // Keep the browser/status-bar colour in step with the chosen theme.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') ?? '';
    const own = media.includes('dark') ? THEME_COLOURS.dark : THEME_COLOURS.light;
    meta.content = pref === 'system' ? own : THEME_COLOURS[pref];
  }
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
  applyTheme(pref);
}
