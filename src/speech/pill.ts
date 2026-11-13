// The pill on the page while something is read aloud (background/speech-host): "Preparing…" or "Reading 2
// of 5" and Stop, in a closed shadow root, in the style of a tab's audio pill (recording/pill), draggable.
// Injected with scripting.executeScript, so self-contained; once per page (called again, it updates). The
// background tells it what to say and when to go (`types.update`); Stop asks the background (`types.stop`)
// only on the user's own click, never a script's.

export function showSpeechPill(types: { stop: string; update: string }, text: string): void {
  const KEY = 'ba-speech-pill';
  const TAG = 'ba-speech';
  const w = window as unknown as Record<string, unknown>;
  const existing = w[KEY] as { say: (t: string) => void; away: () => void } | undefined;
  if (existing) {
    if (document.querySelector(TAG)) return existing.say(text);
    existing.away(); // the page rewrote its document: the pill is gone, its listener is not
  }
  const runtime = (globalThis as unknown as {
    chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown>; onMessage: { addListener: (l: (m: unknown) => void) => void; removeListener: (l: (m: unknown) => void) => void } } };
  }).chrome.runtime;

  const host = document.createElement(TAG);
  const place: Record<string, string> = { display: 'block', position: 'fixed', 'z-index': '2147483647', top: '84px', right: '12px' };
  for (const [name, value] of Object.entries(place)) host.style.setProperty(name, value, 'important');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    div { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 10px; border-radius: 999px; cursor: grab;
      font: 12px system-ui, sans-serif; color: #202124; background: #fff; border: 1px solid #dadce0; box-shadow: 0 2px 8px rgba(0,0,0,0.15); user-select: none; }
    span { flex: 1; }
    i { width: 8px; height: 8px; border-radius: 50%; background: #1a73e8; }
    button { font: inherit; padding: 2px 10px; border-radius: 999px; cursor: pointer; color: #b3261e; background: #fce8e6; border: 1px solid #f4b4ae; }
    @media (prefers-color-scheme: dark) {
      div { color: #e8eaed; background: #292a2d; border-color: #5f6368; }
      i { background: #8ab4f8; }
      button { color: #f6aea9; background: #5c2b29; border-color: #8c3a35; }
    }`;
  const bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  const dot = document.createElement('i');
  const label = document.createElement('span');
  const stop = document.createElement('button');
  stop.textContent = 'Stop';
  stop.title = 'Stop reading aloud';
  bar.append(dot, label, stop);
  root.append(style, bar);

  const say = (t: string) => (label.textContent = t);
  const away = () => {
    runtime.onMessage.removeListener(listener);
    host.remove();
    delete w[KEY];
  };
  const listener = (m: unknown) => {
    const msg = m as { type?: string; off?: boolean; text?: string };
    if (msg?.type !== types.update) return;
    if (msg.off) return away();
    if (typeof msg.text === 'string') say(msg.text);
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

  w[KEY] = { say, away };
  say(text);
  document.documentElement.append(host);
}
