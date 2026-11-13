import { useEffect, useRef } from 'react';
import type { Appearance } from '../../storage/settings-types';
import { drawBubbleFace, setBubbleColor, type BubbleFace } from '../../widget/bubble-face';
import { actionsLook, placeActions, setActionsLook } from '../../widget/actions-look';
import { bubbleLook, lookOffset } from '../../widget/bubble-look';
import { actLabel } from '../../widget/ui/dom';
import { BUBBLE, STYLE } from '../../widget/ui/style';
import { useSystemDark } from '../appearance';
import { isDarkMode, lookVars, setLookVars } from '../../look/palette';
import { BUBBLE_KEYS } from '../themes/theme-model';
import { useReducedMotion } from './useReducedMotion';

// The bubble's own fields (those a theme carries) as one string, to tell when they change: the
// settings give a new object on every change of anything.
export const bubbleKey = (look: Appearance) => JSON.stringify(BUBBLE_KEYS.map((k) => look[k]));

const WORKING_MS = 4000; // the preview shows how it works this long after that option changes

// Three actions to show unfolded (Settings → Bubble → Actions).
const SAMPLES = [['📝', 'Summarize'], ['🌐', 'Translate'], ['🔎', 'Search']] as const;
const STAGE = 240; // px, square: room for them all, however they unfold
const INSET = 12; // px: the bubble in its lower right corner, as on a page (a ring: in its middle)

// The sample actions in the widget's own markup (widget/ui/card).
function sampleMenu() {
  const menu = document.createElement('div');
  menu.className = 'menu';
  for (const [icon, name] of SAMPLES) {
    const b = Object.assign(document.createElement('button'), { className: 'act', type: 'button', title: name, tabIndex: -1 });
    b.append(...actLabel(icon, name));
    menu.append(b);
  }
  return menu;
}

// The bubble as the pages show it: the widget's own style and face, in a shadow root; working for a
// moment when "While it works" changes; its eyes following the pointer here too (unless the system
// asks for reduced motion, as on the pages). With `actions`, three sample actions unfolded beside it
// as Settings → Bubble → Actions says.
export function BubblePreview({ look, actions = false }: { look: Appearance; actions?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<HTMLDivElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const drawn = useRef<BubbleFace | null>(null);
  useEffect(() => {
    const host = ref.current!;
    if (host.shadowRoot) return; // drawn already (React runs effects twice in development)
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const b = document.createElement('div');
    b.className = 'bubble';
    b.append(Object.assign(document.createElement('span'), { className: 'face' }));
    // Where the bubble is, as the widget's host is on a page: its actions unfold from there.
    const a = document.createElement('div');
    a.className = 'anchor';
    a.append(b);
    if (actions) a.append((menu.current = sampleMenu()));
    root.append(style, a);
    bubble.current = b;
    anchor.current = a;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- built once: `actions` stays as the preview was made
  }, []);
  const actionsFor = JSON.stringify(actionsLook(look));
  useEffect(() => {
    const m = menu.current;
    if (!m) return;
    const chosen = actionsLook(look);
    const at = chosen.layout === 'ring' ? (STAGE - BUBBLE) / 2 : STAGE - BUBBLE - INSET;
    Object.assign(ref.current!.style, { position: 'relative', display: 'block', width: `${STAGE}px`, height: `${STAGE}px`, padding: '0' });
    Object.assign(anchor.current!.style, { position: 'absolute', left: `${at}px`, top: `${at}px`, width: `${BUBBLE}px`, height: `${BUBBLE}px` });
    setActionsLook(m, chosen);
    placeActions(m, chosen, { x: at, y: at }, { width: STAGE, height: STAGE }, BUBBLE);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the actions' look by its values: a new object on every change of the settings
  }, [actionsFor]);
  const systemDark = useSystemDark();
  const dark = isDarkMode(look, systemDark);
  const vars = lookVars(look, dark);
  const varsKey = JSON.stringify(vars);
  useEffect(() => {
    const host = ref.current!;
    host.dataset.theme = dark ? 'dark' : 'light';
    setLookVars(host, vars);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the variables by their values: a new object on every render
  }, [varsKey, dark]);
  // Drawn again (its animations starting over) only when the bubble's own fields change.
  const drawnFor = bubbleKey(look);
  useEffect(() => {
    const host = ref.current!;
    const b = bubble.current!;
    setBubbleColor(host, look.bubbleColor);
    const face = (drawn.current = drawBubbleFace(b, b.querySelector('.face')!, look));
    if (!menu.current) host.style.paddingTop = `${face.overhang}px`; // with actions, the stage has room
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the look by its bubble fields: a new object on every change of the settings
  }, [drawnFor]);
  const thinking = useRef(look.bubbleThinking);
  useEffect(() => {
    if (thinking.current === look.bubbleThinking) return; // not when it first shows
    thinking.current = look.bubbleThinking;
    const b = bubble.current!;
    b.classList.add('working');
    const timer = setTimeout(() => b.classList.remove('working'), WORKING_MS);
    return () => {
      clearTimeout(timer);
      b.classList.remove('working');
    };
  }, [look.bubbleThinking]);
  const reduced = useReducedMotion();
  const follows = bubbleLook(look).follows && !reduced;
  useEffect(() => {
    if (!follows) return;
    const host = ref.current!;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = bubble.current!.getBoundingClientRect();
        const { x, y } = lookOffset(e.clientX - (box.left + BUBBLE / 2), e.clientY - (box.top + (drawn.current?.eyesY ?? BUBBLE / 2)));
        host.style.setProperty('--lx', x.toFixed(2));
        host.style.setProperty('--ly', y.toFixed(2));
      });
    };
    addEventListener('pointermove', move, { passive: true });
    return () => {
      removeEventListener('pointermove', move);
      cancelAnimationFrame(frame);
      host.style.removeProperty('--lx');
      host.style.removeProperty('--ly');
    };
  }, [follows]);
  return (
    <div className="bubble-preview">
      <div ref={ref} className="bubble-preview-host" />
      <span className="hint">Preview</span>
    </div>
  );
}
