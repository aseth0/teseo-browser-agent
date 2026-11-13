// Actions on page load: what each found here (its card opens with it at once), run a moment after
// the page loads or moves (an SPA), again a little later in case the page had not drawn its values,
// and then whenever the page changes while one still waits for its values (comments drawn when
// scrolled to): at most every WATCH_EVERY_MS, for WATCH_MS, each at most MAX_RERUNS times. One that
// finds nothing, or whose values are not on the page, shows nothing.
import { resolveVariable, structuredData } from '../../content/page-values';
import { parseVariable } from '../../skills/variables';
import { runAction } from '../client';
import { MAX_PAGE_VALUE } from '../protocol';
import type { WidgetState } from './state';

const LOAD_DELAYS = [1000, 3000];
const WATCH_EVERY_MS = 1000;
const WATCH_MS = 10 * 60_000;
const MAX_RERUNS = 3; // an action the page's changes run again (a live counter: not once a second)

// The values an action reads from the page, by name ('' for one the page lacks).
export const readValues = (reads: Record<string, string> = {}) => {
  const jsonLd = structuredData(document).jsonLd;
  return Object.fromEntries(Object.entries(reads).map(([name, token]) => {
    const v = parseVariable(token.trim());
    return [name, v && v.kind !== 'items' ? resolveVariable(document, jsonLd, v).trim().slice(0, MAX_PAGE_VALUE) : ''];
  }));
};

export function createLoads(s: WidgetState, cutOff: () => boolean) {
  let loadRound = 0; // a newer page drops what an older one finds
  const running = new Set<string>(); // never twice at once
  const ranWith = new Map<string, string>(); // what each last ran with: the page's changes do not run it again with the same
  const reruns = new Map<string, number>(); // runs the page's changes set off, each at most MAX_RERUNS a page
  const timers = new Set<ReturnType<typeof setTimeout>>(); // this page's: cleared when it moves
  let runs = new AbortController(); // stopped (their ports closed, so is their run in the background) once the widget goes
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => (timers.delete(t), fn()), ms);
    timers.add(t);
  };
  const loadAll = async (round: number, watched = false) => {
    if (cutOff() || round !== loadRound) return;
    for (const action of s.actions.filter((a) => a.load && !s.loaded.has(a.id) && !running.has(a.id))) {
      const reads = readValues(action.reads);
      const key = JSON.stringify(reads);
      if (Object.values(reads).some((v) => !v)) continue;
      if (watched && (ranWith.get(action.id) === key || (reruns.get(action.id) ?? 0) >= MAX_RERUNS)) continue;
      if (watched) reruns.set(action.id, (reruns.get(action.id) ?? 0) + 1);
      ranWith.set(action.id, key);
      running.add(action.id);
      const reply = await runAction({ id: action.id, input: '', reads }, { onDelta: () => undefined }, runs.signal).finally(() => running.delete(action.id));
      if (round !== loadRound) return;
      if (!reply || 'error' in reply || (!reply.badge && reply.outputs.every((o) => !o.lines.length && !o.text))) continue;
      s.loaded.set(action.id, reply);
      showFound();
    }
  };
  // While one waits for values the page has not drawn yet: the page's changes, now and then.
  let watcher: MutationObserver | undefined;
  const stop = () => {
    watcher?.disconnect();
    watcher = undefined;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
  const watchFor = (round: number) => {
    let last = 0;
    let pending = false;
    const until = Date.now() + WATCH_MS;
    // Still waiting: every one that has found nothing yet (its values not drawn yet, or drawn only in
    // part: "Comments" before its number) and may run again.
    const check = () => {
      pending = false;
      last = Date.now();
      const waiting = s.actions.filter((a) => a.load && !s.loaded.has(a.id) && Object.keys(a.reads ?? {}).length && (reruns.get(a.id) ?? 0) < MAX_RERUNS);
      if (round !== loadRound || !waiting.length || Date.now() > until) stop();
    };
    const changed = () => {
      if (pending) return;
      pending = true;
      later(() => void loadAll(round, true).then(check), Math.max(0, last + WATCH_EVERY_MS - Date.now()));
    };
    watcher = new MutationObserver(changed);
    watcher.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
  const runLoads = () => {
    const round = ++loadRound;
    stop();
    if (runs.signal.aborted) runs = new AbortController(); // dropped before: they run again
    s.loaded.clear();
    ranWith.clear();
    reruns.clear();
    showFound();
    if (!s.actions.some((a) => a.load)) return;
    for (const delay of LOAD_DELAYS) later(() => void loadAll(round), delay);
    // Those whose values come later.
    if (s.actions.some((a) => a.load && Object.keys(a.reads ?? {}).length)) watchFor(round);
  };
  // The bubble shows the badge of the first action (in Settings → Actions' order) that has one, with a
  // dot when others found something too; without any, how many found something. Their buttons are
  // marked, with their badge when they have one.
  const showFound = () => {
    if (!s.host) return;
    const first = s.actions.map((a) => s.loaded.get(a.id)?.badge).find(Boolean);
    s.count.textContent = first ?? (s.loaded.size ? String(s.loaded.size) : '');
    s.count.classList.toggle('more', !!first && s.loaded.size > 1);
    s.count.hidden = !s.loaded.size;
    for (const b of s.menu.querySelectorAll<HTMLElement>('.act[data-action]')) {
      const reply = s.loaded.get(b.dataset.action!);
      b.classList.toggle('found', !!reply);
      const badge = reply?.badge;
      if (badge) b.dataset.badge = badge;
      else delete b.dataset.badge;
    }
  };
  return {
    run: runLoads,
    showFound,
    // What is still loading finds nothing to show, and its runs stop.
    drop: () => {
      loadRound++;
      stop();
      runs.abort();
    },
  };
}
