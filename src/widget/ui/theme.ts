// The page widget's look as Settings → Appearance says: light or dark (the system's, as it changes),
// the theme's palette for that mode and the accent (look/palette), and the bubble's look as Settings →
// Bubble says (widget/bubble-face): its face, its color, how it thinks; and how its actions unfold
// (widget/actions-look). Read from the widget's own key (storage/keys WIDGET_SETTINGS_KEY), never the
// settings themselves.
import { storageGet } from '../../storage/area';
import type { WidgetSettings } from '../../storage/settings';
import { isDarkMode, lookVars, setLookVars } from '../../look/palette';
import { actionsLook, setActionsLook } from '../actions-look';
import { drawBubbleFace, setBubbleColor } from '../bubble-face';
import { WIDGET_SETTINGS_KEY } from '../../storage/keys';
import type { WidgetState } from './state';

// `others`: the floating chat's host and the toolbar's beside a selection, themed as the bubble is.
// `onFace`: the face was drawn again (its hat may need room, its eyes may follow the pointer).
// `signal`: the widget gone from the page, it no longer follows the system's mode.
export function createTheme(s: WidgetState, others: () => (HTMLElement | undefined)[], onFace: () => void, signal: AbortSignal) {
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    const isDark = isDarkMode(s.appearance, dark.matches);
    for (const h of [s.host, ...others()]) {
      if (!h) continue;
      h.dataset.theme = isDark ? 'dark' : 'light';
      setLookVars(h, lookVars(s.appearance, isDark));
    }
    if (s.host) setBubbleColor(s.host, s.appearance?.bubbleColor);
    if (s.menu) setActionsLook(s.menu, actionsLook(s.appearance));
  };
  const showFace = () => {
    if (!s.face) return;
    s.drawn = drawBubbleFace(s.bubble, s.face, s.appearance);
    onFace();
  };
  const loadTheme = async () => {
    const settings = await storageGet<WidgetSettings>('local', WIDGET_SETTINGS_KEY);
    s.appearance = settings?.appearance;
    s.chatWindow = settings?.chatWindow;
    s.noFloating = settings?.noFloating;
    s.speakButton = settings?.speakButton;
    s.speakBoxes = settings?.speakBoxes;
    s.canSpeak = settings?.canSpeak;
    s.pieceSizes = settings?.pieceSizes;
    applyTheme();
    showFace();
  };
  dark.addEventListener('change', applyTheme, { signal });
  return { apply: applyTheme, showFace, load: loadTheme };
}
