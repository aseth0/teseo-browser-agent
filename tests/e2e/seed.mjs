// What every scenario starts from in the extension's storage and secrets, from the scenarios' tables:
// the arguments (seedArgs) and what writes them (seedStorage), run inside the extension, in its worker
// or one of its pages. Shared by the e2e (sidepanel.e2e.mjs) and Firefox's smoke run (firefox-smoke.mjs).
import { actionPart, PORT } from './lib.mjs';
import { AGENT_PROFILES, APPEARANCE, CHAT_VIEW, CHAT_WINDOW, COMPACTION, CONVERSATIONS, CUSTOM_TOOLS, DISABLED_TOOLS, LIMITS, MEMORY, PAGE_ACTIONS, SITE_POLICIES, SKILLS, SPEAK, TEMPLATES, VOICE, WEB_SEARCH, WORD_BLACKLIST } from './scenarios/tables.mjs';

export const seedArgs = (scenario, model) => ({ actionParts: Object.fromEntries((PAGE_ACTIONS[scenario] ?? []).map((a) => [a.id, actionPart(a)])), compaction: COMPACTION[scenario], appearance: APPEARANCE[scenario], chatWindow: CHAT_WINDOW[scenario], SITE_POLICIES, scenario, port: PORT, model, disabledTools: DISABLED_TOOLS[scenario] ?? [], userSkills: SKILLS[scenario] ?? [], userTemplates: TEMPLATES[scenario] ?? [], chatView: CHAT_VIEW[scenario] ?? { steps: 'inline' }, limits: LIMITS[scenario] ?? {}, conversations: CONVERSATIONS[scenario] ?? [], webSearch: WEB_SEARCH[scenario] ?? {}, customTools: CUSTOM_TOOLS[scenario] ?? [], pageActions: PAGE_ACTIONS[scenario] ?? [], agents: AGENT_PROFILES[scenario] ?? [], memory: MEMORY[scenario] ?? [], wordBlacklist: WORD_BLACKLIST[scenario], voice: VOICE[scenario], speak: SPEAK[scenario] });

// Self-contained: it is sent to the browser as its source.
export async function seedStorage({ actionParts, compaction, appearance, chatWindow, SITE_POLICIES, scenario, port, model, disabledTools, userSkills, userTemplates, chatView, limits, conversations, webSearch, customTools, pageActions, agents, memory, wordBlacklist, voice, speak }) {
  await chrome.storage.session.clear(); // a chat floating on the shop, a handoff
  const granted = new Set(chrome.runtime.getManifest().host_permissions);
  const added = (await chrome.permissions.getAll()).origins?.filter((o) => !granted.has(o)) ?? [];
  if (added.length) await chrome.permissions.remove({ origins: added });
  const providerURL = `http://localhost:${port}/v1`;
  // What the extension keeps apart from storage.local, as it keeps it (storage/secrets): seeded there,
  // with every move out of storage.local done, so the worker, whatever it reads meanwhile, never
  // takes the seed for what an earlier version left (a page's, once the moves are done).
  // As tools/custom/store's secretsBoundTo: what a custom tool's secrets are kept for.
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  const boundTo = (c) => JSON.stringify(sorted([c.base, c.params, c.inputs ?? [], c.http && { method: c.http.method, url: c.http.url, body: c.http.body, extract: c.http.extract, headers: (c.http.headers ?? []).map((h) => h.name) }, c.script ?? '', c.uses ?? []]));
  const ACCESS = ['sites', 'onlyItsSites', 'tools', 'canAsk', 'canBeAsked', 'enabled'];
  const kept = {
    sitePolicies: { browser: SITE_POLICIES[scenario] ?? {} }, // the browser agent's under "browser" (policy/store)
    settings: { providers: { env: { baseURL: providerURL, apiKey: 'x' } } },
    agentAccess: Object.fromEntries(agents.map((a) => [a.id, Object.fromEntries(ACCESS.map((f) => [f, a[f]]))])),
    customToolSecrets: Object.fromEntries(customTools.map((c) => [c.id, { enabled: c.enabled, ...(c.http && { headers: c.http.headers, session: c.http.session, readOnly: c.http.readOnly }), boundTo: boundTo(c) }])),
    widgetActions: actionParts, // widget/store, as lib's actionPart
    ...(wordBlacklist && { wordBlacklist: wordBlacklist.entries }), // word-blacklist/store
    moved: Object.fromEntries(['mcpAuth', 'sitePolicies', 'actionLog', 'settingsSecrets', 'agentAccess', 'customToolSecrets', 'customToolSourceSecrets', 'widgetActions', 'mcpProviderIds'].map((id) => [id, true])),
  };
  // Under the extension's own lock for its secrets (storage/secrets updateSecret, 'secrets'), and
  // before storage.local is cleared: the worker answers that clear by settling the settings'
  // secrets (a read, then a write), and a write of what it read before the seed would undo it.
  await navigator.locks.request('secrets', () => new Promise((resolve, reject) => {
    const open = indexedDB.open('browser-agent', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('secrets');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('secrets', 'readwrite');
      const secrets = tx.objectStore('secrets');
      secrets.clear();
      for (const [name, value] of Object.entries(kept)) secrets.put(value, name);
      tx.oncomplete = () => (open.result.close(), resolve());
      tx.onerror = () => reject(tx.error);
    };
  }));
  // In storage.local, without them.
  await chrome.storage.local.clear();
  const openTool = ({ http, ...c }) => ({ ...c, enabled: false, ...(http && { http: { method: http.method, url: http.url, body: http.body, extract: http.extract, ...(http.headers && { headers: http.headers.map((h) => ({ name: h.name, value: '' })) }) } }) });
  const openAgent = (a) => Object.fromEntries(Object.entries(a).filter(([k]) => !ACCESS.includes(k)));
  await chrome.storage.local.set({
    convIndex: conversations.map(({ history: _h, ...meta }) => meta), // none to go on with, except the scenario's
    ...Object.fromEntries(conversations.map((c) => [`conv:${c.id}`, c])),
    skills: { user: userSkills, disabledBuiltins: [] },
    templates: { user: userTemplates, disabledBuiltins: [] },
    customTools: { user: customTools.map(openTool), disabledBuiltins: [] },
    pageActions: { user: pageActions, disabledBuiltins: [] },
    agents: { user: agents.map(openAgent), disabledBuiltins: [] },
    memory: { user: memory, disabledBuiltins: [] },
    pageWidgetPlaces: {},
    ...(wordBlacklist && { wordBlacklist: wordBlacklist.config }),
    settings: {
      mentions: { forceTool: model === 'inline-mentions' },
      history: { resume: model === 'history' ? 'recent' : 'never', autoAttach: { enabled: model === 'history-auto' } },
      webSearch,
      providers: [{ id: 'env', name: 'Mock', baseURL: providerURL, apiKey: '', defaultModel: model }],
      activeProviderId: 'env',
      systemPrompt: 'test',
      disabledTools,
      chatView,
      limits,
      pageWidget: { everywhere: false }, // the bubble only where actions match, unless a scenario says otherwise
      chatWindow,
      appearance,
      compaction,
      voice,
      speak,
      devtoolsTools: model.startsWith('engine-') || scenario.startsWith('rec-'), // Settings → Chromium DevTools: the DevTools engine (scenarios/devtools)
    },
  });
}
