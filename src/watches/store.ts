// Tab watches (browser.watch): those running and those ended that the panel has not shown yet, kept
// in storage.session so they outlive the service worker sleeping (not the browser closing: the tab
// ids they name would mean nothing then). The background starts and ends them (watches/run, background/watches);
// the panel lists them and offers to go on with the chat of an ended one.
import { stripMarks } from '../core/model-texts';
import { conditionText } from './conditions';
import { browser } from 'wxt/browser';
import { storageList } from '../storage/area';
import type { WatchFired, WatchSpec } from '../content/watch';
import { serialized } from '../storage/serial';

export const WATCHES_KEY = 'watches';
export const WATCHES_ENDED_KEY = 'watchesEnded';

export interface WatchSettings {
  tabId: number;
  spec: WatchSpec;
  minutes?: number; // how long it runs (else the limit, Settings → Limits)
  notify: boolean; // a system notification once it ends
  continueChat: boolean; // the chat it was set from goes on once it is met
  conversationId?: string;
  setBy: 'user' | 'agent';
}

export interface Watch extends WatchSettings {
  id: string;
  origin: string; // the site it watches: it ends once the tab leaves it
  title: string; // the tab's, when it was set
  createdAt: number;
  expiresAt: number;
}

export type WatchEnd =
  | { kind: 'met'; fired: WatchFired }
  | { kind: 'timeout' }
  | { kind: 'closed' } // the tab
  | { kind: 'left'; url: string } // the tab went to another site
  | { kind: 'failed'; error: string } // it could not watch the page again after it loaded
  | { kind: 'cancelled' };

export interface EndedWatch {
  watch: Watch;
  end: WatchEnd;
  at: number;
}

// What a watch waits for, in words: '"Stop generating" is gone and no change for 2000 ms'.
export function watchCondition(spec: WatchSpec): string {
  const parts: string[] = [];
  if (spec.gone) parts.push(`"${spec.gone}" is gone`);
  if (spec.appears) parts.push(`"${spec.appears}" appears`);
  if (spec.stableMs !== undefined) parts.push(`no change for ${spec.stableMs} ms`);
  return parts.join(' and ');
}

export function endText(end: WatchEnd): string {
  switch (end.kind) {
    case 'met':
      return `${end.fired.met.map((c) => stripMarks(conditionText(c, true))).join(' and ')} (after ${Math.round(end.fired.ms / 1000)} s)`;
    case 'timeout':
      return 'time is up';
    case 'closed':
      return 'the tab was closed';
    case 'left':
      return `the tab went to ${end.url}`;
    case 'failed':
      return end.error;
    case 'cancelled':
      return 'cancelled';
  }
}

const read = <T,>(key: string): Promise<T[]> => storageList<T>('session', key);
const changing = serialized('watches');
const change = <T,>(key: string, edit: (list: T[]) => T[]) =>
  changing(async () => {
    const next = edit(await read<T>(key));
    await browser.storage.session.set({ [key]: next });
    return next;
  });

export const loadWatches = () => read<Watch>(WATCHES_KEY);
export const loadEndedWatches = () => read<EndedWatch>(WATCHES_ENDED_KEY);
// Saved while fewer than `most` are running, judged in the same change (two started at once both count);
// else `tooMany` is thrown, with how many there are.
export const saveNewWatch = (w: Watch, most: number, tooMany: (running: number) => Error) =>
  change<Watch>(WATCHES_KEY, (list) => {
    if (list.length >= most) throw tooMany(list.length);
    return [...list, w];
  });
// Removed from a list: the one it was, if it was still there.
const take = async <T,>(key: string, isIt: (x: T) => boolean): Promise<T | undefined> => {
  let taken: T | undefined;
  await change<T>(key, (list) => {
    taken = list.find(isIt);
    return list.filter((x) => !isIt(x));
  });
  return taken;
};
// Removed: the watch it was, if it was still there (else another end got it first).
export const takeWatch = (id: string) => take<Watch>(WATCHES_KEY, (w) => w.id === id);
export const addEnded = (e: EndedWatch) => change<EndedWatch>(WATCHES_ENDED_KEY, (list) => [...list, e]);
export const dismissEnded = (id: string) => change<EndedWatch>(WATCHES_ENDED_KEY, (list) => list.filter((e) => e.watch.id !== id));
// Removed, by the one chat that gets it (the panels of two windows may have the conversation open).
export const takeEnded = async (id: string): Promise<boolean> => (await take<EndedWatch>(WATCHES_ENDED_KEY, (e) => e.watch.id === id)) !== undefined;
