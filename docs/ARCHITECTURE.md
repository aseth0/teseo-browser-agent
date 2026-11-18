# Teseo — Architecture

## Context
Goal: a browser extension with an LLM chat that:
- connects to any OpenAI-compatible LLM provider (cloud and local),
- consumes AI standards (MCP, Agent Skills, WebMCP),
- adapts to **any website/domain** without requiring site-specific code,
- feeds page content to the model correctly and within budget,
- lets the model **interact** with the page (free reading, actions with per-domain confirmation).

There was an earlier prototype elsewhere; its blocker was modularity. This document defines the
architecture and a phased MVP in this repository.

Decisions: **Chrome MV3 + TypeScript + WXT** (React for the UI), side panel, autonomy =
*free reading + actions with confirmation*.

---

## Design principle
The core (agent loop) knows nothing about specific websites, providers or servers. It only talks
to **4 registries with stable interfaces**:

```
                ┌──────────── Side Panel (React chat UI) ────────────┐
                │ messages · model picker · confirmations · settings │
                └───────────────────────┬────────────────────────────┘
                                        │ chrome.runtime port
┌───────────────────────── Service Worker (background) ─────────────────────────┐
│  AgentLoop ──► Provider (OpenAI-compatible: OpenAI, Groq, Ollama, vLLM, …)    │
│      │                                                                        │
│      ├──────► ToolRegistry  ◄── BrowserTools (generic)                        │
│      │             ▲        ◄── McpClientManager (Streamable HTTP / SSE)      │
│      │             └─────── ◄── WebMCP · skills · templates · custom · …      │
│      ├──────► ContextPipeline (extractors → token budget)                     │
│      ├──────► SkillRegistry   (SKILL.md, progressive disclosure)              │
│      └──────► PolicyEngine    (per-domain permissions, confirmations)         │
└────────────────────────────────────┬──────────────────────────────────────────┘
                                     │ chrome.scripting + tabs.sendMessage / chrome.debugger
                         ┌───────────▼───────────┐
                         │ page-agent (tab)      │  a11y snapshot + refs, Readability,
                         │ injected on demand    │  actions, WebMCP bridge
                         └───────────────────────┘
```

---

## Key interfaces (`src/core/types.ts`)

```ts
// Neutral message format; the provider translates it to the wire format.
type Part =
  | { type: "text"; text: string; context?: boolean }  // context: true = injected page context, hidden in UI
  | { type: "image"; mediaType: string; data: string }
  | { type: "reasoning"; text: string }                // shown in UI; sent back only since the last user message
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean; images?: ImagePayload[] };

// 1. LLM providers
interface LLMProvider {
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
type ChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "reasoning-end" }                          // closes the current reasoning block
  | { type: "tool-call"; id: string; name: string; args: unknown }
  | { type: "done"; stopReason: string };

// 2. Tools — one shape, wherever they come from.
interface Tool {
  name: string;                 // namespaced: "browser.click", "mcp.github.create_issue"
  description: string;
  inputSchema: JSONSchema;
  source: "browser" | "mcp" | "webmcp" | "skill" | "template" | "user" | "history" | "memory"
        | "bookmarks" | "web" | "custom" | "agent";
  effect: "read" | "write" | "interact";  // write ⇒ goes through PolicyEngine/confirmation; interact: asks the user
  run(args: unknown, ctx: ToolContext): Promise<ToolResult>;  // text | image | json
}

// 3. Context blocks — the unit that goes into the model.
interface ContextBlock {
  kind: "page-meta" | "readable" | "a11y-tree" | "structured-data" | "selection" | "screenshot" | "custom";
  priority: number;                     // used for budget trimming
  content: string;
  tokensEstimate: number;
}
```

---

## How page content reaches the model (ContextPipeline)
Typical problem: dumping `innerText` or HTML → noise, exploding token counts, and the model doesn't
know where to click. Solution: **several small representations instead of one big one**, chosen by
budget.

1. **page-meta** (always, ~50 tokens): URL, title, language, scroll/viewport.
2. **a11y tree with refs** (generic, the backbone of interaction): the page script walks the DOM,
   keeps visible interactive/semantic elements (role, accessible name, value, state), assigns
   `ref_N` and keeps a `WeakRef<Element>` map. Compact YAML-like format:
   ```
   - navigation "Main"
     - link "Pricing" [ref_3]
   - textbox "Search" [ref_7] value=""
   - button "Sign in" [ref_8]
   ```
   Truncated by depth/viewport; the model can ask for more with `browser.read_page({ref, depth})`.
3. **readable**: Mozilla Readability + Turndown (with its GFM tables) → Markdown of the main content. On demand only
   (`browser.get_page_text`).
4. **structured-data**: JSON-LD, OpenGraph, microdata, tables → JSON. Cheap and dense for
   e-commerce, recipes, events.
5. **selection**: user-selected text (top priority when present).
6. **screenshot**: `chrome.tabs.captureVisibleTab`, only if the model has vision and asks for it.
7. **custom**: the output of the page's site template (`src/templates/`), when one matches.

**Default strategy:** each turn sends only `page-meta` + `selection` + a trimmed a11y snapshot.
Everything else the model pulls via tools (*pull, not push*). The budgeter (`src/context/budget.ts`)
sorts by `priority` and trims to a fixed token budget (~2000 per turn). Web content is wrapped in
`<untrusted_page_content>` and the system prompt explicitly says not to obey it.

**Persistence:** the per-turn context is stored in the user message itself as a hidden
`{ type: "text", context: true }` part (the background emits a `page-context` event to the panel).
The history is therefore append-only: later turns resend byte-identical earlier messages, which
keeps server-side prefix caches valid and makes the conversation reproducible. The one exception is
a compaction (`src/context/compaction.ts`): kept on the first message it leaves whole
(`Message.compaction`), it makes the turns before it go trimmed or summarized from then on, so the
prefix changes once and then stays the same; the stored history keeps every turn whole. Two more
savings change only what is sent: within a turn, the later requests send the latest tool results
whole and the earlier ones (and every screenshot and after-action element list but the latest) as a
note (`src/context/in-run.ts`); and a page block, site template output, site skill values or mention
the same as one the model still sees whole above goes as a note (`src/context/dedupe.ts`).

**Fixed texts:** every text the model receives (page instructions, skills catalog, the page and
site-skill blocks, the wrappers around tool results, tool descriptions) is a `{placeholder}`
template in `src/core/texts/` (one file per part of the request), tagged with when it is sent and, for replies to tool
calls, the tool it belongs to. The user overrides them in Options → Prompt preview (system and
user-message texts) and Options → Tools (each tool's description and replies, shared replies,
WebMCP), all saved in `settings.promptTexts`; the background applies the overrides at the start of every run. The page
script only returns data (action outcomes, `truncated` flags): the background formats it, so the
overrides apply there too. Error messages stay where they are raised and are not templates.

---

## How the model interacts (generic BrowserTools)
Actions take a `ref`, never model-generated CSS selectors (the read tool `browser.find_in_dom` takes
one to find elements, and answers refs like the others):

| tool | effect |
|---|---|
| `browser.read_page({ref?, depth?, filter?})` | read |
| `browser.get_page_text()` · `browser.find({query})` · `browser.find_in_dom({selector, attr?})` · `browser.get_html({selector?, from?, maxChars?})` · `browser.get_structured_data()` · `browser.screenshot()` | read |
| `browser.list_tabs({window?})` · `browser.scroll({ref?, direction})` | read |
| `browser.click({ref})` · `browser.type({ref, text, clear?, submit?})` · `browser.select({ref, value})` | write |
| `browser.press_key({key, ref?})` · `browser.navigate({url})` · `browser.switch_tab({tabId})` | write |

Execution (`src/content/actions.ts`): synthetic events from the page script — a real mouse's
pointer/mouse sequence + `element.click()`, the focus moved as a press moves it, and Playwright's
hit test (`vendor/playwright/actionUtils`): a click under a dialog or banner says so
(`action.click_covered`). Values are set through the prototype's native setter so React/Vue
controlled inputs notice them, after Playwright's `fill` checks for date, time, color, range and
number inputs; `<select>` by visible text or value. Keys carry `key`, `code` and `keyCode`, and do
the browser's part unless cancelled (Enter, Space, arrows on a `<select>`, Tab).
Actions run exactly once: if the reply never arrives because the page navigated, that counts as
success (`actOnPage` in `src/page/bridge.ts`). Afterwards the tool waits for the load to finish and
the DOM to settle, then returns the visible page *including text* (confirmations, errors, toasts). A click
is watched from right before the press (`content/change`, and a tab opened from it): one that changed nothing
says so instead of "clicked". What hovering or focusing shows does not count: a tooltip, and the look (class,
style, `data-*`) of the element and what holds it, unless it changes from the click event on.

**The DevTools engine** (Settings → Chromium DevTools, off by default): while it is on, the catalog
lays engine variants over the synthetic tools by name (`src/tools/browser/engine-tools.ts`,
`engineToolsFor`): `browser.click`, `type`, `press_key`, `scroll` send real input; `browser.screenshot`
captures any tab, one element (`ref`) or the whole page (`fullPage`), as a phone or in dark mode
(`view`), with sensitive fields masked (`content/mask`); `browser.wait_for` can also wait for the
network to be idle (`networkIdle`, requests counted by id only); `browser.hover` and `browser.drag` are
offered only then. No fallback, but one: a tab not shown (in the background, its window minimized),
which real input does not reach, gets the synthetic action and a reply that says so (hover, drag and
keys with modifiers fail and say why). While input is sent, the page widget's hosts (`ba-widget`) let
the pointer through (`content/locate` `inputStart`/`inputEnd`). Otherwise what the engine cannot do
fails and says why. Dialogs are not
intercepted: an input the page does not answer in 3 s ends the call and says the page may have one
open. `src/devtools/cdp.ts` is the only module that calls `chrome.debugger`: an allowlist of CDP methods
and events, attached for one call and detached in every case, one call per tab, refused while the
setting is off. The page script finds the element (`content/locate`: its center and box, hit-tested,
through open shadow roots), so the engine reaches only the sites the extension can read; before each
event the tab must still be on the call's site. The permission is required (the browser does not allow
it optional); the chat shows a DevTools chip and the icon `DBG` while it is attached.

**Recordings through DevTools** (Record with the engine on, `src/recording/devtools.ts`): the user picks a
mode (this tab, several tabs, tabs and mouse); the background holds each tab (`holdForRecording` in
`devtools/cdp`: tool calls on it fail meanwhile) and turns DevTools' network events into the same
`RecordedCall`s, also for Web Workers (auto-attached child sessions), WebSockets and the page's load;
static resources are dropped, header values and cookies never kept, secrets hidden on arrival. In
tabs-and-mouse mode the page script reports the user's clicks and typing (`content/steps`), never the
text of password, card or code fields. The review (`sidepanel/RecordingReview`) marks what looks
sensitive (`recording/sensitive`: ⚠ calls start unticked) and hides any value under a name, shown to
the model as `••••[name]`; a custom tool sends it as `{{secret:name}}` (`tools/secrets`), filled only
when the request goes to the tool's own site, masked in the answer, the tool confirmed every time. A
value the user chose to save waits in the secret store (`recording/pending-secrets`) until a tool that
uses it is saved.

**Dictation** (`src/voice/`, driven by `sidepanel/useDictation`): the microphone (`voice/mic`), a level meter and a
recorder per chunk (`voice/recorder`) around `voice/session`, each chunk sent through `voice/transcribe` and its text
put at the box's caret (`voice/insert`), while the strip inside the box (`sidepanel/DictationStrip`) shows the time,
the level, the words just in and the chunks out. The side panel and the other chats record in their own page, with the
microphone permission of the extension's origin (granted once by `entrypoints/mic` where the page cannot prompt). The
chat floating on a page cannot: the page's Permissions-Policy decides its frames' microphone. There the same session
runs in the offscreen document (`voice/offscreen`, opened by `background/dictation-host`) on a port from the chat
(`voice/remote`, `voice/protocol`), which hands back the texts, the level, the chunks out and the end; the port closing (the frame gone) drops it,
the microphone off, and the widget folding the chat stops it (`WIDGET_FOLDED`).

**A tab's audio** (`src/audio/`, its state machine `audio/session`, hosted by `background/audio-host`): one at a
time, started from the toolbar popup's Audio line or its command, whose gesture lets `tabCapture.getMediaStreamId` take that tab. The offscreen
document (`audio/offscreen-document`) holds it: `audio/tab-capture` records the whole
stream and plays it on, since capturing mutes the tab, and `audio/offscreen` transcribes the same stream with
`voice/session`, a chunk every 30 seconds, through `voice/transcribe` (`verbose_json` for line times, the text alone
where it is refused). There is no second transcriber: a tab's audio only tells the session not to stop at silence,
and to leave a failed chunk out to be sent again. Recording and transcript live in that document's memory, with
`audioStatus` in storage.session driving the popup, the icon (`background/badge`) and the review page
(`entrypoints/audio`, in a tab), which reads and edits the transcript by message. Stopped, it goes where the popup
said: the review opens, or the chat for the captured tab gets the transcript as a handoff (`chatAttach`, kind
`audio`) once every chunk is back, as an attached file does (`context/attached-file` `audioPart`).

**Speak** (`src/speech/`, hosted by `background/speech-host`): text read aloud by a provider's text-to-speech model
(`POST /audio/speech`), with a voice profile (Settings → Speak: provider, model, voice, speed; an agent's own, else the
default; a page widget action's own, else its agent's). One reading at a time, a new one replacing it and emptying a
queue of readings on their own (`queued`: an answer as its turn ends, `ui/chat/auto-read` and `sidepanel/useAutoRead`;
an action's boxes as its card shows them, `widget/ui/box-speak`), which wait their turn in the worker (`speech/session`)
and are dropped by key (`SPEAK_UNQUEUE`). A text still written (an answer as it streams) is read `growing`: started with
its final pieces (`speech/growing`: a piece is final once nothing more can join it), the whole text so far sent again
as it grows (`SPEAK_GROW`), the background passing the new final pieces on (`SPEAK_MORE` to `speech/player`, or the
system voice) until it is done, or has not grown for a minute. `speech/plan` cuts the text into pieces (`speech/pieces`: a
short first one, whole sentences, a long one cut at a pause) said as the language's reading rules and the user's pairs
say (`speech/spoken`, the rules as data per language in `speech/languages`). The offscreen document, created with
`AUDIO_PLAYBACK` beside `USER_MEDIA` (a document is closed only once none of its reasons holds it, so it stays open and
a capture is never cut), asks for one piece at a time while those back play back to back on one AudioContext
(`speech/player`), a piece that stops inside a sentence without its closing silence (`speech/trim`). Its status
(`speakStatus` in storage.session, with a run id a worker that woke checks against the document's) drives the pill
(`speech/pill`), the popup's line and the panel's buttons. Started from the panel's buttons and Settings' Test (the
provider's site asked for inside the click), the page widget's toolbar beside a selection (`widget/ui/speak-selection`, with the actions marked to show there and
their card, `widget/ui/selection-card`, the bubble's card from `widget/ui/actions-run` in a slot of its own),
its command (the tab's selection read with the key's access) and `speech.say` (`speech/tool`, offered by an agent's
switch in `background/run-setup`). Not where there is no offscreen document (`core/build` `speakAvailable`).

**The recorder** (`src/recording/recorder.ts`, hosted by `background/recording-host`): one recording at a
time, in the background, so it outlives any chat. Both hosts share `background/session-host`: the pill on each
tab the session is on (shown again when the tab loads a page), the shortcut that starts, stops or reviews it,
and the wait for what a worker that woke found. The toolbar popup's Record line and a shortcut start it
(extension pages and the command only; the pill on a recorded page may only stop it); a start that fails
leaves nothing behind and says why. It runs the DevTools engine above or, without it, `recording/webrequest`
(webRequest for the requests, page hooks for the fetch and XHR answers), with a preset (`recording/presets`,
Settings → Recording) that `recording/filter` applies as calls come, through one `recording/ledger` per recording
(the count, the dedupe, a call dropped by its answer, the time limit). Both engines read bodies through
`recording/bodies`: compressed ones unpacked (capped), binary ones shown by size. Its
status (`recordingStatus` in storage.session) drives the popup, the icon's count (`background/badge`, over
`DBG`) and the pill (`recording/pill`); what it caught is mirrored there for a worker that restarts. Stopped,
it waits as a handoff (`recordingHandoff`) for the chat floating on the tab or the side panel, opened inside
the Stop click as screenshots do; a chat still reviewing another leaves it waiting until that review ends.
Every handoff to a chat (a conversation from the widget, images, audio, a recording) is one envelope
(`core/handoff`: `{at, tab?, panelTab?, payload: {kind, …}}`), taken by `sidepanel/useHandoff`.
The review's **What the model gets** is `recordingPreview` (`recording/block`): the same block the message carries,
its size against Settings → Limits, and how many calls would go without their bodies.

---

## Per-domain modularity: what a site gets
There is no per-site code. On each run and when the panel's tab changes, what a page gets is
layered:

1. **WebMCP** — tools the page registers with `document.modelContext.registerTool` (W3C CG draft,
   Chrome origin trial; older builds: `navigator.modelContext` / `navigator.modelContextTesting`).
   `src/page/webmcp.ts` lists and runs them with short functions injected into the page's MAIN
   world (`chrome.scripting.executeScript`), on every run and when the panel's tab changes. They
   are offered as `webmcp.<name>`, always with `effect: 'write'` (site policy + confirmation), with
   the description wrapped as untrusted and the result inside `<untrusted_page_content>`; at most
   25 tools, 1,000-character descriptions and 20,000-character results. This is the site's own
   "official" path.
2. **Site skills** that match (`src/skills/match.ts`) → their instructions, as `<site_skill>` blocks
   (`src/skills/prompt.ts`).
3. **Site templates** that match (`src/templates/`) → a Liquid template that reads the page; its
   output goes with every message there as page content.
4. **The generic context** (always) → a11y + Readability + structured data.

A site with nothing special works the same, and an important site can be improved without touching
the core.

### Site Skills = standard Agent Skills + `matches`
Compatible with the Agent Skills standard (`SKILL.md` with frontmatter, `src/skills/parser.ts`),
extended with an optional `matches` list (Chrome match patterns, `src/skills/types.ts`):
- Skills **without** `matches` are general skills (e.g. "write a formal email"): only
  `name` + `description` go in the system prompt; the body and its reference files are loaded with
  `skills.load({name})` (progressive disclosure).
- Skill sources: built-in (`skills/*/SKILL.md` at the repository's root, bundled at build time and
  read-only), written in Settings → Skills, imported as JSON (`src/skills/io.ts`), or saved by the model
  (`skills.save`, reviewed by the user). Stored in `storage.local` through `createCollection`
  (`src/storage/collection.ts`).
- Skills carry instructions only, never code.

---

## MCP
- **Remote (directly from the service worker):** official `@modelcontextprotocol/sdk` client with
  **Streamable HTTP** transport (and legacy SSE), `src/mcp/manager.ts`. Auth via header/API key or OAuth
  (`chrome.identity.launchWebAuthFlow`, `src/mcp/oauth.ts`). Only the servers' tools are used, as
  `mcp.<server>.<tool>`; their resources and prompts are not read.
- **Local stdio:** not built (see below); an HTTP proxy such as `supergateway` covers local servers.
- Config in the `mcpServers` format (same JSON as Claude Desktop/Cursor) → direct import/export; exported without the headers' values unless asked ("{{apiKey}}" stays), and a value left empty is taken on import from a server at the same URL.

---

## LLM providers
- **OpenAI-compatible only** (`/chat/completions`): OpenAI, Groq, OpenRouter, Ollama
  (`http://localhost:11434/v1`), LM Studio, vLLM, LiteLLM and custom gateways. One adapter,
  `src/providers/openai-compat.ts`, built by `createProvider` in `src/providers/registry.ts`.
- Per-provider settings: Base URL, API key, default model, **extra headers** (JSON, supports the
  `{{apiKey}}` placeholder for non-`Authorization` auth) and **extra request body** (JSON merged into
  every request, e.g. `{"reasoning_effort": "high"}`).
- **Model lists:** `src/providers/model-list.ts` asks a server's `/models` once per page and endpoint.
  `src/providers/registered-models.ts` decides what the pickers offer: a provider's registered models
  (`ProviderConfig.models`, none: all it lists) and the last ones picked (`Settings.recentModels`,
  `providerId|model` keys, latest first). Both are optional fields older builds keep untouched.
- Neutral internal message format (roles + parts); the adapter translates. Capability flags
  (`tools`, `vision`) degrade behavior: without tools ⇒ chat-only mode with pre-injected context.
- **Reasoning:** `src/providers/reasoning.ts` extracts chain-of-thought from the non-standard ways
  servers expose it: delta fields `reasoning_content` (DeepSeek, vLLM, LM Studio, Qwen), `reasoning`
  (OpenRouter, Ollama), `reasoning_details` (OpenRouter), `thinking`, and inline
  `<think>…</think>` / `<thought>…</thought>` tags in content (safely split across chunks). It is
  emitted as `reasoning-delta` / `reasoning-end` events, shown live in the chat as a collapsible
  "Thinking…" block, and stored as `reasoning` parts. The answers since the last user message go back with
  theirs (`providers/wire`, the message's `reasoning` field), so that a model thinking between tool calls
  keeps on from it; older ones go without. A server that rejects the field is remembered and asked again
  without it (`NO_REASONING`). Some servers only emit reasoning when asked via the extra request body.
- Secrets (API keys, providers' extra headers, MCP servers' headers and client secrets and the
  provider whose key fills their `{{apiKey}}`, MCP OAuth sign-ins, custom tools' and their sources' header values) never live in `chrome.storage.local`,
  which content scripts can read and write and whose `onChanged` tells them every change:
  `storage/secrets` keeps them in the extension's own IndexedDB, which only its pages and worker can
  open. `loadSettings` puts them back into the settings; a change is told through `storage.local` as a
  random stamp (`secretsRev`), never the value. Each is kept with the URL it was saved for (a
  provider's base URL, an MCP server's URL, the build's key with its provider's) and goes back only
  while the URL in `storage.local` is that one: a page that changes the URL gets nothing sent there,
  and the user types the secret again. Secrets left in `storage.local` by earlier versions are moved
  once (`settleStoredSecrets`); one written there afterwards is removed unread, never taken. Ollama
  needs `OLLAMA_ORIGINS=chrome-extension://*`.

---

## Policy and security (PolicyEngine)
- Reading needs a host permission per site, requested at runtime from the page bar (or
  `<all_urls>` from Settings); nothing is granted upfront.
- Per-site action policy (`src/policy/store.ts`, by agent, in the extension's own IndexedDB like the
  secrets, so no content script can allow its own site): `ask` (default) | `auto` | `read-only`.
  Editable from the side panel's page bar and Settings; the chat floating on a page has none in its
  bar (the page could lead a click there). The action log kept "in this browser" lives there too, and
  so does what gives each agent its reach (`agents/profiles`, secret `agentAccess`: its sites, whether
  it uses only those, its tools, whom it may ask or be asked by, whether it is on; read only there,
  `storage.local` keeping the agent whole as a copy for earlier versions). So does what lets a custom tool send or act without asking (its header values,
  session, read-only) and whether it is on, kept for what the tool does as saved (`tools/custom/store`
  `secretsBoundTo`; `storage.local` keeps the tool without its header values): a tool or an agent a page
  writes to `storage.local`, or a tool whose request or code it changes there, is off and gets none of it
  (`storage/secret-part`). So does what gives a page widget action its reach (`widget/store`, secret
  `widgetActions`: its tool and arguments, where and when it runs, its prompt, its agent, whether it
  opens the chat) and whether it is on, kept for the action as saved (`storage.local` keeps it whole as
  a copy for earlier versions): an action a page writes there, or whose reach it changes, is off. Earlier versions kept them in
  `storage.local`: they are moved once (`moveOnce`, `once`), and anything written there afterwards is
  never read (dropped unread under the old keys). The MCP sign-ins of earlier versions are moved the
  same way. An MCP server's policy, its key in agents' sites and its logs go by its name (`mcp:<name>`):
  they move with it when it is renamed and go when it is removed (`mcp/server-keys`).
- *Known exception:* saved conversations (`history/store`), memory (`memory/store`) and the rest of the
  settings (system prompt, the model texts, agents' instructions) are still in `storage.local`, where a
  content script can read them, and write the latter. Moving them to the extension's IndexedDB is
  pending. Some of those settings give power, and a content script could change them there too:
  an MCP server's `trustReadOnlyHints` (its "read-only" tools run without asking), `enabled` and
  `onDemand`; the base URL of a provider without a key (Ollama, LM Studio: with `<all_urls>` granted,
  the conversation would go to another host without notice); `disabledTools`; and the browser agent's
  `canBeAsked` / `defaultCanAsk`.
- Before every tool call the loop calls `authorize()` (`src/policy/engine.ts`), which judges it by the
  site of the tab it targets (`tool.tabOf(args)`: the `tabId` argument, else the panel's tab) or of
  the URL it opens (`describe().url`: `navigate`, `web.read`, `web.show_user`). Read tools run freely
  on the panel's tab; on another tab they are confirmed like actions, since the user did not choose
  that tab. In `ask` mode the panel shows a confirmation card with the tool's `describe()` summary
  and the host ("Click button "Buy now"" on shop.test): **Allow / Allow on shop.test ▾ (In this
  conversation · Always) / Deny**. "In this conversation" allows the site for that chat only
  (`conversationPolicies` in `src/policy/store.ts`: storage.session by conversation, over the site
  policies). A
  denial or a `read-only` block goes back to the model as a tool error (`read-only` still allows reads).
  `alwaysAsk` may be a function of the arguments: `history.read` asks only in full.
- Site access: the manifest grants only the known cloud providers; any other provider site (local
  servers included) is asked for from Settings (Test connection) or from the chat the first time.
- Prompt-injection mitigation: web content is always wrapped as untrusted and the system prompt
  forbids acting on its behalf; with the default policy no action happens without the user. Web
  content cannot close or open an untrusted block: its `<untrusted_…` tags get a fullwidth `＜`
  (`neutralizeTags` in `core/origin-marks`, applied wherever web values are marked). A WebMCP schema
  past `webmcpSchema` is left out, and an HTTP custom tool's reply names its URL without the query.
- Loop limits: max steps per turn, Stop button (aborts and denies pending confirmations).
- Action log (Settings → Logs, `logs/actions`): every tool call with the policy's decision, the call's
  summary and site, never its arguments or results; off, per session or kept; exported as JSON.
- Word blacklist (Settings → Word blacklist, `src/word-blacklist/`): the user's sensitive terms are
  swapped for placeholders they chose (CLIENT_A) in everything a request carries (system prompt,
  messages, history, tool calls and results, tool descriptions), and put back in the streamed text,
  the reasoning and the tool calls' arguments before anything shows or runs them. Every request to
  a model goes through `blacklistGate(...).provider()` (`word-blacklist/gate`: the chat and its
  sub-agents, compaction summaries, the page widget); the history keeps the real terms and is masked
  again on every request. It applies with the providers/models listed or after a page that matches a
  URL pattern (both empty: always), and once a request of a conversation went masked, its answer is
  marked (`Message.masked`) and the rest of the conversation goes masked too. The chat's page bar
  shows it live, as the next request would go (`chatBlacklistState`), and its chip turns it on or off for
  one conversation (the run's `wordBlacklist`; off is asked first once something went masked, and lasts
  until the panel is opened again). A shield pill on your message and on a tool's result lists what was
  replaced, by where (`ui/chat/replaced`). Optionally every image
  goes as a note. The terms are a secret (`wordBlacklist`, IndexedDB); when it applies is in
  `storage.local` (`wordBlacklist`), where a content script could change it. Not covered: what the
  context hints at, and the Layers view, which shows the requests in real terms.
- The chat floating on a page is a page of its own, `floating.html` (`entrypoints/floating`), in an iframe of the
  page widget: the same chat app (`sidepanel/chat-main`), floating (`ui/floating-frame` `FLOATING`, from its path
  alone). It is the only file in `web_accessible_resources`, under the extension's fixed URL (not
  `use_dynamic_url`, whose frame a Chromium-based browser, Vivaldi, refuses): any page can frame it or open it,
  and so tell the extension is installed. It starts only in a web page's frame (`ui/framed-by-page`), with a
  one-time ticket (`background/frame-tickets`): the widget asks the background for one for its tab (only a
  content script in a tab's top frame can) and puts it in the frame's URL fragment (never in a request or a
  referrer); the page has the background redeem it before it imports anything of the chat (`sidepanel/ticket-gate`
  `startFloating`). The background redeems it only for `floating.html` in a frame (`frameId` > 0, never a tab's
  top document), issued for the frame's tab (the sender's, as the browser says), unused and less than 2 minutes
  old; it is spent either way. Opened in a tab of its own, or framed with no ticket or a bad one, the page stays an
  empty document. Tickets are kept in `storage.session` (`floatingTickets`), so a worker asleep in between keeps
  them. The frame's own scripts, styles and pdf.js's worker and data load from its own origin without being listed
  (measured in Chrome). Firefox's build has neither the page nor `web_accessible_resources` (no floating chat).
- `sidepanel.html` (the side panel, `?full`, `?tab=N`, the agent manager's chats, the Appearance preview) is not
  web-accessible: a web page that opens or frames it gets the browser's "blocked" page, and none can fetch its
  files (`chunks/`, `assets/`, `pdfjs/`). As a second line, framed by a web page it would not start
  (`sidepanel/ticket-gate` `startPanel`); it never floats, whatever its query.
- *Pending:* sensitive domains (banking, password managers) blocked by default.

---

## Folder structure
```
wxt.config.ts
skills/                      # built-in skills (SKILL.md), bundled at build time
templates/                   # built-in site templates (search engines and others)
src/
  entrypoints/
    background.ts            # wires the parts in src/background/
    page-agent.ts            # script injected on demand into the tab (isolated world)
    page-widget.ts           # the page widget's bubble, a content script registered by the background
    page-keys.ts             # the keys set in Settings → Shortcuts, heard in pages
    sidepanel/               # React: App, Chat, ErrorBoundary, usePageTarget; also full-screen in a tab (sidepanel.html?full)
    floating/                # floating.html: the chat floating on a page (the widget's iframe), its only web-accessible page
    manager/                 # the agent manager page: several chats (sidepanel.html?tab=…&manager iframes), one per tab
    options/                 # Settings
    popup/                   # the toolbar popup: a newer version's notice, site access, Record, a tab's Audio
    audio/                   # the review of a tab's audio
    mic/                     # the one-time microphone grant for dictation
    offscreen/               # the offscreen document (a tab's audio, the floating chat's dictation, reading aloud)
  background/  tool-catalog.ts  session.ts  agent-run.ts  run-setup.ts  sub-agent.ts  widget-host.ts  frame-tickets.ts (the floating chat's one-time tickets)  sticky-chat.ts (the floating chat's pinned conversation)  widget-run.ts  summarize.ts  capture-host.ts  floating-tabs.ts  panel-windows.ts (where the side panel shows, in Vivaldi)  panel-trace.ts (its opens and states, in storage.session `panelTrace`)
               memory-index.ts  session-host.ts  recording-host.ts  audio-host.ts  speech-host.ts   # a background session's host: its pill, shortcut and resume; the recorder's, a tab's audio's, reading aloud's
               badge.ts  notify.ts  open-chat.ts  shortcuts.ts  tab-access.ts  keep-awake.ts  float-to-panel.ts  panel-mode.ts  watches.ts
  core/        types.ts  agent-loop.ts  parts-builder.ts  tool-exec.ts  tool-args.ts  tool-registry.ts  protocol.ts (panel↔background messages)  handoff.ts (what is handed to a chat)  texts/ (TEXT_DEFS)
               sources.ts (the context parts' sources)  builder-ids.ts  memory-names.ts  site-policy.ts  mcp-keys.ts   # leaves that several feature folders name without importing each other
  browser/     open-manager.ts                  # host glue: the extension's pages opened in a tab, for the background and the pages (core calls no browser API; core/side-panel is to move here)
  providers/   openai-compat.ts  wire.ts  context-window.ts  registry.ts  reasoning.ts  sse.ts  headers.ts  connection-test.ts  provider-access.ts  util.ts
  tools/       browser/ (read-tools.ts  write-tools.ts  engine-tools.ts  watch-tools.ts)  custom/ (tools without code; script-tool.ts, the script base)  user/  define.ts  http.ts  load.ts  match.ts  match-turn.ts  match-meaning.ts  # Settings → Tools → Matching (docs/context.md)
  content/     a11y.ts  a11y-names.ts  dom-find.ts  dom-tree.ts  extractors.ts           # pure DOM extractors (jsdom-testable); never TEXT_DEFS (lint): core/clip, core/origin-marks
  vendor/      playwright/                      # Playwright's roleUtils and injected-script pieces (Apache-2.0): roles, names, hidden-ness (content/a11y-names); hit test, fill checks (content/actions)
  page/        bridge.ts  protocol.ts  webmcp.ts  access.ts  background-tab.ts   # background → page-agent messaging, site access, WebMCP
  context/     pipeline.ts  budget.ts  turn.ts  request.ts  compaction.ts  in-run.ts  dedupe.ts  sources.ts (re-exports core/sources)  …   # what goes with each message
  policy/      engine.ts  store.ts  agent-access.ts   # authorize(), site policies, agents' reach
  skills/      parser.ts  store.ts  match.ts  prompt.ts  tools.ts  io.ts   # Agent Skills + matches
  templates/   liquid.ts  render.ts  run.ts  store.ts  mentions.ts  tools.ts   # site templates (Liquid); run.ts runs them on a tab
  mcp/         manager.ts  connect.ts  oauth.ts  config.ts  servers.ts  server-keys.ts   # MCP client
  agents/      profiles.ts  registry.ts  builtins.ts  builder.ts  tools.ts  ask.ts   # agents: their reach, instructions and tools
  history/     store.ts  rank.ts  read.ts  auto.ts  mention.ts  tools.ts   # saved conversations
  bookmarks/   store.ts  auto.ts  mention.ts  tools.ts
  memory/      store.ts  prompt.ts  tools.ts  semantic.ts  query-meaning.ts  indexer.ts  vector-db.ts  # matching by meaning (docs/context.md); vectors in their own IndexedDB database
  markdown/    tree.ts                          # Markdown as an HTML tree (side panel, page widget)
               sections.ts                      # Headings grouped as sections that fold (chat, page widget)
  search/      bm25.ts                          # ranking for memory and bookmarks; history/rank.ts for conversations
  web/         tools.ts  results.ts             # web.search, web.read, web.show_user in background tabs
  script/      quickjs.ts  request.ts           # the script engine of custom tools (QuickJS in WebAssembly); the script tool is tools/custom/script-tool.ts
  widget/      actions.ts  output-lines.ts  steps.ts  run.ts  store.ts  protocol.ts  selection-bar.ts  ui/   # the page widget and its actions
  capture/     protocol.ts  plan.ts  run.ts  area.ts  page.ts   # screenshots from the popup and shortcuts into the chat (CHAT_ATTACH)
  audio/       protocol.ts  session.ts  tab-capture.ts  offscreen.ts  offscreen-document.ts  transcript.ts   # a tab's audio: its state, its capture in the offscreen document, its transcript
  voice/       session.ts  transcribe.ts  recorder.ts  mic.ts  protocol.ts  offscreen.ts  remote.ts   # dictation (the floating chat's in the offscreen document), and the transcription a tab's audio uses
  speech/      spoken.ts  pieces.ts  plan.ts  languages/  request.ts  trim.ts  player.ts  offscreen.ts  session.ts  protocol.ts  pill.ts  selection.ts  settings.ts  profiles.ts  tool.ts  markdown.ts   # Speak: text read aloud by a TTS model, in pieces, in the offscreen document
  recording/   recorder.ts  ledger.ts  devtools.ts  webrequest.ts  filter.ts  bodies.ts  pill.ts  presets.ts  review.ts  …   # a recording of a page's requests
  shortcuts/   keys.ts  listen.ts  script.ts   # keys set in Settings → Shortcuts, heard in pages (entrypoints/page-keys) and run by background/shortcuts
  storage/     settings.ts  settings-types.ts  settings-secrets.ts  settings-migrate.ts  settings-select.ts  keys.ts  collection.ts  secrets.ts
               export-file.ts  settings-transfer.ts  # Settings → Export and import: one file of parts (each a section's own export), secrets scrubbed
  watches/     store.ts  run.ts  conditions.ts  tab-holds.ts   # tab watches: stored, started and ended (background/watches listens)
  logs/        actions.ts                       # the action log (Settings → Logs)
  ui/                                           # the React pieces of Settings and the chat, shared by the pages
  look/        palette.ts                       # theme colors, shared by the React pages and the page widget
  manager/     protocol.ts  rows.ts  tabs.ts   # the agent manager's messages with its chats, its rows, the tabs offered
  word-blacklist/ core.ts  request.ts  gate.ts  store.ts   # sensitive terms masked for the model, restored in its answers
  devtools/    cdp.ts  mask-rules.ts            # the only chrome.debugger caller (the engine, tools/browser/engine*); the settings and the badge given by the background
tests/                       # vitest unit tests + fixtures, e2e/ (Playwright)
```
Libraries: `wxt`, `react`, `@mozilla/readability`, `turndown`, `@modelcontextprotocol/sdk`, `liquidjs`
(site templates), QuickJS (`quickjs-emscripten-core`, the script engine), `pdfjs-dist`, and the
`unified` / `remark` Markdown stack.

---

## Not built
Planned once, not in the code; kept here so the plan is not mistaken for the code.
- **Site adapters with code**: a `SiteAdapter` (matches, priority, `extract()`, `tools`) resolved by a
  `SiteAdapterRegistry` into a stack per URL, from a `sites/` folder, with `site.<name>.*` tools. Site
  skills and site templates cover the instructions and the page reading without code.
- **`adapter.js` in skills**: a skill's own extractors and tools, run in the script engine
  (`script/quickjs`) and reaching the page only through a declarative API (`page.query(role, name)`,
  `page.click(ref)`, `page.text(ref)`); or declarative YAML extractors.
- **A native bridge** (`native-bridge/`): a native messaging host that would launch stdio MCP servers
  and proxy them, or expose the extension as an MCP server. Better suited to a desktop app.
- **MCP resources and prompts**.

### Nice to have: fewer permissions at install
An idea, not designed yet. Today the extension asks at install for every permission in `wxt.config.ts`;
`bookmarks` and `<all_urls>` are already optional, asked for when their feature is turned on. Six install-time
permissions each serve a feature not everyone uses:
- `identity`: signing in to MCP servers with OAuth (`src/mcp/oauth.ts`);
- `search`: `web.search` through the browser's search engine (`src/web/tools.ts`);
- `tabGroups`: grouping the agent's background tabs (`src/page/background-tab.ts`; the side panel's
  `src/entrypoints/sidepanel/UserCards.tsx` unfolds a group);
- `notifications`: a tab watch that ended (`src/watches/run.ts`, `src/background/watches.ts`), and a recording
  or a tab's audio (`src/background/notify.ts`, from `recording-host.ts` and `audio-host.ts`);
- `cookies`: an HTTP custom tool's header taken from a cookie of its site (`src/tools/http.ts`), and
  `browser.site_access` (`src/tools/browser/site-access.ts`);
- `webRequest`: recording a page's requests (`src/recording/webrequest.ts`), and the header names
  `browser.site_access` reports (`src/tools/browser/site-access.ts`).

Options considered: (a) leave it as it is, chosen for now; (b) make optional the four whose prompt is mild
(`identity`, `search`, `tabGroups`, `notifications`), each asked for the first time its feature is used; (c) also
`cookies` and `webRequest`, only after checking that Chrome allows them as optional permissions in MV3 and how the
`declarativeNetRequest` rules that go with them behave (not verified). The cost: each optional permission is one more
place where a feature must say "this needs the permission" when it is denied; people who already have the extension
keep what they granted. It matters mostly for a Chrome Web Store listing (a shorter review, a less alarming install
prompt); loading the extension unpacked from GitHub, nothing practical changes. A possible shape, still to be
thought through: two builds, a "dev" build that asks for the permissions at install as today, and a "publish" build
without them (asked for when used). The store build that exists today (`pnpm zip:store`, `STORE=1`, no `debugger`
permission, no `key`) is the natural starting point for "publish"; the names and the split are not decided.

---

## MVP roadmap
1. **[done] Skeleton + chat** — WXT, React side panel, OpenAI-compatible provider with streaming and
   tool calls, live reasoning display, provider settings. *Done = chat from the side panel with a local
   and a cloud model.*
2. **[done] Page context** — injected page script, meta/a11y/readable/structured/selection extractors,
   token budget, persisted per-turn context, read-only tools (`read_page`, `get_page_text`, `find`,
   `get_structured_data`, `screenshot`, `list_tabs`). *Done = "summarize this page" and "what buttons
   are there?" work on any site.*
3. ✅ **Interaction + policy** — `ref`-based write tools, PolicyEngine, confirmation cards,
   multi-step agent loop with Stop (sensitive-domain blocklist pending). *Done = "search X on this site and open the first result" with
   confirmations.*
4. ✅ **Skills + per-site context** — SKILL.md parser, progressive disclosure, `matches`, built-in
   skills, skill import, site templates, WebMCP bridge (site adapters with code: not built, see above).
   *Done = on a site with a matching skill or template its instructions and content appear; elsewhere, generic.*
5. **MCP** — ✅ 5a: Streamable HTTP client (SSE fallback), `mcpServers` JSON import/export, servers
   discovered on a LiteLLM gateway, per-server policy and logs. 5b: ✅ OAuth (`mcp/oauth`: sign-in from Settings with `launchWebAuthFlow`, tokens per server, refreshed by the SDK). 5c: native bridge
   for stdio — not built, better suited to a desktop app (an HTTP proxy such as `supergateway` covers
   local servers meanwhile). *Done (5a) = use a remote MCP server from the chat.*
6. **Polish** — ✅ conversation history (saved locally, 🕘 panel, pinning, BM25 search with quoted
   phrases and prefix matching in the panel, `history.search`/`history.read`, `#` mentions,
   auto-attach); ✅ memory (pinned / per-site, whole when pinned or matched and else by title / indexed items, `memory.*` tools with reviewed saves
   and deletes); ✅ compaction (earlier turns trimmed, then summarized, kept on the history); ✅ web search (`web.search` / `web.read` / `web.show_user` in background tabs, results
   read with site templates); ✅ custom tools without code (derived from a tool, own parameters, HTTP
   requests; made by the user or, reviewed, by the model). ✅ log export (Settings → Logs). Firefox build:
   a trial (`wxt build -b firefox --mv3`, `wxt.config.ts`), without the side panel, the offscreen document,
   the DevTools engine, a tab's audio or Speak. What a build lacks is one registry (`core/build`: each
   feature, whether it is here, the reason, `browser` or `store`, its line and docs page; the store's
   choices in `STORE_LEAVES_OUT`: the DevTools engine and the sources of custom tools), told by one component (`ui/FeatureNotice`: a section's page, a greyed
   row whose mark opens why, Settings → About's summary). Every link out of the extension comes from
   `core/links`: the repository set at build time (`package.json`, or `TESEO_REPO_URL`), releases at
   `/releases/latest`, the docs at the version's tag in a release's build and the default branch otherwise.
   The downloadable release build (a release's, not the store's, of a GitHub repository) checks for a newer
   version (`core/update-check`, wired by `ui/useUpdateNotice`): the toolbar popup, once per browser session
   (`updateChecked` in storage.session) and after it renders, fetches `api.github.com/repos/<slug>/releases/latest`
   without credentials and keeps only its `tag_name`, validated as a version (`updateNotice` in storage.local:
   the latest found, the version whose popup notice was closed). The popup's line shows it until closed for that
   version, Settings → About while the installed version is older; Settings `updateCheck: false` (About's switch)
   stops the request. It is the extension's only request not set up by the user.

---

## Verification
- `pnpm dev` builds `dist/chrome-mv3-dev` and keeps it updated (HMR); it never opens a browser
  (`webExt.disabled` in `wxt.config.ts`): load that folder unpacked once.
- Unit tests (Vitest + jsdom): a11y/readable extractors on saved HTML fixtures, token budget, provider
  stream parsing (incl. reasoning formats), agent loop, SKILL.md parser, PolicyEngine.
- E2E (Playwright with `--load-extension`) against a mock OpenAI-compatible server with scripted
  responses (streaming, non-streamed JSON, reasoning, tool calls, errors); phase 3 adds form-filling
  with confirmation checks.
- Manual per phase against each "Done =", using a local model through Ollama and a cloud provider.
- MCP: run `@modelcontextprotocol/server-everything` in HTTP mode and check tool listing/calls.
