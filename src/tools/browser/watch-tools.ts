// Tab watches the agent sets (browser.watch) and cancels: each is confirmed by the user every time,
// runs without keeping the turn waiting, and ends as watches/run says.
import { browser } from 'wxt/browser';
import { addWatch, endWatch } from '../../watches/run';
import { limit } from '../../core/limits';
import { text } from '../../core/model-texts';
import type { Tool } from '../../core/types';
import type { WatchSpec } from '../../content/watch';
import { loadWatches, watchCondition } from '../../watches/store';
import { argumentDetails } from '../../core/argument-details';
import { fields, optBoolean, optFinite, optString } from '../define';
import { tabIdProp, tabOfArgs, targetTab } from './tab-target';

interface WatchArgs extends WatchSpec {
  tabId: unknown; // as given: targetTab reads it
  minutes?: number;
  notify?: boolean;
  continueChat?: boolean;
}

const watchArgs = (raw: unknown): WatchArgs => {
  const a = fields(raw);
  return {
    tabId: a.tabId,
    gone: optString(a.gone),
    appears: optString(a.appears),
    css: optBoolean(a.css),
    stableMs: optFinite(a.stableMs),
    minutes: optFinite(a.minutes),
    notify: optBoolean(a.notify),
    continueChat: optBoolean(a.continueChat),
  };
};

const specOf = ({ gone, appears, css, stableMs }: WatchArgs): WatchSpec => ({
  ...(gone && { gone }),
  ...(appears && { appears }),
  ...(css && { css }),
  ...(stableMs !== undefined && { stableMs }),
});

export function watchTools(): Tool[] {
  return [
    {
      name: 'browser.watch',
      description:
        'Watches a tab in the background and returns at once, so this turn can end: until an element is gone or appears (matched like browser__find, or CSS selectors with css=true) and/or the page has not changed for stableMs. The user can see and cancel it; once it is met they are notified (notify), and with continueChat this conversation goes on with what happened. At most {watches} watches at once, up to {minutes} minutes each.',
      fillDescription: (d) => d.replaceAll('{watches}', String(limit('watches'))).replaceAll('{minutes}', String(limit('watchMinutes'))),
      inputSchema: {
        type: 'object',
        properties: {
          ...tabIdProp,
          gone: { type: 'string', description: 'The element that must be gone, e.g. "button Stop generating"' },
          appears: { type: 'string', description: 'The element that must appear' },
          css: { type: 'boolean', description: 'gone and appears are CSS selectors' },
          stableMs: { type: 'number', description: 'And the page has not changed for this long' },
          minutes: { type: 'number', description: 'How long it runs' },
          notify: { type: 'boolean', description: 'Defaults to true' },
          continueChat: { type: 'boolean', description: 'Defaults to true' },
        },
      },
      source: 'browser',
      effect: 'read',
      alwaysAsk: true,
      tabOf: tabOfArgs,
      describe: async (args, ctx) => {
        const a = watchArgs(args);
        const tab = await browser.tabs.get(targetTab(a, ctx)).catch(() => undefined);
        return { summary: `Watch the tab "${tab?.title || tab?.url || 'this tab'}" until ${watchCondition(specOf(a))}`, details: argumentDetails(args) };
      },
      run: async (args, ctx) => {
        const a = watchArgs(args);
        const continueChat = (a.continueChat ?? true) && ctx.conversationId !== undefined;
        const w = await addWatch({
          tabId: targetTab(a, ctx),
          spec: specOf(a),
          ...(a.minutes !== undefined && { minutes: a.minutes }),
          notify: a.notify ?? true,
          continueChat,
          ...(ctx.conversationId && { conversationId: ctx.conversationId }),
          setBy: 'agent',
        });
        const tab = await browser.tabs.get(w.tabId).catch(() => undefined);
        return {
          type: 'text',
          text: text('result.watch_started', {
            id: w.id,
            tab_id: String(w.tabId),
            url: tab?.url ?? w.origin,
            condition: watchCondition(w.spec),
            minutes: String(Math.round((w.expiresAt - w.createdAt) / 60_000)),
            after: text(continueChat ? 'watch.after_continue' : 'watch.after_notify'),
          }),
        };
      },
    },
    {
      name: 'browser.unwatch',
      description: 'Cancels a tab watch started with browser__watch, by its id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      source: 'browser',
      effect: 'read',
      // Only one this conversation started: never the user's, nor another conversation's.
      run: async (args, ctx) => {
        const id = String(fields(args).id);
        const w = (await loadWatches()).find((x) => x.id === id);
        if (!w) return { type: 'text', text: text('error.watch_not_running', { id }), isError: true };
        if (w.setBy !== 'agent' || w.conversationId !== ctx.conversationId) return { type: 'text', text: text('error.watch_not_ours', { id }), isError: true };
        await endWatch(id, { kind: 'cancelled' });
        return { type: 'text', text: text('result.watch_cancelled', { id }) };
      },
    },
  ];
}
