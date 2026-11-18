// Running an action (widget/client): as its agent (none: Default), with the model when it has a
// prompt (its own, else its agent's, else the chat's), whose answer goes to the port as it comes.
// A write is held to the site policies of its agent, or of the widget (Website access), and asked
// in the card (`confirm`). Closing the port stops it. Only the extension's own pages (Settings →
// Actions' Try) may send an action not saved yet.
import { browser } from 'wxt/browser';
import { serialized } from '../storage/serial';
import { agentLabel, agentStore, type AgentProfile } from '../agents/profiles';
import { policyAccessFor } from '../policy/agent-access';
import { effectivePolicy } from '../policy/store';
import { WIDGET_AGENT } from '../agents/registry';
import { errorText } from '../core/errors';
import { floatingChatAvailable } from '../core/build';
import { senderOf } from '../core/sender';
import type { Message } from '../core/types';
import { DEFAULT_LOG_MODE, logAction, logEntry } from '../logs/actions';
import { storageRecord } from '../storage/area';
import type { Settings } from '../storage/settings';
import { activeTarget, thinkingLevel } from '../storage/settings-select';
import { markdownTree } from '../markdown/tree';
import { actionOwner, answersInJson, onLoad, pageValues, widgetReads, type WidgetAction } from '../widget/actions';
import { withPageText } from './widget-page-text';
import { hasModelStep, hasSteps } from '../widget/steps';
import { readPageValues } from '../context/pipeline';
import { WIDGET_RUN, type ActionConfirm, type CardDecision, type WidgetConfirmReply, type WidgetRunEvent, type WidgetRunReply, type WidgetRunRequest } from '../widget/protocol';
import { runWidgetAction, type ActionAccess, type ActionModel } from '../widget/run';
import { gatedProvider, unreachable } from '../providers/provider-access';
import { keepAwake } from './keep-awake';
import { settingsNow } from './settings';
import { urlOfTab } from './tabs';
import type { ToolsFor } from './tool-catalog';
import { hiddenOn, keepChat, pageActions, pageUrl } from './widget-host';

const WIDGET_RUN_MS = 5 * 60_000; // waiting for the card's answer too

// The answers of actions on page load, by what they ran with: across worker restarts, a while.
const LOAD_CACHE_MS = 10 * 60_000;
const LOAD_CACHE = 'widgetLoadCache';
const cacheWrites = serialized(LOAD_CACHE);
const cacheEntries = () => storageRecord<{ at: number; reply: WidgetRunReply }>('session', LOAD_CACHE);
const loadCache = {
  async get(key: string): Promise<WidgetRunReply | undefined> {
    const all = await cacheEntries();
    const hit = all[key];
    return hit && Date.now() - hit.at < LOAD_CACHE_MS ? hit.reply : undefined;
  },
  // One at a time: two answers kept at once keep each other.
  set: (key: string, reply: WidgetRunReply) =>
    cacheWrites(async () => {
      const all = await cacheEntries();
      const fresh = Object.entries(all).filter(([, v]) => Date.now() - v.at < LOAD_CACHE_MS);
      await browser.storage.session.set({ [LOAD_CACHE]: Object.fromEntries([...fresh, [key, { at: Date.now(), reply }]]) });
    }),
};

// The boxes' texts as Markdown, for the card.
const MARKDOWN_MS = 150;
const withMarkdown = (reply: WidgetRunReply): WidgetRunReply =>
  'outputs' in reply ? { ...reply, outputs: reply.outputs.map((o) => (o.text ? { ...o, tree: markdownTree(o.text) } : o)) } : reply;

// Writes asked in the card (`send`), waiting for its answer: denied once the run stops (the card
// closed, or the time is up), also when it already had; the run's reply then takes the card's place.
// `inPage`: the card is in a page (its port a content script's), whose renderer could answer for the
// user: allowed once at most, never "always" (a site policy kept for good).
export function cardConfirms(send: (e: WidgetRunEvent) => void, inPage = false) {
  const waiting = new Map<string, (d: CardDecision) => void>();
  const confirm = (request: ActionConfirm, signal: AbortSignal) => new Promise<CardDecision>((resolve) => {
    if (signal.aborted) return resolve('deny');
    const id = crypto.randomUUID();
    const deny = () => {
      waiting.delete(id);
      resolve('deny');
    };
    signal.addEventListener('abort', deny, { once: true });
    waiting.set(id, (d) => {
      signal.removeEventListener('abort', deny);
      resolve(d);
    });
    send({ type: 'confirm', id, ...request });
  });
  const answer = (reply: WidgetConfirmReply) => {
    waiting.get(reply.id)?.(inPage && reply.decision === 'always' ? 'allow' : reply.decision);
    waiting.delete(reply.id);
  };
  return { confirm, answer };
}

// What an action may do: its agent's policies as saved now, over the widget's column in Website access
// (none: the widget's alone), asked in the card; its calls logged.
function actionAccess(owner: AgentProfile | undefined, settings: Settings, confirm: ActionAccess['confirm']): ActionAccess {
  const site = policyAccessFor(owner, WIDGET_AGENT);
  return {
    ...(owner && { agent: owner }),
    tabUrl: urlOfTab,
    getPolicy: async (host) => effectivePolicy({}, await site.policies(), host),
    setPolicy: site.save,
    confirm,
    log: (call) => void logAction(logEntry(call, { source: 'widget', ...(owner && { agent: agentLabel(owner) }) }), settings.logs?.actions ?? DEFAULT_LOG_MODE),
  };
}

// The model an action asks, when it has a prompt or a model step (its own, else its agent's, else the
// chat's; none: the run says there is no model to answer). Its answer goes to the card as it comes, and
// as Markdown too, at most every MARKDOWN_MS (not a JSON one); `stop` drops the Markdown still to go.
// `url`: the page it was asked from, which decides with the provider whether the word blacklist applies.
async function actionModel(
  action: WidgetAction,
  owner: AgentProfile | undefined,
  settings: Settings,
  url: string | undefined,
  send: (e: WidgetRunEvent) => void,
  onExchange: (messages: Message[]) => void,
): Promise<{ model?: ActionModel; stop: () => void } | { error: string }> {
  const { provider: cfg, model: name } = activeTarget(settings, action.model ? action : owner);
  if (!((action.prompt?.trim() || hasModelStep(action)) && cfg && name)) return { stop: () => undefined };
  const blocked = await unreachable(cfg);
  if (blocked) return { error: blocked };
  const thinking = action.thinking ?? thinkingLevel(settings, cfg.id, name);
  let said = '';
  let timer: ReturnType<typeof setTimeout> | undefined; // the next Markdown of the answer so far
  const sendMarkdown = () => ((timer = undefined), send({ type: 'markdown', tree: markdownTree(said) }));
  const onDelta = (kind: 'text' | 'reasoning', text: string) => {
    send({ type: 'delta', kind, text });
    if (kind !== 'text' || answersInJson(action) || hasSteps(action)) return;
    said += text;
    timer ??= setTimeout(sendMarkdown, MARKDOWN_MS);
  };
  const provider = await gatedProvider(cfg, { pageUrl: async () => url });
  return { model: { provider, model: name, thinking, onDelta, onExchange }, stop: () => clearTimeout(timer) };
}

// From Try (`tabId`: the tab it was given), what an action with steps reads, read on its tab here; none
// otherwise (the page read it itself).
async function triedReads(action: WidgetAction, tabId: number | undefined): Promise<{ reads: Record<string, string> } | { error: string } | undefined> {
  // {{page}} aside: withPageText reads it.
  const tokens = tabId !== undefined && hasSteps(action) ? [...new Set(Object.values(widgetReads(action)))] : [];
  if (!tokens.length) return undefined;
  const read = await readPageValues(tabId!, tokens);
  if (read.error) return { error: `The tab cannot be read: ${read.error}` };
  return {
    reads: Object.fromEntries(Object.entries(widgetReads(action)).map(([n, token]) => {
      const v = read.values[token];
      return [n, v && 'text' in v ? v.text.trim() : ''];
    })),
  };
}

export function listenWidgetRuns(toolsFor: ToolsFor) {
  const runAction = async (req: WidgetRunRequest, sender: Browser.runtime.MessageSender, send: (e: WidgetRunEvent) => void, confirm: ActionAccess['confirm'], signal: AbortSignal): Promise<WidgetRunReply> => {
    const { fromExtension, fromPage } = senderOf(sender);
    // Hidden on its site (its ✕): nothing of the bubble runs there until it is shown again; a page
    // that still asks (stale, or not the widget) gets nothing.
    if (fromPage && (await hiddenOn(pageUrl(sender)))) return { error: 'The bubble is hidden on this site.' };
    const action = fromExtension && req.action ? req.action : (await pageActions(pageUrl(sender))).find((a) => a.id === req.id);
    if (!action) return { error: 'This action is not available on this page any more.' };
    const owner = actionOwner(action, await agentStore.load());
    if (owner === null) return { error: 'The agent this action belongs to is switched off.' };
    // Try runs on the tab it was given.
    const tabId = fromPage ? sender.tab?.id : fromExtension ? req.tabId : undefined;
    const settings = await settingsNow();
    const { registry } = await toolsFor(tabId, settings);
    const access = actionAccess(owner, settings, confirm);
    let exchange: Message[] | undefined; // the request and its answer, for "Open in the chat"
    const onExchange = (messages: Message[]) => (exchange = messages);
    const asked = await actionModel(action, owner, settings, pageUrl(sender), send, onExchange);
    if ('error' in asked) return asked;
    const read = await triedReads(action, fromExtension ? tabId : undefined);
    if (read && 'error' in read) return read;
    const reads = read ? read.reads : req.reads;
    const values = await withPageText(action, pageValues(action, { ...req, reads }), tabId);
    if ('error' in values) return values;
    // On page load, the same values within LOAD_CACHE_MS get the answer they got (walking through
    // fifty tickets is not fifty requests when you come back to one).
    const cacheKey = onLoad(action) && fromPage ? JSON.stringify([action, values]) : undefined;
    const cached = cacheKey && (await loadCache.get(cacheKey));
    if (cached) return cached;
    let reply: WidgetRunReply;
    try {
      reply = withMarkdown(await runWidgetAction(action, values, registry.list(), { tabId, signal, settings }, access, asked.model, { onStep: (step) => send({ type: 'step', step }), onExchange }));
    } finally {
      asked.stop(); // the reply carries it whole (none when it failed)
    }
    // With its conversation kept for the chat's buttons, then kept as it is shown (a cached one too). The
    // two icons (here, in the side panel) only where the chat can float: else its one Open in the chat.
    if (exchange && 'outputs' in reply) reply = { ...reply, chat: await keepChat({ messages: exchange, ...(owner && { agentId: owner.id }) }), ...(action.chatButtons && floatingChatAvailable() && { chatIcons: true }) };
    if (cacheKey && 'outputs' in reply) await loadCache.set(cacheKey, reply);
    return reply;
  };
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== WIDGET_RUN || !port.sender) return;
    const { fromExtension, fromPage } = senderOf(port.sender);
    if (!(fromPage || fromExtension)) return port.disconnect();
    const closed = new AbortController();
    port.onDisconnect.addListener(() => closed.abort());
    const send = (e: WidgetRunEvent) => !closed.signal.aborted && port.postMessage(e);
    const { confirm, answer } = cardConfirms(send, fromPage);
    port.onMessage.addListener((req: WidgetRunRequest | WidgetConfirmReply) => {
      if (req?.type === 'confirm-reply') return answer(req);
      if (req?.type !== WIDGET_RUN) return;
      // Awake while it runs: the card's answer, or a model's first token, may take longer than the
      // worker is given when idle (this port has no keepalive pings, unlike the chat's).
      const awake = keepAwake();
      awake(true);
      void runAction(req, port.sender!, send, confirm, AbortSignal.any([closed.signal, AbortSignal.timeout(WIDGET_RUN_MS)]))
        .catch((e): WidgetRunReply => ({ error: errorText(e) }))
        .then((reply) => send({ type: 'reply', reply }))
        .finally(() => awake(false));
    });
  });
}
