// Floating on a page (sidepanel.html?floating), the page owns the frame the chat is in: it could
// make it see-through, cover it or move it, and steer a click onto "Allow" (clickjacking). The
// browser says whether the frame is really seen (IntersectionObserver v2, trackVisibility): the
// buttons that allow something work only while it has been, whole, for a moment. In the side panel,
// always.
// The browser looks again only when the page is painted: one that measured the chat at a bad moment
// (a resize, the chat just opened) and then stood still kept "not seen", and Allow off. So while it
// is not seen, both the chat and its page keep painting (WIDGET_REPAINT), until it is.
import { useEffect, useState } from 'react';
import { sendTab } from '../core/runtime';
import { FLOATING, floatingTab } from './floating-frame';
import { WIDGET_REPAINT } from '../widget/protocol';
import { SEEN_OPTIONS, seenByBrowser } from '../widget/ui/confirm';

const SEEN_MS = 500; // seen whole this long before such a click counts
const ASK_MS = 1000; // how often the page is asked to paint, while not seen

export function useSeen(): boolean {
  const [seen, setSeen] = useState(!FLOATING);
  useEffect(() => {
    if (!FLOATING) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: IntersectionObserverEntry | undefined;
    // Seen whole (widget/ui/confirm seenByBrowser: v2, else v1's weaker signals) for SEEN_MS.
    const judge = () => {
      clearTimeout(timer);
      if (seenByBrowser(last)) timer = setTimeout(() => setSeen(true), SEEN_MS);
      else setSeen(false);
    };
    const observer = new IntersectionObserver((entries) => {
      last = entries.at(-1);
      judge();
    }, SEEN_OPTIONS);
    observer.observe(document.documentElement); // any part covered, see-through or transformed: not seen
    document.addEventListener('visibilitychange', judge); // hidden, or shown again (v1)
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', judge);
    };
  }, []);
  useEffect(() => {
    if (seen) return;
    let frame = requestAnimationFrame(function paint() {
      frame = requestAnimationFrame(paint);
    });
    const ask = () => void floatingTab().then((tab) => (tab?.id === undefined ? undefined : sendTab(tab.id, { type: WIDGET_REPAINT }))).catch(() => undefined);
    ask();
    const asking = setInterval(ask, ASK_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(asking);
    };
  }, [seen]);
  return seen;
}
