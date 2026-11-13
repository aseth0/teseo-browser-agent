// A compaction's summary (context/compaction), asked by the chat: only the extension's own pages
// may ask, never a page's content script.
import { errorText } from '../core/errors';
import { limit } from '../core/limits';
import { keepLatest } from '../core/truncate';
import { markValue, text } from '../core/model-texts';
import { SUMMARIZE, type SummarizeReply, type SummarizeRequest } from '../core/protocol';
import { onRuntime } from '../core/runtime';
import { isExtensionPage } from '../core/sender';
import { gatedProvider, unreachable } from '../providers/provider-access';
import { settingsNow } from './settings';

const SUMMARY_MS = 120_000;

// The summary request's system prompt: the instructions it was given after its own rules, marked as
// a tool's value (the model passes them on, and they may come from what it read).
export function summaryRequestSystem(maxWords: number, instructions?: string): string {
  const request = text('compaction.summary_request', { max_words: String(maxWords) });
  const given = instructions?.trim();
  return given ? `${request}\n\n${text('compaction.summary_instructions', { instructions: markValue(given, 'tool') })}` : request;
}

// The transcript at most Settings → Limits' size: past it, its oldest part is left out.
const summarize = async (msg: SummarizeRequest): Promise<SummarizeReply> => {
  const settings = await settingsNow();
  const cfg = settings.providers.find((p) => p.id === msg.providerId);
  if (!cfg) return { error: 'Provider not configured' };
  const blocked = await unreachable(cfg);
  if (blocked) return { error: blocked };
  let summary = '';
  const request = { model: msg.model, system: summaryRequestSystem(msg.maxWords, msg.instructions), messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: keepLatest(msg.transcript, limit('summaryText')) }] }] };
  const provider = await gatedProvider(cfg, { sticky: msg.masked });
  for await (const e of provider.chat(request, AbortSignal.timeout(SUMMARY_MS))) if (e.type === 'text-delta') summary += e.text;
  return summary.trim() ? { summary: summary.trim() } : { error: 'The model returned no summary.' };
};

export function listenSummarize() {
  onRuntime(SUMMARIZE, (msg, sender) => {
    if (!isExtensionPage(sender)) return;
    return summarize(msg).catch((e): SummarizeReply => ({ error: errorText(e) }));
  });
}
