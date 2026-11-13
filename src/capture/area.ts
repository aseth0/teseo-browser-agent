// A section of the page to capture, dragged on it, and that section cut out of a capture of the visible
// tab: for the paperclip's Web Screenshot (sidepanel/useAttachments) and the popup's or a shortcut's
// Section (background/capture-host). OffscreenCanvas works in both, the service worker too.

// A section of the page, in its CSS pixels, and the page's width then (a capture's pixels per CSS pixel).
export interface Area { x: number; y: number; width: number; height: number; viewport: number }

// Runs in the page (injected): a veil over it where you drag a rectangle; Esc, or a click without a
// drag, gives up. The veil is gone, and the page painted again, before it answers. Its look is in a
// closed shadow root on a tag of its own, its host's place `!important`: the page's CSS cannot reach it.
// Injected, it must be self-contained: it sets those itself rather than through the widget's pin().
export function dragArea(): Promise<Area | null> {
  return new Promise((resolve) => {
    const veil = document.createElement('ba-veil');
    for (const [name, value] of Object.entries({ display: 'block', position: 'fixed', inset: '0', 'z-index': '2147483647', cursor: 'crosshair', background: 'rgba(0,0,0,0.25)' })) {
      veil.style.setProperty(name, value, 'important');
    }
    const root = veil.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .box { position: fixed; border: 2px solid #fff; outline: 1px solid rgba(0,0,0,0.6); background: rgba(255,255,255,0.12); display: none; pointer-events: none; }
      .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); padding: 6px 10px; border-radius: 6px;
        background: rgba(0,0,0,0.75); color: #fff; font: 13px system-ui, sans-serif; pointer-events: none; }`;
    const box = document.createElement('div');
    box.className = 'box';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Drag over the part to capture · Esc cancels';
    root.append(style, box, hint);
    document.documentElement.append(veil);
    let start: { x: number; y: number } | null = null;
    const rect = (e: PointerEvent) => {
      const x = Math.min(start!.x, e.clientX), y = Math.min(start!.y, e.clientY);
      return { x, y, width: Math.abs(e.clientX - start!.x), height: Math.abs(e.clientY - start!.y) };
    };
    const done = (area: Area | null) => {
      veil.remove();
      removeEventListener('keydown', onKey, true);
      // Two frames: the veil is off the screen before the capture.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(area)));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      done(null);
    };
    addEventListener('keydown', onKey, true);
    veil.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      veil.setPointerCapture(e.pointerId);
    });
    veil.addEventListener('pointermove', (e) => {
      if (!start) return;
      const r = rect(e);
      Object.assign(box.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    });
    veil.addEventListener('pointerup', (e) => {
      if (!start) return;
      const r = rect(e);
      done(r.width < 4 || r.height < 4 ? null : { ...r, viewport: innerWidth });
    });
  });
}

// That section of a capture of the visible tab.
export async function crop(shot: Blob, area: Area): Promise<Blob> {
  const bitmap = await createImageBitmap(shot);
  const scale = bitmap.width / area.viewport;
  const [x, y] = [Math.round(area.x * scale), Math.round(area.y * scale)];
  const [w, h] = [Math.max(1, Math.min(bitmap.width - x, Math.round(area.width * scale))), Math.max(1, Math.min(bitmap.height - y, Math.round(area.height * scale)))];
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}
