// Applies Settings → Appearance to the page (side panel, options): the theme (data-theme on the
// root element, "system" following the OS as it changes), its palette for that mode and the accent
// (look/palette), and the Layers highlight colors (theirs, or the defaults of ui/origins).
import { useEffect, useState } from 'react';
import type { Appearance } from '../storage/settings-types';
import { ORIGINS } from './origins';
import { isDarkMode, lookVars, setLookVars } from '../look/palette';

const DARK = '(prefers-color-scheme: dark)';

export function applyAppearance(appearance: Appearance | undefined): void {
  const root = document.documentElement;
  const dark = isDarkMode(appearance, matchMedia(DARK).matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  // The accent also colors headings, list markers and quotes in Markdown.
  setLookVars(root, lookVars(appearance, dark));
  for (const { origin, color } of ORIGINS) root.style.setProperty(`--origin-${origin}`, appearance?.highlights?.[origin] ?? color);
}

export function useAppearance(appearance: Appearance | undefined): void {
  const key = JSON.stringify(appearance ?? {});
  useEffect(() => {
    applyAppearance(appearance);
    if ((appearance?.mode ?? 'system') !== 'system') return;
    const media = matchMedia(DARK);
    const onChange = () => applyAppearance(appearance);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content: the settings give a new object on every change
  }, [key]);
}

// Whether the system is dark now, following it as it changes: for what a page draws with a look
// (lookVars) besides the page itself.
export const useSystemDark = () => useMediaQuery(DARK);

// Whether a media query matches now, following it as it changes.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
