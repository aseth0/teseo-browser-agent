# Privacy and security

An assistant that reads your pages and acts in your browser must be trustworthy by construction. This page says
what Teseo sends, where, and what keeps pages and models in check. The formal policy is
[PRIVACY.md](../../PRIVACY.md).

## Where your data goes

Teseo has **no servers of its own, no telemetry, no analytics and no update checks**. It sends requests
only to:

| Destination | When |
|---|---|
| The **providers** you set up | Every message (with the page block), model lists, voice transcription, a tab's audio you ask to transcribe, the text you have [read aloud](speak.md) (to the provider of its voice profile) |
| The provider of **Semantic search**, if you turn it on | The text of your memory items (not pinned ones), and each message, to match them by meaning. It may not be the provider of your chat ([Memory](memory.md#settings--memory)) |
| The **MCP servers** you add | When their tools are listed or called, and to sign in |
| The **APIs of your custom tools** | When those tools run |
| The **sites** the model reads or acts on | With your permission, as you would visit them |
| Your **search engine** | When the model searches, in a background tab |

Conversations, memory, settings and logs stay in the browser's storage. Nothing is synced to a cloud account.

## What the model sees

- With each message: the page block (URL, title, selection, visible elements), and what **Settings →
  Auto-inject** adds. Turn the page off with the **Page** button, or leave things out with the ✨ menu.
- When you send from the side panel while on another tab than the chat's: that tab's id, title and URL.
- With `browser.list_tabs`: the titles and URLs of your open tabs, in the chat's window or in every window.
- What the model reads with its tools, and the results of tools it runs.
- Never: your API keys, header values, cookies, saved secrets or password field values (shown as `••••`).

## Permissions

- **Sites.** The extension reads no website until you allow it, one by one or all at once (**Settings → Website
  access**). Browser pages, the Chrome Web Store and `file:` pages are never read.
- **Actions.** Each site's policy decides whether clicking, typing and navigating asks first (the default), runs
  at once or is refused. Reading another tab than the chat's asks first too, unless that site is set to **Act
  without asking** or **Read only**. See [Acting on pages](acting-on-pages.md#permissions-in-three-layers).
- **Agents** are confined to their own tools and sites; an agent with *Only its sites* cannot even read others.

### Browser permissions

The extension asks the browser for what its features need (`wxt.config.ts` says why for each):

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | Settings, memory and saved conversations, which carry the page content of every message |
| `sidePanel` | The chat in the side panel |
| `tabs` | The tab the chat works on, its title and URL; the [tab picker](chat.md#the-tab-picker) and `browser.list_tabs` |
| `scripting` | Reading and acting on a page: the extension's script goes into the tab, only on sites it may read |
| `activeTab` | The browser's temporary access to the tab you are on when you click the extension's icon or use its shortcuts (also what lets the popup's and the shortcuts' screenshots capture that tab) |
| `search` | `web.search` with the browser's default search engine, when no other is set |
| `tabGroups` | Background tabs (web search and reading, sub-agents) go into a folded tab group |
| `identity` | Signing in to MCP servers with OAuth |
| `declarativeNetRequestWithHostAccess` | Requests to MCP servers without an `Origin` header, only on sites with access |
| `cookies` | An HTTP custom tool's header from a cookie of its own site (`{{cookie:NAME}}`, such as a CSRF token) |
| `webRequest` | `browser.site_access` sees the names of the headers a site's own requests send, never their values |
| `offscreen` | The document that holds a tab's audio while it is captured, and plays what is [read aloud](speak.md) |
| `tts` | The system's voice [reads aloud](speak.md) when you have no voice profile: the voices the operating system and the browser offer, with no provider of yours |
| `tabCapture` | [A tab's audio](tab-audio.md), only the tab you ask for, after you click the extension's icon or use its shortcut |
| `alarms`, `notifications` | A [tab watch](tab-watches.md) ends on time while the extension sleeps, and tells you; [what waits for you](chat.md#when-the-agent-waits-for-you) while the chat is not in view tells you (Settings → Alerts) |
| `debugger` | The [DevTools engine](devtools-engine.md) and recording through DevTools, only while **Settings → Chromium DevTools** is on. Required, since the browser does not allow it to be optional. Not in the Chrome Web Store version, which has no DevTools engine |
| `favicon` | The tabs' icons in the tab picker, from the browser's own cache: the site is not asked for them |
| Hosts `api.openai.com`, `api.groq.com`, `openrouter.ai` | The cloud providers of the presets, granted at install |
| Optional: every site (`<all_urls>`) | **Website access**: asked site by site, or all at once |
| Optional: `bookmarks` | [Bookmarks](bookmarks.md), asked in **Settings → Bookmarks** |

Any other provider's server is asked for when you first use it (**Test connection**, or the chat's access card).
Local servers (`localhost`) too: granting them at install would cover every port, and the model could reach any
local service without asking.

The **microphone** is not a permission of the extension's manifest. The side panel cannot show the browser's
prompt for it, so **Allow microphone** opens a tab that asks for it once, for [voice dictation](voice.md). The chat
floating on a page does not ask the site: it records in the extension's offscreen document with that same permission.

## Prompt injection

A web page can contain text written to manipulate an AI ("ignore your instructions and…"). Teseo's
defenses:

- **Everything from outside is marked as untrusted data**: page content, tool results, MCP answers, saved
  conversations, other agents' answers, each in its own `<untrusted_…>` block, with the instruction to treat it as
  data and never follow instructions in it.
- **Actions need your permission** by default, and the card shows exactly what will happen.
- **An allowed action runs only on the site you allowed it for**: if the tab went elsewhere meanwhile, it is not
  done.
- **Nothing is created because a page says so**: skills, tools, actions and agents are made only when you ask,
  and you review each one before it is saved. With **Builder** on, only Builder can create them.
- **The model cannot reach your secrets**: a `{{secret:…}}` it writes in a tool's arguments is broken up, not
  filled.
- The protective texts can be edited in **Prompt preview**, which warns before you weaken them.

No defense against prompt injection is complete. Keep the default **Ask before acting** on sites where an action
matters, prefer **Read only** where the model only needs to read, and give agents only the sites they need.

## Secrets

- API keys, header values, MCP sign-ins, custom tools' secrets, the word blacklist, site policies and the action
  log are kept in the extension's own IndexedDB, which web pages and the extension's page scripts cannot open.
- A provider's key is bound to the URL it was saved for; change the URL and the key must be typed again.
- Secret values are filled in only when a request is sent, only to their own site, and are masked in the answers
  the model gets.
- Stored values are not encrypted at rest: anyone with access to your browser profile can read them, as for the
  browser's own saved data.

## Word blacklist

**Settings → Word blacklist** replaces names and other terms with placeholders before anything is sent to
the model, and puts them back in its answers. See [Word blacklist](word-blacklist.md).

## Scripts and the DevTools engine

- **Script tools** run in a JavaScript engine of their own (QuickJS, compiled to WebAssembly) with no network, no
  browser API and no `eval` in the extension itself. They reach only their own site,
  through the extension, which adds the headers and session they need without the script seeing them; at most 50
  requests per call and 30 seconds by default (Settings → Limits), and 1.5 seconds of running on without waiting.
- **The DevTools engine** is off by default. When on, it attaches Chrome's debugger to one tab for one call, with
  a fixed list of allowed commands (input, screenshots, emulation, network events); the model never chooses the
  command. Screenshots paint over passwords, card numbers, one-time codes and other sites' frames.

## Reporting a vulnerability

See [SECURITY.md](../../SECURITY.md).
