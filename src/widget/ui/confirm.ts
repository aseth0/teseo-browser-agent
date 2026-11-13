// The card where the user confirms what an action is about to change, and what keeps its buttons
// off until it has been seen (whenSeen).
import type { ActionConfirm, CardDecision } from '../protocol';
import { el, pinnedByWidget, trustedButton } from './dom';

// What the action is about to change, as the chat's confirmation card shows it: allowed once, or
// denied. No "Always on this site": the card is in the page, whose renderer could answer for the user
// (the background takes it as Allow); a site's policy is set in the extension's own pages. Only the
// user's own clicks count, and Allow only once the card has been seen (whenSeen): the page could
// cover it or make it see-through.
export function confirmCard(request: ActionConfirm, decide: (d: CardDecision) => void): HTMLElement {
  let decided = false;
  const button = (label: string, decision: CardDecision, className = '') => {
    const b: HTMLButtonElement = trustedButton({ className: `decide ${className}`, textContent: label }, () => {
      if (decided || b.disabled || (decision !== 'deny' && !inPlace())) return;
      decided = true;
      decide(decision);
    });
    return b;
  };
  const details = (request.details ?? []).map((d) =>
    el('div', { className: 'detail' }, el('div', { className: 'box-label', textContent: d.label }), d.code ? el('pre', { className: 'text code', textContent: d.value }) : el('div', { className: 'text', textContent: d.value })));
  const allows = [button('Allow', 'allow', 'primary')];
  const card = el('div', { className: 'confirm' },
    el('div', { className: 'confirm-summary', textContent: request.summary }),
    ...details,
    ...(request.host ? [el('div', { className: 'muted', textContent: `On ${request.host}` })] : []),
    el('div', { className: 'decisions' }, ...allows, button('Deny', 'deny')));
  const inPlace = whenSeen(card, allows, () => decided);
  return card;
}

// The page owns everything around the card: it could cover it, make it see-through or move it, and
// steer a click onto Allow (clickjacking). As the floating chat does (ui/useSeen), the browser says
// whether the card is really seen (IntersectionObserver v2, trackVisibility), and `buttons` work
// only while it has been, whole, for a moment. The browser looks again only when the page is
// painted, so while the card is not seen, frames are asked for. Until the card is decided or removed.
// A seen card can still be moved under the pointer (between the two clicks of a double-click, say):
// its host is in the page, whose script can rewrite its style, or move it by a rule or an ancestor.
// So the buttons are off again for that moment after the host moves or changes size other than by
// the widget (pin), as the page's changes to its style show, and as its place when a button is
// pressed shows (the function returned: false, and the moment starts again, when it moved).
const SEEN_MS = 500;

// Whether the browser says the observed element is seen whole: IntersectionObserver v2 (isVisible:
// on screen, not covered, not see-through or transformed). Where the browser lacks it (Firefox), the
// v1 signals stand in, which is weaker: on screen whole, in a page that is shown; the page could still
// cover it or make it see-through. Observed with SEEN_OPTIONS (thresholds for v1's "whole").
export const SEEN_OPTIONS = { threshold: [0, 1], trackVisibility: true, delay: 100 } as IntersectionObserverInit;
export function seenByBrowser(entry: IntersectionObserverEntry | undefined): boolean {
  if (!entry) return false;
  if (typeof IntersectionObserverEntry !== 'undefined' && 'isVisible' in IntersectionObserverEntry.prototype) return (entry as IntersectionObserverEntry & { isVisible?: boolean }).isVisible === true;
  return entry.isIntersecting && entry.intersectionRatio >= 1 && document.visibilityState === 'visible';
}

export function whenSeen(card: HTMLElement, buttons: HTMLButtonElement[], done: () => boolean): () => boolean {
  const enable = (on: boolean) => buttons.forEach((b) => (b.disabled = !on));
  enable(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let visible = false;
  const root = card.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : card;
  const placeOf = () => {
    const { left, top, width, height } = host.getBoundingClientRect();
    return `${left},${top},${width},${height}`;
  };
  let place = placeOf();
  const paint = () => {
    frame = requestAnimationFrame(paint);
  };
  const stop = () => {
    clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  // Off, then on once seen for the moment, where it is then.
  const arm = () => {
    clearTimeout(timer);
    enable(false);
    place = placeOf();
    if (visible) timer = setTimeout(() => enable(!done() && card.isConnected), SEEN_MS);
  };
  const moved = () => placeOf() !== place;
  let last: IntersectionObserverEntry | undefined;
  const observer = new IntersectionObserver((entries) => {
    stop();
    if (done() || !card.isConnected) return finish();
    last = entries.at(-1);
    visible = seenByBrowser(last);
    arm();
    if (!visible && last?.isIntersecting) paint(); // on screen but not seen whole: let the browser look again
  }, SEEN_OPTIONS);
  observer.observe(card);
  // The page hidden and shown again (another tab): judged again, from the start of the moment.
  const shown = () => {
    if (done() || !card.isConnected) return finish();
    visible = seenByBrowser(last);
    arm();
  };
  document.addEventListener('visibilitychange', shown);
  // The widget's own moves (pin) only change where the card is expected; the page's start the moment again.
  const styles = new MutationObserver(() => {
    if (done() || !card.isConnected) return finish();
    if (pinnedByWidget(host)) place = placeOf();
    else if (moved()) arm();
  });
  if (host !== card) styles.observe(host, { attributes: true, attributeFilter: ['style', 'class'] });
  function finish() {
    observer.disconnect();
    styles.disconnect();
    document.removeEventListener('visibilitychange', shown);
  }
  return () => {
    if (!moved()) return true;
    arm();
    return false;
  };
}
