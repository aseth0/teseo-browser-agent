// The service worker: it wires the parts in src/background together. Nothing there runs when it is
// imported (WXT loads this file while building); each part starts listening when called here.
import { setValueMarking } from '../core/model-texts';
import { loadSettings, syncWidgetSettings } from '../storage/settings';
import { SETTINGS_KEY } from '../storage/settings-types';
import { moveLegacySignIns } from '../mcp/oauth';
import { watchKey } from '../storage/watch';
import { createSessions } from '../background/session';
import { listenSummarize } from '../background/summarize';
import { createToolCatalog } from '../background/tool-catalog';
import { hostWidget } from '../background/widget-host';
import { listenWidgetRuns } from '../background/widget-run';
import { listenWatches } from '../background/watches';
import { listenAlerts } from '../background/alerts';
import { listenDevtools } from '../devtools/cdp';
import { setBadgePart } from '../background/badge';
import { listenSettingsEdits, settingsNow } from '../background/settings';
import { listenPanelMode } from '../background/panel-mode';
import { listenPanelWindows } from '../background/panel-windows';
import { hostCapture } from '../background/capture-host';
import { hostRecording } from '../background/recording-host';
import { hostAudio } from '../background/audio-host';
import { agentVoiceProfile, hostSpeech } from '../background/speech-host';
import { DEFAULT_AGENT_ID } from '../agents/builtins';
import { listenPageKeys } from '../background/shortcuts';
import { keepPageKeysScript } from '../shortcuts/script';
import { listenFloatingTabs } from '../background/floating-tabs';
import { keepEnvKey } from '../background/env-key';
import { moveLegacyPolicies } from '../policy/store';
import { moveLegacyActionLog } from '../logs/actions';
import { listenMemoryIndex } from '../background/memory-index';
import { tabHolds } from '../watches/tab-holds';

export default defineBackground(() => {
  // The settings' changes a page hands over inside the click that made them: first, as the message
  // that woke the worker may be one.
  listenSettingsEdits();
  // What a worker that died mid-run left in the tabs, given back: first, before a run holds any.
  tabHolds.recover().catch((e: unknown) => console.error('[tab holds]', e));
  // The window's side panel, or one per tab (the chat's pin).
  listenPanelMode();
  // Which windows' side panel shows, where opening it again would close it (Vivaldi).
  listenPanelWindows();
  // The conversation keeps where each value comes from, for the panel's Layers view; the marks
  // are stripped from what is sent to the model.
  setValueMarking(true);
  // The key injected at build time, kept where the pages read it (only this file has it).
  // Then the settings loaded once, for what loading does: secrets that earlier versions kept in
  // storage.local, which content scripts can read, moved to storage/secrets.
  keepEnvKey()
    .catch((e: unknown) => console.error('[env key]', e))
    .then(() => loadSettings())
    .catch((e: unknown) => console.error('[settings]', e));
  // The MCP sign-ins, the site policies and the action log too: content scripts could write or read
  // them there.
  moveLegacySignIns().catch((e: unknown) => console.error('[sign-ins]', e));
  moveLegacyPolicies().catch((e: unknown) => console.error('[policies]', e));
  moveLegacyActionLog().catch((e: unknown) => console.error('[action log]', e));
  // The page widget's own copy of the settings it needs, kept as they are.
  const syncWidgetCopy = () => syncWidgetSettings().catch((e) => console.error('[widget]', e));
  void syncWidgetCopy();
  watchKey('local', SETTINGS_KEY, () => void syncWidgetCopy());

  // Speak: text read aloud in the offscreen document, from the panel, the widget, Settings, its shortcut
  // and the agents' speech.say.
  const speech = hostSpeech(agentVoiceProfile);
  const toolsFor = createToolCatalog((text, agentId, tabId) => speech.start({ text, agentId: agentId ?? DEFAULT_AGENT_ID, tabId, key: 'agent' }));
  listenSummarize();
  // The memory items' vectors, while Settings → Memory → Semantic search is on.
  listenMemoryIndex();
  listenWatches();
  // What waits for the user while the chat is not in view: the badge's "!" and notifications (Settings → Alerts).
  listenAlerts();
  // The DevTools engine's debugger: what is attached, and detaches the browser does.
  listenDevtools({ settingsNow, setDebuggerBadge: (tabs) => setBadgePart('debugger', tabs) });
  // ⏺: the one recording of a page's requests, from the popup and its shortcut.
  hostRecording();
  // A tab's audio, captured from the popup in the offscreen document.
  hostAudio();
  // Closing the chat floating on a tab, or the tab, stops its run (the sessions start listening last).
  hostWidget((tabId) => sessions.stopFloating(tabId));
  listenWidgetRuns(toolsFor);
  // Screenshots into the chat from the popup and their shortcuts, and where the chat floats for them.
  listenFloatingTabs();
  hostCapture();
  // The keys set in Settings → Shortcuts: heard in the pages the extension may read, run here.
  keepPageKeysScript();
  listenPageKeys();
  const sessions = createSessions(toolsFor);
});
