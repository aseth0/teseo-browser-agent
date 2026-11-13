// Ready-made color combinations for Settings → Appearance → Theme: an accent and the Layers
// highlight colors, or a palette for each mode (the mode, light or dark, is chosen apart). Choosing one
// sets those colors, which can then be changed one by one. Bold follows the accent (look/palette); a
// theme with an accent of its own has italic, inline code and the colors of what things are to go with
// it (themeColors).
import type { Origin } from '../../core/model-texts';
import type { ThemePalette } from '../../storage/settings-types';

interface ThemePreset {
  name: string;
  accent?: string; // none: each theme's own
  highlights?: Record<Origin, string>; // none: the defaults of ui/origins
  palette?: ThemePalette; // none: the tokens' own
  credit?: string; // whose colors they are, shown while it is chosen
}

// Flexoki, an inky color scheme for prose and code: https://stephango.com/flexoki
// Copyright (c) 2023 Steph Ango. MIT License: the above notice and this permission notice shall be
// included in all copies or substantial portions of the Software. Its paper and ink base, its orange
// as the accent, and its other accents for Markdown and code (600 in light, 400 in dark; code in Markdown 700 in light, for contrast); the tints
// (your messages, code's background) mix them with the paper.
const FLEXOKI_CREDIT = 'Flexoki by Steph Ango (stephango.com/flexoki), MIT license.';
const FLEXOKI: ThemePalette = {
  light: {
    bg: '#fffcf0', surface: '#f2f0e5', border: '#e6e4d9', fg: '#100f0f', muted: '#6f6e69', user: '#f7e8d6', accent: '#bc5215',
    'md-strong': '#bc5215', 'md-em': '#5e409d', 'md-code': '#1c6c66', 'md-code-bg': '#e9f0e4',
    'hl-keyword': '#66800b', 'hl-string': '#24837b', 'hl-number': '#5e409d', 'hl-comment': '#6f6e69', 'hl-title': '#bc5215', 'hl-attr': '#205ea6', 'hl-tag': '#ad8301',
    'c-page': '#ad8301', 'c-tool': '#24837b', 'c-model': '#5e409d', 'c-you': '#205ea6', 'c-known': '#66800b', 'c-system': '#6f6e69',
  },
  dark: {
    bg: '#100f0f', surface: '#1c1b1a', border: '#282726', fg: '#cecdc3', muted: '#878580', user: '#342014', accent: '#da702c',
    'md-strong': '#da702c', 'md-em': '#8b7ec8', 'md-code': '#3aa99f', 'md-code-bg': '#162625',
    'hl-keyword': '#879a39', 'hl-string': '#3aa99f', 'hl-number': '#8b7ec8', 'hl-comment': '#878580', 'hl-title': '#da702c', 'hl-attr': '#4385be', 'hl-tag': '#d0a215',
    'c-page': '#d0a215', 'c-tool': '#3aa99f', 'c-model': '#8b7ec8', 'c-you': '#4385be', 'c-known': '#879a39', 'c-system': '#878580',
  },
};

type Pair = [light: string, dark: string];
// What things are, one color each (ui/tokens.css --c-*): from a page, a tool, the model, you, what the
// extension knows, its fixed text. What changes things follows the accent (look/palette).
interface Kinds { page: Pair; tool: Pair; model: Pair; you: Pair; known: Pair; system: Pair }
// Italic, inline code and its background, and the colors of what things are, in light and in dark: the
// rest of a palette is the tokens' own.
const themeColors = (em: Pair, code: Pair, codeBg: Pair, kinds: Kinds): ThemePalette => {
  const mode = (i: 0 | 1) => ({
    'md-em': em[i], 'md-code': code[i], 'md-code-bg': codeBg[i],
    ...Object.fromEntries(Object.entries(kinds).map(([k, pair]) => [`c-${k}`, (pair as Pair)[i]])),
  });
  return { light: mode(0), dark: mode(1) };
};

export const THEME_PRESETS: ThemePreset[] = [
  { name: 'Default' },
  {
    name: 'Ocean',
    accent: '#0284c7',
    palette: themeColors(['#be185d', '#f9a8d4'], ['#0f766e', '#5eead4'], ['#e6f6f4', '#0f2e2b'], {
      page: ['#b45309', '#fbbf24'], tool: ['#0369a1', '#38bdf8'], model: ['#4f46e5', '#a5b4fc'], you: ['#0e7490', '#22d3ee'], known: ['#047857', '#34d399'], system: ['#64748b', '#94a3b8'],
    }),
    highlights: { page: '#fde047', template: '#fcd34d', skillValues: '#fef08a', tool: '#5eead4', message: '#7dd3fc', skill: '#6ee7b7', extension: '#cbd5e1', mcp: '#67e8f9', history: '#bef264', memory: '#86efac' },
  },
  {
    name: 'Forest',
    accent: '#15803d',
    palette: themeColors(['#a16207', '#fcd34d'], ['#1d4ed8', '#93c5fd'], ['#eaf0fe', '#172554'], {
      page: ['#a16207', '#facc15'], tool: ['#0f766e', '#2dd4bf'], model: ['#9a3412', '#fdba74'], you: ['#1d4ed8', '#93c5fd'], known: ['#15803d', '#86efac'], system: ['#57534e', '#a8a29e'],
    }),
    highlights: { page: '#eab308', template: '#d97706', skillValues: '#ca8a04', tool: '#0d9488', message: '#0ea5e9', skill: '#059669', extension: '#64748b', mcp: '#0891b2', history: '#65a30d', memory: '#16a34a' },
  },
  {
    name: 'Grape',
    accent: '#7c3aed',
    palette: themeColors(['#be185d', '#f9a8d4'], ['#0e7490', '#67e8f9'], ['#e6f3f5', '#10333a'], {
      page: ['#a16207', '#facc15'], tool: ['#0e7490', '#22d3ee'], model: ['#7c3aed', '#c4b5fd'], you: ['#be185d', '#f9a8d4'], known: ['#15803d', '#4ade80'], system: ['#64748b', '#94a3b8'],
    }),
  },
  {
    name: 'Rose',
    accent: '#e11d48',
    palette: themeColors(['#7c3aed', '#c4b5fd'], ['#0f766e', '#5eead4'], ['#e6f6f4', '#0f2e2b'], {
      page: ['#b45309', '#fcd34d'], tool: ['#be185d', '#f9a8d4'], model: ['#7c3aed', '#c4b5fd'], you: ['#e11d48', '#fda4af'], known: ['#0f766e', '#5eead4'], system: ['#6b7280', '#9ca3af'],
    }),
    highlights: { page: '#fbbf24', template: '#f59e0b', skillValues: '#fde047', tool: '#14b8a6', message: '#3b82f6', skill: '#10b981', extension: '#94a3b8', mcp: '#06b6d4', history: '#84cc16', memory: '#22c55e' },
  },
  { name: 'Flexoki', palette: FLEXOKI, credit: FLEXOKI_CREDIT },
  {
    name: 'High contrast',
    accent: '#2563eb',
    palette: themeColors(['#9d174d', '#f9a8d4'], ['#065f46', '#6ee7b7'], ['#ecfdf5', '#052e1f'], {
      page: ['#854d0e', '#fde047'], tool: ['#155e75', '#67e8f9'], model: ['#5b21b6', '#ddd6fe'], you: ['#1e40af', '#93c5fd'], known: ['#166534', '#86efac'], system: ['#374151', '#d1d5db'],
    }),
    highlights: { page: '#ffd400', template: '#ffaa00', skillValues: '#fff176', tool: '#00e5c8', message: '#00b3ff', skill: '#00e5a0', extension: '#b0bec5', mcp: '#00ffff', history: '#aeea00', memory: '#39ff14' },
  },
];
