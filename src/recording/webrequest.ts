// The ⏺ recording without the DevTools engine (recording/recorder): the browser says what the tab
// called (webRequest: method, URL, what it sent, the status), of the preset's types; hooks in the page
// add the answers of fetch and XHR (recording/page-hooks). What the preset leaves out (recording/filter)
// is only counted; secret-looking values are hidden on arrival (recording.ts).
import { browser, type Browser } from 'wxt/browser';
import { onRuntime } from '../core/runtime';
import { hostOf } from '../core/util';
import { hasAccess } from '../page/access';
import { bodyText, joined, sentBodyOf } from './bodies';
import { typeOfWebRequest, webRequestTypes } from './filter';
import { ledger, type CaptureMessage } from './ledger';
import { hookAnswers, relayAnswers, unhookAnswers } from './page-hooks';
import type { RecordingPreset } from './presets';
import { answerIndex, hideSecretsInUrl, MAX_BODY, MAX_HEAD, MAX_RELAY, parsePageAnswer, withAnswer, type RecordedCall } from './recording';

// How long answers on their way still come after a stop, in ms: the page's hooks are read once more
// then. The recorder waits as long (its default `settleMs`) before it closes the recording, so that
// read is in it: the two must agree.
export const SETTLE_MS = 1000;

// What a request sent: a form as a=1&b=2, else its bytes (read by recording/bodies).
export function sentBody(body: Browser.webRequest.OnBeforeRequestDetails['requestBody']): string | Uint8Array | undefined {
  if (!body) return undefined;
  if (body.formData) {
    const form = new URLSearchParams();
    for (const [k, values] of Object.entries(body.formData)) for (const v of values) form.append(k, String(v));
    return form.toString();
  }
  const parts = (body.raw ?? []).flatMap((r) => (r.bytes ? [new Uint8Array(r.bytes)] : []));
  return parts.length ? joined(parts) : undefined;
}

export async function startWebRequest(opts: { tabId: number; preset: RecordingPreset; site: string }, emit: (m: CaptureMessage) => void): Promise<{ stop(): Promise<void> }> {
  const { tabId, preset } = opts;
  const key = `ba-rec-${crypto.randomUUID()}`;
  let over = false;
  // The calls kept, as far as pairing the page's answers needs; the frame that made each.
  let kept: RecordedCall[] = [];
  const frames = new Map<string, number>();
  const calls = ledger(preset, opts.site, emit, (why) => void stop(why));

  const inject = async () => {
    const target = { tabId, allFrames: true };
    // The page tells each answer whole, up to MAX_RELAY: a JSON cut shorter could no longer be read to hide its secrets.
    await browser.scripting.executeScript({ target, world: 'MAIN', func: hookAnswers, args: [key, MAX_RELAY] }).catch(() => undefined);
    await browser.scripting.executeScript({ target, func: relayAnswers, args: [key, MAX_RELAY + MAX_HEAD + 1] }).catch(() => undefined);
  };
  // Its answer is not one the preset keeps: the call goes (the ledger counts it as left out).
  const answered = (id: string, answer: { status?: number; error?: string; responseType?: string }) => {
    if (calls.answered(id, answer)) return true;
    kept = kept.filter((c) => c.id !== id);
    return false;
  };
  const isKept = calls.has;

  const sent = (d: Browser.webRequest.OnBeforeRequestDetails): undefined => {
    if (over) return;
    const type = typeOfWebRequest(d.type);
    const method = type === 'socket' && d.type === 'websocket' ? 'WS' : d.method;
    const url = hideSecretsInUrl(d.url);
    // No headers here: a packed body is known by its first bytes (gzip, zlib), unpacked after it is kept.
    const { requestBody, sameAs, unpacked } = sentBodyOf(sentBody(d.requestBody), { max: preset.maxBody });
    if (!calls.keeps({ method, url, type, requestBody: sameAs })) return;
    const call: RecordedCall = { id: d.requestId, method, url, at: Date.now(), included: true, ...(requestBody !== undefined && { requestBody }) };
    if (!calls.add(call, sameAs)) return;
    frames.set(d.requestId, d.frameId);
    kept.push(call);
    if (unpacked) void unpacked.then((b) => isKept(call.id) && emit({ update: { id: call.id, requestBody: b } }), () => undefined);
  };
  const completed = (d: Browser.webRequest.OnCompletedDetails) => {
    if (!isKept(d.requestId) || !answered(d.requestId, { status: d.statusCode })) return;
    kept = kept.map((c) => (c.id === d.requestId ? { ...c, status: d.statusCode } : c));
    emit({ update: { id: d.requestId, status: d.statusCode } });
  };
  const failed = (d: Browser.webRequest.OnErrorOccurredDetails) => {
    if (isKept(d.requestId) && answered(d.requestId, { error: d.error })) emit({ update: { id: d.requestId, error: d.error } });
  };
  // An answer is told by the frame that got it, in the recorded tab: one frame cannot write the
  // answer of another's call (an ad's frame, the page's own calls).
  const fromPage = onRuntime('recording-answer', (msg, sender) => {
    if (msg.key !== key || sender.tab?.id !== tabId || sender.frameId === undefined) return;
    const answer = parsePageAnswer(msg.answer);
    const madeBy = (c: RecordedCall) => frames.get(c.id) === sender.frameId;
    // Matched to a kept call before its body is read: the page cannot have the extension parse what it likes.
    if (!answer || answerIndex(kept, answer, madeBy) < 0) return;
    // Binary read as text: (binary, N bytes). A JSON the page had to cut cannot be checked for secrets: not shown.
    if (typeof answer.body === 'string') {
      answer.body = answer.cut && /^\s*[[{]/.test(answer.body) ? `(JSON, over ${MAX_RELAY} characters: too large to check for secrets)` : bodyText(answer.body, MAX_BODY, answer.type);
    }
    // Its secrets hidden in the whole answer (withAnswer), then cut to the preset's size.
    const next = withAnswer(kept, answer, madeBy);
    const i = next.findIndex((c, j) => c !== kept[j]);
    if (i < 0) return;
    const got = next[i]!;
    const c = got.responseBody === undefined ? got : { ...got, responseBody: got.responseBody.slice(0, preset.maxBody) };
    next[i] = c;
    kept = next;
    if (answered(c.id, { status: c.status, responseType: c.responseType })) emit({ update: { id: c.id, status: c.status, responseBody: c.responseBody, responseType: c.responseType } });
  });
  // A page loaded again (or another one) in the tab gets the hooks again; a site the extension may not
  // read ends the recording.
  const loaded = (id: number, change: Browser.tabs.OnUpdatedInfo) => {
    if (id !== tabId) return;
    const url = change.url;
    if (url) void hasAccess(url).then(async (ok) => void (ok || (await stop(`no access to ${hostOf(url) || 'this page'}`))), () => undefined);
    if (change.status) void inject();
  };
  const closed = (id: number) => id === tabId && void stop('the tab was closed');
  const filter = { urls: ['<all_urls>'], tabId, types: webRequestTypes(preset.types) as Browser.webRequest.ResourceType[] };
  browser.webRequest.onBeforeRequest.addListener(sent, filter, ['requestBody']);
  browser.webRequest.onCompleted.addListener(completed, filter);
  browser.webRequest.onErrorOccurred.addListener(failed, filter);
  browser.tabs.onUpdated.addListener(loaded);
  browser.tabs.onRemoved.addListener(closed);

  async function stop(why?: string) {
    if (over) return;
    over = true;
    calls.end();
    browser.webRequest.onBeforeRequest.removeListener(sent);
    browser.webRequest.onCompleted.removeListener(completed);
    browser.webRequest.onErrorOccurred.removeListener(failed);
    browser.tabs.onUpdated.removeListener(loaded);
    browser.tabs.onRemoved.removeListener(closed);
    // Answers on their way still come for a moment (SETTLE_MS: as long as the recorder waits).
    setTimeout(fromPage, SETTLE_MS);
    void browser.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: unhookAnswers, args: [key] }).catch(() => undefined);
    if (why) emit({ ended: why });
  }
  await inject();
  return { stop: () => stop() };
}
