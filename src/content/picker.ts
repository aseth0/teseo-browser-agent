// Lets the user point at an element on the page (user.pick_element): an outline follows the mouse,
// a click picks, Esc (or the panel's Cancel) gives up. While picking, clicks never reach the page.
// The banner and the outline live in a closed shadow root, so the page's styles do not touch them.

let cancelCurrent: (() => void) | undefined;

// Gives up the pick in progress, if any.
export function cancelPick(): void {
  cancelCurrent?.();
}

export function pickElement(doc: Document, prompt: string): Promise<Element | null> {
  cancelPick(); // one at a time
  return new Promise((resolve) => {
    const host = doc.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .box { position: fixed; pointer-events: none; z-index: 2147483647; border: 2px solid #2563eb; background: rgb(37 99 235 / .12);
          border-radius: 3px; transition: all 60ms; display: none; }
        .banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; max-width: 80vw;
          font: 13px/1.4 system-ui, sans-serif; color: #fff; background: #1e3a8a; padding: 8px 14px; border-radius: 8px;
          box-shadow: 0 4px 16px rgb(0 0 0 / .3); pointer-events: none; }
        .banner small { opacity: .8; margin-left: 8px; }
      </style>
      <div class="box"></div>
      <div class="banner"></div>`;
    const box = root.querySelector<HTMLElement>('.box')!;
    const banner = root.querySelector<HTMLElement>('.banner')!;
    banner.textContent = prompt || 'Click the element you mean';
    banner.appendChild(Object.assign(doc.createElement('small'), { textContent: 'Esc to cancel' }));
    doc.documentElement.appendChild(host);

    const target = (e: Event) => {
      const el = e.composedPath().find((n): n is Element => n instanceof Element && n !== host);
      return el && el !== doc.documentElement && el !== doc.body ? el : null;
    };
    const outline = (el: Element | null) => {
      if (!el) return void (box.style.display = 'none');
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    // Nothing the user does while picking reaches the page.
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onMove = (e: Event) => outline(target(e));
    // Only the user's own click or key picks: never one the page fakes (dispatchEvent).
    const onClick = (e: Event) => {
      if (!e.isTrusted) return;
      swallow(e);
      const el = target(e);
      if (el) finish(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !e.isTrusted) return;
      swallow(e);
      finish(null);
    };
    const blocked = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu'];
    const finish = (el: Element | null) => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      for (const type of blocked) window.removeEventListener(type, swallow, true);
      host.remove();
      cancelCurrent = undefined;
      resolve(el);
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    for (const type of blocked) window.addEventListener(type, swallow, true);
    cancelCurrent = () => finish(null);
  });
}
