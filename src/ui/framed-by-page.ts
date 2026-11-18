// Whether the chat's page is framed by a web page, not by the extension's own pages: such a frame shows
// the floating chat's UI (ui/floating-frame) and starts only with a ticket (entrypoints/sidepanel/ticket-gate).
// Imports nothing: the gate reads it before anything of the chat loads.

// Whether this page is in a frame whose parent is not the extension: a page's. Every ancestor's origin
// where the browser lists them (location.ancestorOrigins); else the parent's, which a page's denies.
export function framedByPage(win: Pick<Window, 'top' | 'parent'> & { location: Pick<Location, 'origin'> & { ancestorOrigins?: DOMStringList } }): boolean {
  if (win.top === win) return false;
  const own = win.location.origin;
  const ancestors = win.location.ancestorOrigins;
  if (ancestors) return Array.from(ancestors).some((origin) => origin !== own);
  try {
    return win.parent.location.origin !== own;
  } catch {
    return true;
  }
}
