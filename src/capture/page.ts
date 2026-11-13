// Run in the page (injected by capture/run): its layout settled once the side panel opened, a whole
// page's capture, and the chat asked for once a section is captured. Each one self-contained, as an
// injected function must be.

// The viewport's size, the page's height and where it is scrolled, in CSS pixels.
export function pageMetrics(): { width: number; viewport: number; height: number; y: number } {
  const height = (document.scrollingElement ?? document.documentElement).scrollHeight;
  return { width: innerWidth, viewport: innerHeight, height, y: scrollY };
}

// Scrolls the page to `y` at once (no smooth scrolling) and answers where it ended up, once painted
// there: lower than `y` when the page ends before.
export function scrollPageTo(y: number): Promise<number> {
  scrollTo({ top: y, left: scrollX, behavior: 'instant' });
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY))));
}

// Once the window has not been resized for a moment (the side panel just opened beside the page, which
// narrows it), half a second at most, and the page painted so.
export function layoutSettled(): Promise<void> {
  const QUIET_MS = 150, MOST_MS = 500;
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(most);
      removeEventListener('resize', wait);
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    };
    const wait = () => {
      clearTimeout(quiet);
      quiet = setTimeout(done, QUIET_MS);
    };
    const most = setTimeout(done, MOST_MS);
    addEventListener('resize', wait);
    wait();
  });
}

// Once a section dragged on the page is captured, for the side panel (capture/run): asks for it to open
// (CAPTURE_OPEN_CHAT, its `type`), which the browser allows while the drag's gesture lasts. Refused, a
// button by the section asks again from its click; Esc or a click elsewhere puts it away (the capture
// still waits for the chat). Self-contained, as dragArea.
export async function askToOpenChat(type: string, at: { x: number; y: number; width: number; height: number }): Promise<void> {
  const runtime = (globalThis as unknown as { chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } } }).chrome.runtime;
  const open = async () => ((await runtime.sendMessage({ type }).catch(() => undefined)) as { opened?: boolean } | undefined)?.opened === true;
  document.querySelector('ba-attach')?.remove();
  if (await open()) return;
  const button = document.createElement('ba-attach');
  const place = {
    display: 'block', position: 'fixed', 'z-index': '2147483647', cursor: 'pointer',
    top: `${Math.max(8, Math.min(innerHeight - 44, at.y + at.height + 8))}px`,
    right: `${Math.max(8, innerWidth - at.x - at.width)}px`,
  };
  for (const [name, value] of Object.entries(place)) button.style.setProperty(name, value, 'important');
  button.setAttribute('role', 'button');
  button.tabIndex = 0;
  const root = button.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    span { display: block; padding: 8px 12px; border-radius: 6px; background: rgba(0,0,0,0.8); color: #fff;
      font: 13px system-ui, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }`;
  const label = document.createElement('span');
  label.textContent = 'Attach to chat';
  root.append(style, label);
  const away = () => {
    button.remove();
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', onOutside, true);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && away();
  const onOutside = (e: PointerEvent) => !e.composedPath().includes(button) && away();
  const ask = async () => (await open()) && away();
  button.addEventListener('click', () => void ask());
  button.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && void ask());
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onOutside, true);
  document.documentElement.append(button);
}

// A note over the page on why nothing was captured, where no chat can be opened to say it (no gesture
// left); Esc, a click anywhere or a few seconds put it away. Self-contained, as dragArea.
export function noticeInPage(text: string): void {
  const NOTICE_MS = 8000;
  document.querySelector('ba-notice')?.remove();
  const note = document.createElement('ba-notice');
  const place = { display: 'block', position: 'fixed', 'z-index': '2147483647', top: '16px', right: '16px', 'max-width': '360px' };
  for (const [name, value] of Object.entries(place)) note.style.setProperty(name, value, 'important');
  note.setAttribute('role', 'status');
  const root = note.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    span { display: block; padding: 10px 12px; border-radius: 6px; background: rgba(0,0,0,0.85); color: #fff;
      font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }`;
  const label = document.createElement('span');
  label.textContent = text;
  root.append(style, label);
  const away = () => {
    clearTimeout(timer);
    note.remove();
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', away, true);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && away();
  const timer = setTimeout(away, NOTICE_MS);
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', away, true);
  document.documentElement.append(note);
}
