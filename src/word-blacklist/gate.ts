// Whether a conversation's requests go masked (word-blacklist/core blacklistApplies), and the provider
// that masks them (word-blacklist/request): the one place every request to the model goes through
// (the chat's agent loop and its sub-agents, compaction summaries, the page widget). Once a request of
// a conversation went masked, the rest of it do: the run's (`active`), and the later turns', from the
// answers it marked (Message.masked).
import { text } from '../core/model-texts';
import type { ChatRequest, LLMProvider, Message } from '../core/types';
import { isObject } from '../core/util';
import { blacklistApplies, type BlacklistConfig } from './core';
import { maskRequest, restoreEvents } from './request';
import type { BlacklistState } from './store';

export interface BlacklistGate {
  readonly active: boolean;
  provider(p: LLMProvider, providerId: string): LLMProvider;
}

// The pages a conversation opened or read: the tabs its calls named, the URLs they were given, the
// pages attached to its messages.
export function urlsIn(messages: Message[]): string[] {
  const urls: string[] = [];
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === 'tool_result' && p.tab?.url) urls.push(p.tab.url);
      if (p.type === 'tool_call' && isObject(p.args) && typeof p.args.url === 'string') urls.push(p.args.url);
      if (p.type === 'text' && p.source && /^https?:\/\//i.test(p.source)) urls.push(p.source);
    }
  }
  return urls;
}

// `sticky`: an earlier request of the conversation went masked. `pageUrl`: the page it is on now.
export function blacklistGate(state: BlacklistState | undefined, { sticky = false, pageUrl }: { sticky?: boolean; pageUrl?: () => Promise<string | undefined> } = {}): BlacklistGate {
  let active = !!state && sticky;
  const applies = async (providerId: string, req: ChatRequest) => {
    if (!state) return false;
    if (active) return true;
    const now = await pageUrl?.().catch(() => undefined);
    const urls = [...urlsIn(req.messages), ...(now ? [now] : [])];
    return (active = blacklistApplies(state.config, { providerId, model: req.model, urls }));
  };
  return {
    get active() {
      return active;
    },
    provider: (p, providerId) => ({
      listModels: () => p.listModels(),
      ...(p.contextWindow && { contextWindow: p.contextWindow.bind(p) }),
      async *chat(req, signal) {
        if (!state || !(await applies(providerId, req))) return yield* p.chat(req, signal);
        const { blacklist, config } = state;
        const opts = { hideImages: !!config.hideImages, systemNote: text('system.word_blacklist'), imageNote: text('user.image_hidden') };
        yield* restoreEvents(p.chat(maskRequest(req, blacklist, opts), signal), blacklist);
      },
    }),
  };
}

// Whether a conversation went masked before (its answers say so).
export const wentMasked = (history: Message[]) => history.some((m) => m.masked);

// What the chat shows of it, as the next request would go: nothing while it is off or has no terms
// ('off'); on in this conversation ('active': it went masked, the user turned it on here, or the
// provider and model or a page it opened or is on match); or not ('available': not yet, or turned off here).
// `chosen`: what the user chose in the chip for this conversation, over everything else.
export function chatBlacklistState(at: { config: BlacklistConfig; hasTerms: boolean; providerId: string; model: string; history: Message[]; pageUrl?: string; chosen?: 'on' | 'off' }): 'off' | 'available' | 'active' {
  if (!at.config.enabled || !at.hasTerms) return 'off';
  if (at.chosen) return at.chosen === 'on' ? 'active' : 'available';
  if (wentMasked(at.history)) return 'active';
  const urls = [...urlsIn(at.history), ...(at.pageUrl ? [at.pageUrl] : [])];
  return blacklistApplies(at.config, { providerId: at.providerId, model: at.model, urls }) ? 'active' : 'available';
}
