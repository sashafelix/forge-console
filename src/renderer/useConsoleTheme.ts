import { useEffect, useState } from 'react';

const KEY = 'forge-console.cockpit-theme';
const CHANGE_EVENT = 'forge-console:theme-changed';
type Theme = 'system' | 'light' | 'dark';
function isTheme(value: unknown): value is Theme { return value === 'system' || value === 'light' || value === 'dark'; }
function savedTheme(): Theme {
  try { const value = localStorage.getItem(KEY); return isTheme(value) ? value : 'system'; }
  catch { return 'system'; }
}

/** Sync mounted pages as well as remembering the theme between app launches. */
export function useConsoleTheme(): [Theme, (theme: string) => void] {
  const [theme, updateTheme] = useState<Theme>(savedTheme);
  useEffect(() => {
    const changed = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (isTheme(next)) updateTheme(next);
    };
    const stored = (event: StorageEvent) => { if (event.key === KEY || event.key === null) updateTheme(savedTheme()); };
    window.addEventListener(CHANGE_EVENT, changed);
    window.addEventListener('storage', stored);
    return () => { window.removeEventListener(CHANGE_EVENT, changed); window.removeEventListener('storage', stored); };
  }, []);
  return [theme, (next) => {
    if (!isTheme(next)) return;
    updateTheme(next);
    try { localStorage.setItem(KEY, next); } catch { /* Remain usable without persistent storage. */ }
    window.dispatchEvent(new window.CustomEvent(CHANGE_EVENT, { detail: next }));
  }];
}
