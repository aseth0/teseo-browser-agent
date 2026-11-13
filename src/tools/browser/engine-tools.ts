// The browser.* tools on the DevTools engine (Settings → Chromium DevTools on): the catalog lays them
// over the synthetic ones by name while the switch is on (engineToolsFor), plus hover and drag, which
// only the engine offers. Their descriptions say what the engine does.
import { browser } from 'wxt/browser';
import { text, type ActionOutcome } from '../../core/model-texts';
import type { ActionDetail, RunSettings, Tool, ToolContext, ToolResult } from '../../core/types';
import { hostOf } from '../../core/util';
import { requireEngine, withDebugger, type CdpMethod, type CdpSession } from '../../devtools/cdp';
import { maskSelectorsFor } from '../../devtools/mask-rules';
import { actOnPage, callPage, waitForLoad } from '../../page/bridge';
import type { PageAction } from '../../page/protocol';
import { devtoolsOn } from '../../storage/settings-select';
import { defineTool, fields, optBoolean, optFinite, optString } from '../define';
import { assertSameHost, engineInput, engineResult, IDLE_MOST_MS, located, networkIdle, startHost, textLanded, type Point } from './engine';
import { ENGINE_ONLY_TOOLS } from './engine-only';
import { KEYS, KEY_TEXT, MODIFIERS, modifierMask } from './keys';
import { SHOT_QUALITY, onTab, readTools, sizedShot } from './read-tools';
import { tabIdProp, tabOfArgs, targetTab } from './tab-target';
import { DIRECTIONS, afterAction, describeRef, direction, refMissing, refProp, typeDetails, typeSummary, watchClick, type ClickWatch } from './write-tools';


type Target = { tabId?: unknown; ref?: string };

// An engine action: its arguments read and checked, the card as the synthetic tools show it with
// "(real input)", and its run: real input, then the page. Real input does not reach a tab that is not
// shown: there the action is done with synthetic events (its `synthetic`) and the reply says so, or,
// without one, fails and says why. Never brought to the front: that is the user's.
function engineTool<A extends Target>(spec: {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required: string[];
  effect?: Tool['effect'];
  args: (a: Record<string, unknown>) => A;
  validate?: (a: A) => void; // before anything is done
  summary: (a: A, target: string, others: Record<string, string>) => string;
  otherRefs?: (a: A) => string[]; // more elements the card names (a drag's drop target)
  details?: (a: A) => ActionDetail[];
  // startWatch: with `watch`, right before the press (after the pointer moved over the element: what
  // hovering shows is not the click's)
  input: (a: A, tabId: number, ctx: ToolContext, startWatch: () => Promise<void>) => Promise<void>;
  outcome: (a: A) => ActionOutcome;
  synthetic?: (a: A) => PageAction | undefined; // the same action with synthetic events, for a tab not shown
  watch?: boolean; // a click: the reply says when it changed nothing
}): Tool {
  return defineTool({
    name: spec.name,
    description: spec.description,
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...spec.properties }, required: spec.required },
    ...refMissing(spec.required),
    source: 'browser',
    effect: spec.effect ?? 'write',
    via: 'devtools',
    args: (raw) => ({ ...spec.args(fields(raw)), tabId: fields(raw).tabId }),
    tabOf: (a) => tabOfArgs(a),
    describe: async (a, ctx) => {
      const tabId = targetTab(a, ctx);
      const target = a.ref ? await describeRef({ tabId, ref: a.ref }, ctx) : 'the page';
      const others = Object.fromEntries(await Promise.all((spec.otherRefs?.(a) ?? []).map(async (ref) => [ref, await describeRef({ tabId, ref }, ctx)] as const)));
      return { summary: `${spec.summary(a, target, others)} (real input)`, details: spec.details?.(a) };
    },
    run: async (a, ctx) => {
      spec.validate?.(a);
      await requireEngine(); // before the page is touched (a field cleared, an element focused)
      const tabId = targetTab(a, ctx);
      const { token, hidden } = await callPage(tabId, { op: 'input-start', host: await startHost(tabId, ctx) });
      let action: PageAction | undefined;
      let watch: ClickWatch | undefined;
      const startWatch = async () => {
        if (spec.watch && a.ref) watch = await watchClick(tabId, a.ref);
      };
      try {
        try {
          if (hidden) {
            action = spec.synthetic?.(a);
            if (!action) throw new Error(text('error.devtools_background'));
            await startWatch();
          } else {
            await spec.input(a, tabId, ctx, startWatch);
          }
        } finally {
          await callPage(tabId, { op: 'input-end', token }).catch(() => undefined);
        }
        if (!action) return await engineResult(tabId, spec.outcome(a), watch);
        const result = await afterAction(tabId, await actOnPage(tabId, action, ctx.approvedHost), watch);
        return result.type === 'text' ? { ...result, text: `${result.text}\n${text('result.devtools_synthetic')}` } : result;
      } finally {
        watch?.end();
      }
    },
  });
}

const focusEmulation = (s: CdpSession) => s.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const mouse = (s: CdpSession, params: Record<string, unknown>) => s.send('Input.dispatchMouseEvent', params);

// A real key: one of the table's, or a single character (typed with its text).
async function pressKey(s: CdpSession, key: string, modifiers: readonly string[]) {
  const mask = modifierMask(modifiers);
  if (Object.hasOwn(KEYS, key)) {
    const { code, vk } = KEYS[key]!;
    const base = { key, code, windowsVirtualKeyCode: vk, modifiers: mask };
    const typed = Object.hasOwn(KEY_TEXT, key) ? KEY_TEXT[key] : undefined;
    await s.send('Input.dispatchKeyEvent', typed ? { type: 'keyDown', ...base, text: typed } : { type: 'rawKeyDown', ...base });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    return;
  }
  await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key, modifiers: mask });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers: mask });
}

// The left button pressed at a point, then `rest` (it releases it): when `rest` fails (a time limit, the
// tab left the site), the button is released where the pointer is, best effort, so the page is not left
// with it held down.
async function pressed(s: CdpSession, from: { x: number; y: number }, rest: (at: { x: number; y: number }) => Promise<void>) {
  const at = { x: from.x, y: from.y };
  await mouse(s, { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  try {
    await rest(at);
  } catch (e) {
    await mouse(s, { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 }).catch(() => undefined);
    throw e;
  }
}

// The browser's focus for the page, if something else of the browser has it (see focusSpot): a real press
// on the field, then a moment for an editor to take in the caret it put. Before focus emulation.
async function takeFocus(s: CdpSession, tabId: number, target: { ref?: string; host: string }, check: () => Promise<void>) {
  const spot = await callPage(tabId, { op: 'focus-spot', ...target });
  if (!spot) return;
  await check();
  await mouse(s, { type: 'mouseMoved', ...spot });
  await pressed(s, spot, async () => {
    await check();
    await mouse(s, { type: 'mouseReleased', ...spot, button: 'left', buttons: 0, clickCount: 1 });
  });
  await callPage(tabId, { op: 'settle' });
}

// A real key the page must see: otherwise it went elsewhere, and saying it was pressed would be false. A
// key that took the page away has been seen, whatever is there now.
async function pressKeySeen(s: CdpSession, tabId: number, key: string, modifiers: readonly string[]) {
  const before = await callPage(tabId, { op: 'keys-seen' });
  await pressKey(s, key, modifiers);
  const after = await callPage(tabId, { op: 'keys-seen' }).catch(() => undefined);
  if (after === before) throw new Error('The key did not reach the page: it saw no key press. Click the field or the element with browser.click, then press it again.');
}

const isKey = (key: string) => Object.hasOwn(KEYS, key) || [...key].length === 1;

const DRAG_STEPS = 10;
const WHEEL_STEP = 0.8; // of the viewport or the element, as the synthetic scroll

function clickTool(): Tool {
  return engineTool({
    name: 'browser.click',
    description: 'Clicks an element by ref with real mouse input, as the user would.',
    properties: refProp,
    required: ['ref'],
    args: (a) => ({ ref: String(a.ref) }),
    summary: (_a, target) => `Click ${target}`,
    input: (a, tabId, ctx, startWatch) =>
      engineInput(tabId, ctx, {
        ref: a.ref,
        focus: false,
        send: async (s, at, check) => {
          const { x, y } = at!;
          await check();
          await mouse(s, { type: 'mouseMoved', x, y });
          await startWatch();
          await check();
          await pressed(s, { x, y }, async () => {
            await check();
            await mouse(s, { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
          });
        },
      }),
    outcome: () => ({ kind: 'click' }),
    synthetic: (a) => ({ kind: 'click', ref: a.ref }),
    watch: true,
  });
}

function typeTool(): Tool {
  return engineTool({
    name: 'browser.type',
    description: 'Types text into an element by ref with real input, replacing its value (clear=false: add to it; submit: press Enter after).',
    properties: { ...refProp, text: { type: 'string' }, clear: { type: 'boolean' }, submit: { type: 'boolean' } },
    required: ['ref', 'text'],
    args: (a) => ({ ref: String(a.ref), text: String(a.text), clear: optBoolean(a.clear), submit: optBoolean(a.submit) }),
    summary: (a, target) => typeSummary(a, target),
    details: (a) => typeDetails(a),
    input: (a, tabId, ctx) =>
      engineInput(tabId, ctx, {
        ref: a.ref,
        focus: false, // the page's clear or caret-end does, with the selection
        send: async (s, _at, check, host) => {
          await takeFocus(s, tabId, { ref: a.ref, host }, check);
          await focusEmulation(s);
          await check();
          // The value replaced, as the synthetic type does unless clear=false; only now, so that a field
          // real input cannot reach is left as it was.
          const field = a.clear === false ? await callPage(tabId, { op: 'caret-end', ref: a.ref, host }) : await callPage(tabId, { op: 'clear', ref: a.ref, host });
          // An editor takes the selection in a moment later, and a real delete acts on what it took in: on
          // the caret it had, one character (Slate). Text brings its own range, but one wrong edit loses the rest.
          if (field === 'selected') await callPage(tabId, { op: 'settle' });
          await check();
          if (a.text || field === 'selected') {
            const held = () => callPage(tabId, { op: 'field-text', ref: a.ref, host });
            const before = await held();
            if (a.text) await s.send('Input.insertText', { text: a.text });
            else await pressKey(s, 'Backspace', []);
            // Nothing is said to have been typed, or pressed after it, that did not reach the field. An
            // editor may take it in a moment later; a field gone from the page was changed by it.
            const landed = async () => {
              const now = await held().catch(() => undefined);
              return now === undefined || textLanded(before, now, a.text, a.clear !== false);
            };
            if (!(await landed()) && !(await callPage(tabId, { op: 'settle' }).then(landed))) {
              throw new Error('The text did not reach the field: it is unchanged, and nothing was pressed. Click the field with browser.click, then type again.');
            }
          }
          if (!a.submit) return;
          // An editor that keeps its own state takes the text in after the input: Enter once it has.
          await callPage(tabId, { op: 'settle' });
          await check();
          await pressKeySeen(s, tabId, 'Enter', []);
        },
      }),
    outcome: (a) => ({ kind: 'type', submit: a.submit }),
    synthetic: (a) => ({ kind: 'type', ref: a.ref, text: a.text, clear: a.clear, submit: a.submit }),
  });
}

function pressKeyTool(): Tool {
  return engineTool({
    name: 'browser.press_key',
    description:
      'Presses a real key (Enter, Tab, Escape, arrows, Home, End, PageUp/Down, Backspace, Delete, Space, or one character) on an element by ref, or on the focused element; with modifiers (Shift, Control, Alt, Meta) for shortcuts. The browser does what the key does.',
    properties: { ...refProp, key: { type: 'string' }, modifiers: { type: 'array', items: { type: 'string', enum: [...MODIFIERS] } } },
    required: ['key'],
    args: (a) => ({
      key: String(a.key),
      modifiers: Array.isArray(a.modifiers) ? a.modifiers.map(String).filter((m) => (MODIFIERS as readonly string[]).includes(m)) : [],
      ref: optString(a.ref),
    }),
    validate: (a) => {
      if (!isKey(a.key)) throw new Error(text('error.devtools_key', { keys: Object.keys(KEYS).join(', ') }));
    },
    summary: (a, target) => `Press ${[...a.modifiers, a.key].join('+')} on ${target}`,
    input: (a, tabId, ctx) =>
      engineInput(tabId, ctx, {
        ref: a.ref,
        focus: true,
        send: async (s, _at, check, host) => {
          await takeFocus(s, tabId, { ...(a.ref !== undefined && { ref: a.ref }), host }, check);
          await focusEmulation(s);
          await check();
          await pressKeySeen(s, tabId, a.key, a.modifiers);
        },
      }),
    outcome: (a) => ({ kind: 'key', key: a.key }),
    // Synthetic keys carry no modifiers: a shortcut needs real input.
    synthetic: (a) => (a.modifiers.length ? undefined : { kind: 'key', key: a.key, ...(a.ref !== undefined && { ref: a.ref }) }),
  });
}

function scrollTool(): Tool {
  return engineTool({
    name: 'browser.scroll',
    description: 'Scrolls the page (or a scrollable element by ref) with the real mouse wheel, to reveal more content.',
    properties: { ...refProp, direction: { type: 'string', enum: [...DIRECTIONS] } },
    required: ['direction'],
    effect: 'read',
    args: (a) => ({ direction: a.direction, ref: optString(a.ref) }), // checked by direction() when it runs
    validate: (a) => void direction(a.direction),
    summary: (a, target) => `Scroll ${String(a.direction)} ${target}`,
    input: async (a, tabId, ctx) => {
      const host = await startHost(tabId, ctx);
      // Also the page's site access, as every engine call.
      const p = await callPage(tabId, { op: 'wheel-point', ...(a.ref !== undefined && { ref: a.ref }), host });
      const deltaY = a.direction === 'down' ? p.height * WHEEL_STEP : a.direction === 'up' ? -p.height * WHEEL_STEP : 0;
      const deltaX = a.direction === 'right' ? p.width * WHEEL_STEP : a.direction === 'left' ? -p.width * WHEEL_STEP : 0;
      return engineInput(
        tabId,
        ctx,
        {
          locate: false,
          focus: false,
          send: async (s, _at, check) => {
            await check();
            await mouse(s, { type: 'mouseWheel', x: p.x, y: p.y, deltaX, deltaY });
          },
        },
        host,
      );
    },
    outcome: (a) => ({ kind: 'scroll', direction: direction(a.direction) }),
    synthetic: (a) => ({ kind: 'scroll', direction: direction(a.direction), ...(a.ref !== undefined && { ref: a.ref }) }),
  });
}

function hoverTool(): Tool {
  return engineTool({
    name: 'browser.hover',
    description: ENGINE_ONLY_TOOLS['browser.hover'],
    properties: refProp,
    required: ['ref'],
    args: (a) => ({ ref: String(a.ref) }),
    summary: (_a, target) => `Hover over ${target}`,
    input: (a, tabId, ctx) =>
      engineInput(tabId, ctx, {
        ref: a.ref,
        focus: false,
        send: async (s, at, check) => {
          await check();
          await mouse(s, { type: 'mouseMoved', x: at!.x, y: at!.y });
        },
      }),
    outcome: () => ({ kind: 'hover' }),
  });
}

function dragTool(): Tool {
  return engineTool({
    name: 'browser.drag',
    description: ENGINE_ONLY_TOOLS['browser.drag'],
    properties: { ...refProp, to: { type: 'string', description: 'Element reference to drop it on' }, dx: { type: 'number' }, dy: { type: 'number' } },
    required: ['ref'],
    args: (a) => ({ ref: String(a.ref), to: optString(a.to), dx: optFinite(a.dx), dy: optFinite(a.dy) }),
    validate: (a) => {
      const byOffset = a.dx !== undefined || a.dy !== undefined;
      if ((a.to !== undefined) === byOffset) throw new Error('Give either to (an element) or dx/dy (pixels), not both and not neither.');
    },
    summary: (a, target, others) => `Drag ${target} ${a.to !== undefined ? `onto ${others[a.to] ?? a.to}` : `by ${a.dx ?? 0}, ${a.dy ?? 0} px`}`,
    otherRefs: (a) => (a.to !== undefined ? [a.to] : []),
    input: (a, tabId, ctx) =>
      engineInput(tabId, ctx, {
        ref: a.ref,
        focus: false,
        send: async (s, from, check, host) => {
          const end: Pick<Point, 'x' | 'y'> = a.to !== undefined ? await located(tabId, a.to, false, host) : { x: from!.x + (a.dx ?? 0), y: from!.y + (a.dy ?? 0) };
          await check();
          await mouse(s, { type: 'mouseMoved', x: from!.x, y: from!.y });
          await pressed(s, from!, async (at) => {
            for (let i = 1; i <= DRAG_STEPS; i++) {
              at.x = from!.x + ((end.x - from!.x) * i) / DRAG_STEPS;
              at.y = from!.y + ((end.y - from!.y) * i) / DRAG_STEPS;
              await mouse(s, { type: 'mouseMoved', x: at.x, y: at.y, button: 'left', buttons: 1 });
            }
            await check();
            await mouse(s, { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
          });
        },
      }),
    outcome: () => ({ kind: 'drag' }),
  });
}

const CHANGED = 'The page changed during the capture: try again.';

// A screenshot's view, set for the capture only: a phone, or dark mode.
const VIEWS = ['mobile', 'dark'] as const;
type View = (typeof VIEWS)[number];
type ViewStep = { method: CdpMethod; params?: Record<string, unknown> };
const VIEW_SET: Record<View, ViewStep[]> = {
  mobile: [
    { method: 'Emulation.setDeviceMetricsOverride', params: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } },
    { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 5 } },
  ],
  dark: [{ method: 'Emulation.setEmulatedMedia', params: { features: [{ name: 'prefers-color-scheme', value: 'dark' }] } }],
};
const VIEW_CLEAR: Record<View, ViewStep[]> = {
  mobile: [{ method: 'Emulation.clearDeviceMetricsOverride' }, { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: false } }],
  dark: [{ method: 'Emulation.setEmulatedMedia', params: { features: [] } }],
};

function screenshotTool(): Tool {
  return {
    ...onTab,
    name: 'browser.screenshot',
    description:
      'Screenshot of a tab, in front or not: its visible part, one element (ref) or the whole page (fullPage); as a phone (view: mobile) or in dark mode (view: dark). Password, card and one-time-code fields are masked. Use it only if you need to see the layout or images.',
    inputSchema: {
      type: 'object',
      properties: { ...tabIdProp, ...refProp, fullPage: { type: 'boolean' }, view: { type: 'string', enum: [...VIEWS] } },
    },
    source: 'browser',
    effect: 'read',
    via: 'devtools',
    run: capture,
  };
}

async function capture(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  await requireEngine(); // before the page is masked
  const a = fields(args);
  const ref = optString(a.ref);
  const fullPage = optBoolean(a.fullPage) === true;
  const view = VIEWS.find((v) => v === a.view);
  if (ref !== undefined && fullPage) throw new Error('Give ref or fullPage, not both.');
  if (a.view !== undefined && !view) throw new Error(`view must be one of ${VIEWS.join(', ')}`);
  const tabId = targetTab(args, ctx);
  const tab = await browser.tabs.get(tabId);
  if (tab.discarded) throw new Error('The tab is discarded (hibernated): bring it to the front and try again.');
  const host = hostOf(tab.url);
  // No mask, no capture: masking needs the same site access as reading the page.
  const selectors = maskSelectorsFor(ctx.settings.devtoolsMask, host);
  const { token, count } = await callPage(tabId, { op: 'mask', selectors });
  let data: string;
  let stillMasked = false;
  try {
    data = (
      await withDebugger(tabId, async (s) => {
        await assertSameHost(tabId, host);
        if (view) {
          for (const step of VIEW_SET[view]) await s.send(step.method, step.params);
          // The new layout may show fields the first mask did not see (a phone's form).
          await callPage(tabId, { op: 'remask', token, selectors });
        }
        try {
          // The element measured in the layout it is captured in (the phone's, with a view).
          const clip = ref !== undefined ? { ...(await located(tabId, ref, false, host)).box, scale: 1 } : undefined;
          return await s.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: SHOT_QUALITY * 100, ...(clip && { clip }), ...(fullPage && { captureBeyondViewport: true }) });
        } finally {
          if (view) for (const step of VIEW_CLEAR[view]) await s.send(step.method, step.params).catch(() => undefined);
        }
      })
    ).data;
  } finally {
    // False too when the page is gone: what was captured may not have been masked.
    stillMasked = await callPage(tabId, { op: 'unmask', token }).catch(() => false);
  }
  if (!stillMasked || hostOf((await browser.tabs.get(tabId)).url) !== host) throw new Error(CHANGED);
  const shot = { mediaType: 'image/jpeg', data };
  const sized = await sizedShot(shot);
  return { type: 'image', ...sized, note: count > 0 ? text('result.devtools_masked', { count: String(count) }) : undefined };
}

// browser.wait_for with networkIdle: the page's own wait first, then the network's (attached for it).
function waitForTool(): Tool {
  const base = readTools().find((t) => t.name === 'browser.wait_for')!;
  const schema = base.inputSchema as { type: 'object'; properties: Record<string, unknown> };
  return {
    ...base,
    inputSchema: { ...schema, properties: { ...schema.properties, networkIdle: { type: 'boolean', description: 'true: also wait until the page has made no request for half a second.' } } },
    run: async (args, ctx) => {
      const tabId = targetTab(args, ctx);
      const idle = fields(args).networkIdle === true;
      if (idle) await requireEngine();
      const host = idle ? await startHost(tabId, ctx) : '';
      const result = await base.run(args, ctx);
      if (!idle || result.type !== 'text') return result;
      await waitForLoad(tabId); // requests in flight before it attaches are not seen: the load first
      await assertSameHost(tabId, host);
      return (await networkIdle(tabId)) ? result : { ...result, text: `${result.text}\n${text('result.network_busy', { seconds: String(IDLE_MOST_MS / 1000) })}` };
    },
  };
}

export const engineTools = (): Tool[] => [clickTool(), typeTool(), pressKeyTool(), scrollTool(), hoverTool(), dragTool(), screenshotTool(), waitForTool()];

// What the catalog lays over the synthetic tools: the engine's, only while Settings → Chromium
// DevTools is on.
export const engineToolsFor = (settings: RunSettings): Tool[] => (devtoolsOn(settings) ? engineTools() : []);
