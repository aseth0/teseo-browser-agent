// The page widget (widget/): its script registered where its actions match, its shortcuts, the
// actions of a page, the chat floating on a tab (and moved from it to the side panel), and the
// conversations it hands to the chat. A
// page's request is checked against the page it really comes from.
import { browser } from 'wxt/browser';
import { openSidePanel } from '../core/side-panel';
import { serialized } from '../storage/serial';
import { agentStore } from '../agents/profiles';
import { bestEffort } from '../core/errors';
import { onRuntime, sendTab } from '../core/runtime';
import { isExtensionPage, senderOf } from '../core/sender';
import { storageGet, storageRecord } from '../storage/area';
import { settingChanged } from '../storage/settings-select';
import { SETTINGS_KEY } from '../storage/settings-types';
import { actionOwner, actionsFor, answersInJson, askedPrompt, filledPrompt, onLoad, pageValues, readsOnItsOwn, showsBesideSelection, widgetReads } from '../widget/actions';
import { withPageText } from './widget-page-text';
import { hasSteps } from '../widget/steps';
import { ACTIONS_KEY, CHAT_HANDOFF, FLOAT_COMMAND, FLOATING_PREFIX, WIDGET_ACTIONS, WIDGET_CHATS, WIDGET_COMMAND, WIDGET_FLOAT, WIDGET_FLOATING, WIDGET_OPEN_CHAT, WIDGET_PLACE, WIDGET_PLACES, WIDGET_STICKY, WIDGET_TO_PANEL, WIDGET_TOGGLE, STICKY_UNPIN, type ConversationPayload, type WidgetPlace, type FloatingChat, type OpenChatAction, type WidgetActionsReply } from '../widget/protocol';
import { handoff, type HandoffTo } from '../core/handoff';
import { actionStore, bubbleEverywhere, syncWidgetScript, wakeWidget } from '../widget/store';
import { floatOnTab } from '../widget/float';
import { grantedOneByOne } from '../page/granted';
import { chatTarget } from '../capture/plan';
import { floatToPanel } from './float-to-panel';
import { changePlace, loadPlaces, widgetSite } from '../widget/places';
import { isObject } from '../core/util';
import { onConversationsDeleted } from '../history/store';
import { pinFloating, unpinIf } from './sticky-chat';
import { markFloating } from './floating-tabs';
import { panelFollowsNow } from './panel-mode';
import { panelShownIn } from './panel-windows';
import { settingsNow } from './settings';
import { onShortcut } from './shortcuts';

// The page a widget message comes from: its tab's URL, which follows an SPA's moves (history.pushState)
// where the sender's own URL keeps the one it loaded with. Only the top frame shows the widget.
export const pageUrl = (sender: Browser.runtime.MessageSender) => sender.tab?.url ?? sender.url;

// The actions shown on a page (none while Settings → Bubble has the widget off).
export const pageActions = async (url: string | undefined) => {
  const settings = await settingsNow();
  if (settings.pageWidget?.enabled === false) return [];
  const [actions, granted, agents] = await Promise.all([actionStore.load(), grantedOneByOne(), agentStore.load()]);
  return actionsFor(actions, url, granted, agents);
};

// Whether the bubble is hidden on that page's site (its ✕): nothing of it runs there then.
export const hiddenOn = async (url: string | undefined) => {
  const site = widgetSite(url);
  return !!site && !!(await loadPlaces())[site]?.hidden;
};

// The sites a change of the places shows again (hidden before, not now).
const shownAgain = ({ oldValue, newValue }: { oldValue?: unknown; newValue?: unknown }): string[] => {
  const before = (oldValue ?? {}) as Record<string, WidgetPlace | undefined>;
  const now = (newValue ?? {}) as Record<string, WidgetPlace | undefined>;
  return Object.keys(before).filter((site) => before[site]?.hidden && !now[site]?.hidden);
};

// A model's answer in the widget, kept to open in the chat; the last few, across worker restarts.
type KeptChat = Omit<ConversationPayload, 'kind'> & { at: number };
const keptChats = () => storageRecord<KeptChat>('session', WIDGET_CHATS);
const keeping = serialized(WIDGET_CHATS); // two answers kept at once keep each other
export const keepChat = (chat: Omit<ConversationPayload, 'kind'>): Promise<string> =>
  keeping(async () => {
    const id = crypto.randomUUID();
    const recent = Object.entries(await keptChats()).sort(([, a], [, b]) => b.at - a.at).slice(0, 4);
    await browser.storage.session.set({ [WIDGET_CHATS]: Object.fromEntries([...recent, [id, { ...chat, at: Date.now() }]]) });
    return id;
  });
// An action that opens the chat: its message, sent at once in a new conversation with its agent.
const sendFromAction = async (url: string | undefined, tabId: number | undefined, req: OpenChatAction, to: HandoffTo) => {
  const action = (await pageActions(url)).find((a) => a.id === req.id && a.openChat);
  if (!action) return;
  const owner = actionOwner(action, await agentStore.load());
  if (owner === null) return;
  const values = await withPageText(action, pageValues(action, req), tabId);
  if ('error' in values) {
    console.error('[widget]', values.error);
    return;
  }
  await browser.storage.session.set({ [CHAT_HANDOFF]: handoff<ConversationPayload>({ kind: 'conversation', messages: [], send: askedPrompt(action, values), shown: filledPrompt(action, values), ...(owner && { agentId: owner.id }) }, to) });
};
const handOff = async (id: string, to: HandoffTo) => {
  const kept = (await keptChats())[id];
  if (!kept) return;
  const { at: _at, ...chat } = kept;
  await browser.storage.session.set({ [CHAT_HANDOFF]: handoff<ConversationPayload>({ kind: 'conversation', ...chat }, to) });
};

// Whether the chat floats on that tab; a closed tab's is forgotten.
const floatingOn = async (tabId: number | undefined) => tabId !== undefined && FLOATING_PREFIX + tabId in (await browser.storage.session.get(FLOATING_PREFIX + tabId));

// `stopFloating`: the run of the chat floating on a tab stops when it closes (or its tab does).
export function hostWidget(stopFloating: (tabId: number) => void) {
  const syncWidget = () => syncWidgetScript().catch((e) => console.error('[widget]', e));
  void syncWidget();
  // Reloaded or updated: the open tabs get the new widget (theirs is cut off from the extension).
  browser.runtime.onInstalled.addListener(() => void syncWidgetScript(true).catch((e) => console.error('[widget]', e)));
  browser.permissions.onAdded.addListener(() => void syncWidget());
  browser.permissions.onRemoved.addListener(() => void syncWidget());
  browser.storage.onChanged.addListener((changes, area) => {
    const toggled = settingChanged(changes[SETTINGS_KEY], (s) => s.pageWidget ?? {});
    if (area === 'local' && (ACTIONS_KEY in changes || toggled)) void syncWidget();
    // Shown again on a site (Settings → Bubble, the shortcut, the chat floated there): its open tabs get
    // the widget, which a page left while it was hidden.
    if (area === 'local' && WIDGET_PLACES in changes) for (const site of shownAgain(changes[WIDGET_PLACES])) void wakeWidget(site).catch((e) => console.error('[widget]', e));
  });
  // An agent's actions follow its sites (kept apart from it: agents/profiles) and whether it is on.
  agentStore.onChanged(() => void syncWidget());
  // The widget's shortcuts: show or hide it on this site; open or fold the chat floating there. Where it
  // is hidden, the page has none of it: the site is shown again here (its tabs get it, above).
  onShortcut((command) => {
    if (command !== WIDGET_COMMAND && command !== FLOAT_COMMAND) return;
    void browser.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([tab]) => {
      if (tab?.id === undefined) return;
      if (command === FLOAT_COMMAND) return void (await floatOnTab(tab.id, { type: WIDGET_FLOAT, toggle: true }));
      if (await hiddenOn(tab.url)) await changePlace(widgetSite(tab.url), { hidden: false });
      else await bestEffort(sendTab(tab.id, { type: WIDGET_TOGGLE }), 'command');
    }).catch((e: unknown) => console.error('[widget]', e));
  });
  onRuntime(WIDGET_ACTIONS, (_msg, sender) => {
    if (!senderOf(sender).fromPage) return;
    return Promise.all([pageActions(pageUrl(sender)), settingsNow(), floatingOn(sender.tab?.id)]).then(
      ([actions, settings, floating]): WidgetActionsReply => {
        if (floating && sender.tab?.id !== undefined) markFloating(sender.tab.id, true); // for a capture's shortcut (capture/run)
        return {
          actions: actions.map((a) => {
            const reads = widgetReads(a); // {{page}}: the background reads it (widget-page-text)
            return {
              id: a.id, name: a.name, input: a.input, ...(a.icon && { icon: a.icon }), ...(a.placeholder && { placeholder: a.placeholder }),
              ...((answersInJson(a) || hasSteps(a)) && { json: true }), ...(Object.keys(reads).length && { reads }), ...(onLoad(a) && { load: true }), ...(a.openChat && { openChat: true }),
              ...(readsOnItsOwn(a) && { readsAloud: true }), ...(showsBesideSelection(a) && { besideSelection: true }),
            };
          }),
          ...(bubbleEverywhere(settings) && { always: true }),
          ...(floating && { floating: true }),
        };
      },
      (e): WidgetActionsReply => {
        console.error('[widget]', e);
        return { actions: [] };
      },
    );
  });
  onRuntime(WIDGET_FLOATING, (msg, sender) => {
    const tabId = sender.tab?.id;
    if (!senderOf(sender).fromPage || tabId === undefined) return;
    const key = FLOATING_PREFIX + tabId;
    // Opened: the conversation it showed in this tab, if any, goes on.
    const keep = async () => browser.storage.session.set({ [key]: (await storageGet<FloatingChat>('session', key)) ?? {} });
    markFloating(tabId, msg.open); // for a capture's shortcut (capture/run)
    if (!msg.open) stopFloating(tabId); // closed: its run stops
    return (msg.open ? keep() : browser.storage.session.remove(key))
      .catch((e) => console.error('[widget]', e))
      .then(() => ({}));
  });
  onRuntime(WIDGET_OPEN_CHAT, (msg, sender) => {
    const tab = sender.tab;
    if (!senderOf(sender).fromPage || tab?.id === undefined) return;
    // Right away, inside the listener: the click's gesture only lasts that long. The answer to go
    // on with waits for the panel, also when it could not be opened (the user opens it). With the
    // chat floating on that tab, it goes there instead; with the chat's pin off, to the tab's panel.
    const { chat, action, floating } = msg;
    const follows = panelFollowsNow();
    const { panel, to } = chatTarget(tab.id, !!floating, follows);
    const opened = panel ? openSidePanel(tab, follows, panelShownIn(tab.windowId), 'widget-open-chat').then(() => ({ opened: true }), () => ({ opened: false })) : Promise.resolve({ opened: true });
    if (chat) void handOff(chat, to);
    if (action) void sendFromAction(pageUrl(sender), sender.tab?.id, action, to).catch((e) => console.error('[widget]', e));
    return opened;
  });
  onRuntime(WIDGET_STICKY, (msg, sender) => {
    const tab = sender.tab;
    if (!senderOf(sender).fromPage || tab?.id === undefined || typeof msg.on !== 'boolean') return;
    return pinFloating({ id: tab.id, incognito: tab.incognito }, msg.on).then((sticky) => ({ sticky }), (e: unknown) => {
      console.error('[widget]', e);
      return { sticky: false };
    });
  });
  onRuntime(STICKY_UNPIN, (msg, sender) => {
    if (!isExtensionPage(sender) || typeof msg.conversationId !== 'string') return;
    return unpinIf([msg.conversationId]).then(() => ({}), (e: unknown) => (console.error('[widget]', e), {}));
  });
  onConversationsDeleted((ids) => void unpinIf(ids).catch((e: unknown) => console.error('[widget]', e)));
  // "Open in the side panel" on the floating chat's bar: right away, inside the listener, as above.
  onRuntime(WIDGET_TO_PANEL, (_msg, sender) => {
    const tab = sender.tab;
    if (!senderOf(sender).fromPage || tab?.id === undefined) return;
    return floatToPanel({ id: tab.id, windowId: tab.windowId }, panelFollowsNow());
  });
  // A widget's place on its site, one change at a time with the others' (widget/places). Only its own
  // page's site, as the browser says: one page neither moves nor hides the widget of another site.
  onRuntime(WIDGET_PLACE, (msg, sender) => {
    if (!senderOf(sender).fromPage || typeof msg.site !== 'string' || !isObject(msg.patch)) return;
    const site = widgetSite(sender.url ?? sender.tab?.url);
    if (!site || msg.site !== site) return;
    return changePlace(site, msg.patch);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(FLOATING_PREFIX + tabId);
    stopFloating(tabId);
  });
}
