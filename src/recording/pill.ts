// The pill on a page being recorded (background/recording-host): "Recording · 3 calls · 0:42" and Stop,
// in a closed shadow root, draggable; or, on a tab whose audio is captured (background/audio-host):
// "Audio · 0:42", under the other one, and below it what was chosen (Settings → Voice): the last lines
// transcribed, the sound's waves, as the background tells it (`types.update`). Injected with
// scripting.executeScript, so self-contained; once per page (called again, it updates; the page having
// replaced its document, the pill went with it: the old one's timer and listener are stopped first). The background
// tells it the count (`types.update`) and when to go (`off`); Stop asks the background (`types.stop`)
// only on the user's own click, never a script's.
export type PillSpec =
  | { kind: 'recording'; calls: number; leftOut: number; startedAt: number }
  | { kind: 'audio'; startedAt: number; text: boolean; waves: boolean }; // text, waves: what shows below it

export function showRecordingPill(types: { stop: string; update: string }, pill: PillSpec): void {
  const audio = pill.kind === 'audio';
  const KEY = audio ? 'ba-audio-pill' : 'ba-recording-pill';
  const TAG = audio ? 'ba-audio' : 'ba-recording';
  const w = window as unknown as Record<string, unknown>;
  const existing = w[KEY] as { update: (p: PillSpec) => void; away: () => void } | undefined;
  if (existing) {
    if (document.querySelector(TAG)) return existing.update(pill);
    existing.away(); // the page rewrote its document: the pill is gone, its timer and listener are not
  }
  const runtime = (globalThis as unknown as {
    chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown>; onMessage: { addListener: (l: (m: unknown) => void) => void; removeListener: (l: (m: unknown) => void) => void } } };
  }).chrome.runtime;

  const host = document.createElement(TAG);
  const place: Record<string, string> = { display: 'block', position: 'fixed', 'z-index': '2147483647', top: audio ? '48px' : '12px', right: '12px' };
  for (const [name, value] of Object.entries(place)) host.style.setProperty(name, value, 'important');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    div { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 10px; border-radius: 999px; cursor: grab;
      font: 12px system-ui, sans-serif; color: #202124; background: #fff; border: 1px solid #dadce0; box-shadow: 0 2px 8px rgba(0,0,0,0.15); user-select: none; }
    span { flex: 1; }
    i { width: 8px; height: 8px; border-radius: 50%; background: #d93025; }
    button { font: inherit; padding: 2px 10px; border-radius: 999px; cursor: pointer; color: #b3261e; background: #fce8e6; border: 1px solid #f4b4ae; }
    section { box-sizing: border-box; width: 300px; margin-top: 4px; padding: 8px 10px; border-radius: 10px;
      font: 12px/1.35 system-ui, sans-serif; color: #202124; background: #fff; border: 1px solid #dadce0; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    figure { display: flex; align-items: center; gap: 1px; height: 28px; margin: 0; }
    figure + p { margin-top: 6px; }
    b { flex: 1; min-height: 1px; border-radius: 1px; background: #d93025; }
    p { display: flex; flex-direction: column; justify-content: flex-end; margin: 0; max-height: 5.4em; overflow: hidden; white-space: pre-line; }
    @media (prefers-color-scheme: dark) {
      div, section { color: #e8eaed; background: #292a2d; border-color: #5f6368; }
      button { color: #f6aea9; background: #5c2b29; border-color: #8c3a35; }
    }`;
  const bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  const dot = document.createElement('i');
  const label = document.createElement('span');
  const stop = document.createElement('button');
  stop.textContent = 'Stop';
  stop.title = audio ? "Stop capturing the tab's audio" : 'Stop recording and review what it caught';
  bar.append(dot, label, stop);
  root.append(style, bar);
  const said = document.createElement('p');
  const bars: HTMLElement[] = [];
  const heights: number[] = [];
  if (pill.kind === 'audio' && (pill.text || pill.waves)) {
    const below = document.createElement('section');
    if (pill.waves) {
      const waves = document.createElement('figure');
      for (let n = 0; n < 48; n++) bars.push(waves.appendChild(document.createElement('b')));
      below.append(waves);
    }
    if (pill.text) {
      said.textContent = 'Listening…';
      below.append(said);
    }
    root.append(below);
  }
  // A level comes in at the right. Speech is far under 1: the root spreads it over the height.
  const addLevel = (level: number) => {
    heights.push(Math.min(100, Math.sqrt(Math.max(0, level)) * 160));
    if (heights.length > bars.length) heights.shift();
    heights.forEach((h, n) => bars[bars.length - heights.length + n]!.style.setProperty('height', `${Math.max(h, 2)}%`));
  };

  let now = pill;
  const show = () => {
    const s = Math.max(0, Math.floor((Date.now() - now.startedAt) / 1000));
    const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    label.textContent = now.kind === 'audio' ? `Audio · ${time}` : `Recording · ${now.calls} ${now.calls === 1 ? 'call' : 'calls'} · ${time}`;
  };
  const update = (p: PillSpec) => {
    now = p;
    show();
  };
  const tick = setInterval(show, 1000);
  const away = () => {
    clearInterval(tick);
    runtime.onMessage.removeListener(listener);
    host.remove();
    delete w[KEY];
  };
  const listener = (m: unknown) => {
    const msg = m as { type?: string; off?: boolean; calls?: number; leftOut?: number; startedAt?: number; lines?: string[]; level?: number };
    if (msg?.type !== types.update) return;
    if (msg.off) return away();
    if (Array.isArray(msg.lines) && msg.lines.length) said.textContent = msg.lines.join('\n');
    if (typeof msg.level === 'number' && bars.length) addLevel(msg.level);
    if (typeof msg.calls === 'number' && typeof msg.startedAt === 'number') update(now.kind === 'audio' ? { ...now, startedAt: msg.startedAt } : { kind: 'recording', calls: msg.calls, leftOut: msg.leftOut ?? 0, startedAt: msg.startedAt });
  };
  runtime.onMessage.addListener(listener);
  stop.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    void runtime.sendMessage({ type: types.stop }).catch(() => undefined);
  });

  // Dragged anywhere on the bar but Stop; where it is put stays for the page's life.
  bar.addEventListener('pointerdown', (e) => {
    if (e.target === stop || !e.isTrusted) return;
    const box = host.getBoundingClientRect();
    const dx = e.clientX - box.left, dy = e.clientY - box.top;
    const move = (m: PointerEvent) => {
      host.style.setProperty('left', `${Math.max(0, Math.min(innerWidth - box.width, m.clientX - dx))}px`, 'important');
      host.style.setProperty('top', `${Math.max(0, Math.min(innerHeight - box.height, m.clientY - dy))}px`, 'important');
      host.style.setProperty('right', 'auto', 'important');
    };
    const up = () => {
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', up, true);
    };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
  });

  w[KEY] = { update, away };
  show();
  document.documentElement.append(host);
}
