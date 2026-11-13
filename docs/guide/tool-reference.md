# Tool reference

Every tool the model can be offered: what it does, how it is confirmed, the parameters worth knowing, and when
it is offered at all. To switch tools on or off, edit their descriptions or load them on demand, see
[Tools and tools on demand](tools.md).

## Names

Each tool has a dotted name (`browser.click`). APIs accept only letters, digits, `_` and `-` in a tool's name, so
the model sees the dots as `__` (`browser__click`); any other character becomes `_`, and the name is cut at 64
characters. **Settings → Tools** lists the tools by the name the model sees.

Two tools whose names come out the same (`mcp.a.b__c` and `mcp.a__b.c`, or two cut to the same 64 characters):
the second is left out, with only a warning in the extension's console. This can happen to MCP, custom and
WebMCP tools.

## How to read the tables

**Effect**, as the badges in **Settings → Tools** show it:

- **read**: reads, changes nothing;
- **write**: changes something, or opens a site;
- **interact**: asks you something in the chat.

**Confirmation**:

- **Never**: runs at once.
- **Site policy**: as the site's policy says ([site policies](acting-on-pages.md#2-what-the-model-may-do-on-each-site)):
  a card with **Ask before acting**, at once with **Act without asking**, refused with **Read only**.
- **Always**: a card every time, whatever the site's policy.

A tool that reads runs without asking on the chat's own tab. Called with the `tabId` of another tab, it is judged
by that tab's site policy, like an action (with **Read only** it still runs), and the card names the tab.

## When a tool is offered

A tool is offered when it is ticked in **Settings → Tools**; to an agent other than Browser, when the agent was
given it. Some tools also need:

- **the DevTools engine**: `browser.hover`, `browser.drag`, and the engine's extra parameters;
- **a permission**: the `bookmarks.*` tools, once you allow bookmarks;
- **a setting**: `history.*` while conversations are saved, `memory.*` while memory is used, `skills.load` and
  `skills.read_reference` while a general skill is on;
- **someone to ask**: `agents.ask`; in a row of the [Agents Panel](agent-manager.md#agents-that-start-agents) you
  started, also `panel.start`, `panel.wait` and `panel.send`;
- **a `tools.load` call**: the [tools on demand](tools.md#tools-on-demand), the 12 tools that create things
  (for Browser) and the tools of an MCP server set so. While Builder is on, Browser is not offered the tools that
  create things at all: they are Builder's.

A tool you [mention](tools.md#mentioning-a-tool) with `$tool.name` is offered for that message even when it is off.

## Browser (`browser.*`)

Most browser tools take `tabId` (from `browser.list_tabs`). Without it they work on the chat's tab, even if you
switched to another one.

**Reading**

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `browser.list_tabs` | Open tabs: the chat's tab and the one you are looking at are marked | read | Never | `window`: `current` (default, the chat's window) or `all` (every window, installed apps' too) |
| `browser.read_page` | The page's elements, each with its ref, such as `[ref_k3x_12]` (at most 800) | read | Never | `ref`: one area only; `filter`: `all` or `interactive`; `maxDepth` |
| `browser.get_page_text` | The main text as Markdown | read | Never | `maxChars` (7,000 by default, at most 50,000); `from`: read on after a cut |
| `browser.find` | Elements whose role, name or text contain every word of a query, whatever its case and accents | read | Never | `query` |
| `browser.find_in_dom` | Elements matching a CSS selector, in open shadow roots and same-origin frames too (lists 20, counts the rest) | read | Never | `selector`; `attr`: only elements with an attribute value containing this text |
| `browser.get_html` | Cleaned HTML of the elements matching a selector | read | Never | `selector` (default `body`); `maxChars`, at most the tool result limit less 300 characters (11,700 by default); `from` |
| `browser.get_structured_data` | JSON-LD, OpenGraph and the meta description (at most 15,000 characters) | read | Never | — |
| `browser.screenshot` | A picture of the visible part of the tab, which must be in front of its window | read | Never | With the DevTools engine: any tab, `ref` (one element), `fullPage`, `view`: `mobile` or `dark` |
| `browser.wait_for` | Waits until an element is gone or appears, and/or an area stops changing | read | Never | `gone`, `appears` (words, as in `browser.find`); `ref`: the area; `stableMs` (1,500 when no condition is given); `timeoutSec` (60 by default, at most 120); `returnText`; `networkIdle` (DevTools engine only) |
| `browser.scroll` | Scrolls the page, or an element | read | Never | `direction`: `up`, `down`, `left` or `right`; `ref` |
| `browser.site_access` | The names of a site's cookies and the API requests its page sends, never their values | read | Never | — |

**Watching a tab** ([tab watches](tab-watches.md))

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `browser.watch` | Watches a tab in the background; the turn can end meanwhile | read | Always | `gone`, `appears`; `css`: they are CSS selectors; `stableMs`; `minutes`; `notify` and `continueChat` (both on by default) |
| `browser.unwatch` | Cancels a watch this conversation started (never yours or another conversation's) | read | Never | `id` |

**Acting**

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `browser.click` | Clicks an element | write | Site policy | `ref` |
| `browser.type` | Types into a field, replacing its value | write | Site policy | `ref`, `text`; `clear: false` adds to the value; `submit: true` presses Enter after |
| `browser.select` | Chooses an option of a drop-down, by its text or value | write | Site policy | `ref`, `value` |
| `browser.press_key` | Presses a key on an element, or on the focused one | write | Site policy | `key`, `ref`; `modifiers` (Shift, Control, Alt, Meta) with the DevTools engine only |
| `browser.navigate` | Opens a URL in the tab: `http` and `https` only | write | Site policy (of the site it opens) | `url` |
| `browser.switch_tab` | Brings a tab to the front of its window; the chat keeps working on its own tab | write | Site policy | `tabId` (required) |
| `browser.hover` | Moves the mouse over an element without clicking (DevTools engine only) | write | Site policy | `ref` |
| `browser.drag` | Drags an element onto another, or by some pixels (DevTools engine only) | write | Site policy | `ref`; `to` (an element) or `dx` / `dy` |

With **Settings → Chromium DevTools → Run the browser tools on DevTools** on, `click`, `type`, `press_key`,
`scroll`, `screenshot` and `wait_for` run on the [DevTools engine](devtools-engine.md) (marked so in Settings and
the tools menu), and `hover` and `drag` are offered. `browser.select` stays synthetic.

Off, `click` sends a real mouse's events (the pointer over the element, then pressed and let go, with
`pointerType` "mouse") and moves the focus the way a press does; something else on top of the element at its center
(a dialog, a banner) is named in the reply, *clicked, but … is on top of it*. `type` checks the value of a date, time,
color, range or number field before it goes in, and refuses a checkbox or a button (click those). An element inside a
disabled `<fieldset>`, or under an `aria-disabled` one, counts as disabled. `press_key` sends synthetic key events with what a real key carries (`key`, `code`, and the `keyCode` many
pages still read), on the element focused first, and does the browser's own part unless the page cancels the key:
Enter presses a button or link or sends a form, Space presses a button or ticks a checkbox, the arrows, Home and End
move a drop-down's choice, Tab moves the focus. A page that ignores synthetic events (`isTrusted`) needs the engine.

## Tools (`tools.*`)

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `tools.read_more` | The next part of a tool result or attached file that was cut for length | read | Never | `id` (from the cut's note); `from`: where to read on |
| `tools.load` | Loads a group of [tools on demand](tools.md#tools-on-demand), offered from the next step to the end of the conversation | read | Never | `groups`: `create`, `mcp:<server>` |

`tools.read_more` is offered to every agent that has tools; `tools.load`, while a group on demand is not loaded
yet.

## You and the chat (`user.*`, `chat.*`)

These ask you directly in the chat ([when the model asks you](user-tools.md)): there is no confirmation card.

| Tool | What it does | Effect | Parameters |
|---|---|---|---|
| `user.ask` | Asks you 1 to 4 questions and waits for the answers | interact | `questions`, each with `type`: `choice`, `multi` or `text`, and `options` |
| `user.pick_element` | Asks you to click an element on the chat's tab | interact | `prompt`: what to click |
| `user.plan` | Shows the plan of a task and how it goes | interact | `steps`, each `pending`, `in_progress` or `done` |
| `chat.compact` | Compacts the conversation once the turn ends ([compaction](compaction.md)) | read | `instructions`: what the summary must keep |

## Saved conversations (`history.*`)

Offered while **Settings → History → Save conversations** is on. See [saved conversations](history.md).

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `history.search` | Searches the saved conversations, best matches first | read | Never | `query` (`"a phrase"` in quotes); `limit` (5 by default, at most 10) |
| `history.read` | Reads one saved conversation | read | Never; Always with `full: true` | `id`; `full`: also its tool results and page content |

## Memory (`memory.*`)

Offered while **Settings → Memory → Use memory** is on. Each agent gets only the items it is given. See
[memory](memory.md).

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `memory.search` | Searches the items, best matches first | read | Never | `query`; `limit` (5 by default, at most 10) |
| `memory.list` | Lists the items, latest first | read | Never | `site`: the items of a host and those for every site; `pinned`; `offset`; `limit` (20 by default, at most 50) |
| `memory.read` | Reads one item in full | read | Never | `id` |
| `memory.save` | Saves a new item, or changes one (what the call leaves out stays); the model is told to update an item that covers or contradicts it rather than add another | write | Always | `id` (none: a new item); `title` (at most 80 characters, required for a new one); `text`; `pinned`; `domains`; `agents` |
| `memory.delete` | Deletes an item | write | Always | `id` |

On a save's card you can edit the title, the text and the sites before allowing it.

## Web (`web.*`)

See [web search](web-search.md).

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `web.search` | Searches with your search engine | read | Never; Always with **Settings → Web search → Ask before each search** | `query`; `limit` (the number set in Settings → Web search, at most 10) |
| `web.read` | Reads a page by its URL in a background tab of its own; waits while you sign in if the page asks | write | Site policy (of the URL's site) | `url` (`http`, `https`); `maxChars` (as `browser.get_page_text`); `from` |
| `web.show_user` | Opens a page in a new tab in front of you, without reading it | write | Site policy (of the URL's site) | `url` |

## Bookmarks (`bookmarks.*`)

Offered only once you allow bookmarks in **Settings → Bookmarks**. See [bookmarks](bookmarks.md).

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `bookmarks.search` | Searches bookmarks by title, URL and folder | read | Never | `query`; `limit` (10 by default, at most 20) |
| `bookmarks.list` | Lists a folder's bookmarks and subfolders | read | Never | `folderId` (none: the top) |
| `bookmarks.save` | Bookmarks a page | write | Always | `url` (default: the chat's page); `title`; `folderId` |
| `bookmarks.delete` | Deletes a bookmark or an empty folder | write | Always | `id` |

## Skills (`skills.*`)

See [skills](skills.md). An agent reads and changes only the skills it was given; Builder, any.

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `skills.load` | Loads a skill's full instructions | read | Never | `name` |
| `skills.read_reference` | Reads a reference file of a loaded skill | read | Never | `name`, `path` |
| `skills.read` | Reads one of your skills whole, on or off, to change it | read | Never | `name` |
| `skills.save` | Saves a new skill, or changes one (only what the call gives) | write | Always | `name`; `description`; `instructions` or `edits`; `urlPatterns` |
| `skills.delete` | Deletes a skill (built-in skills can only be switched off) | write | Always | `name` |

`skills.load` and `skills.read_reference` are offered only while a general skill (one without websites) is on.

## Site templates (`templates.*`)

See [site templates](site-templates.md).

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `templates.run` | Runs a template on a tab and says what each view and call matched | read | Never | `name` (a saved one) or `views` (a draft); `view`: run this one whatever the URL; `tabId` |
| `templates.load` | Returns a saved template, to fix or update it | read | Never | `name` |
| `templates.save` | Saves a template, or changes the views the call names | write | Always | `name`; `description`; `urlPatterns`; `views` (`remove`, `before`) |
| `templates.delete` | Deletes a template | write | Always | `name` |

## Custom tools (`custom_tools.*`)

See [custom tools](custom-tools.md).

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `custom_tools.save` | Saves a custom tool, offered from the next message | write | Always | `name`, `description`, `base` (a tool, `http` or `script`) and the rest of its definition |
| `custom_tools.try` | Runs a draft once, unsaved | write | Always | As `custom_tools.save`, plus `sample`: the values to call it with |
| `custom_tools.read` | Shows a custom tool as `custom_tools.save` takes it; header values are not shown | read | Never | `name` (with dots) |
| `custom_tools.edit` | Changes a custom tool: only the parameters given change | write | Always | `name`; what changes. `params` names only the parameters that change, `null` removes one; `http` and `script` change only the keys given; `edits` change a script's code |
| `custom_tools.delete` | Deletes a custom tool | write | Always | `name` |

`custom_tools.edit` keeps the tool's headers, session and host. Tools from a source you added in **Settings →
Custom tools** are not changed or deleted this way: each sync replaces them.

## Page widget actions (`actions.*`)

See [the page widget](page-widget.md).

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `actions.save` | Saves an action of the page widget, tried with `sample` first (an action with steps is not tried) | write | Always | `name`; `where` (URL patterns); `input`; `tool` and `args`; `outputs`; `sample`; `prompt`; `steps`; `badge`; `when`: `click` or `load`; `agent` |
| `actions.read` | Reads an action whole, to change it | read | Never | `name` |
| `actions.delete` | Deletes an action | write | Always | `name` |

An action the model saves only runs tools that read; one that writes is made in **Settings → Actions**. An
action never runs tools that ask you something (`user.*`) or are confirmed every time (saves, deletes,
`custom_tools.try`, `browser.watch`, `history.read`), and it reads only its own tab.

## Agents (`agents.*`)

See [agents](agents.md).

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `agents.catalog` | What an agent can be given: the agents, the tool groups, the skills and the site templates | read | Never | `group`: that group's tools; `agent`: that agent's exact tools |
| `agents.save` | Creates or changes an agent | write | Always | `name`, `icon`, `description`, `instructions` or `edits`, `tools`, `skills`, `templates`, `sites`, `canAsk`, `canBeAsked` |
| `agents.delete` | Deletes an agent (not Builder) | write | Always | `name` |
| `agents.ask` | Asks another agent to do a task and returns its answer | read | Never | `agent`, `task` |
| `panel.start` | Starts another agent in a new row of the Agents Panel, on a new tab, with a task; returns at once | read | Always | `agent`, `task`, `url` |
| `panel.wait` | Waits for the agents it started (or only checks), and returns their states and answers | read | Never | `rows`, `wait_seconds` (300 by default, at most 1,800; 0 only checks) |
| `panel.send` | Gives one of the agents it started another message | read | Never | `row`, `message` |

`agents.ask` itself is not confirmed: the other agent's own tools ask as they always do. It is offered when the
agent **Can ask** and another one **Can be asked**, and at most three levels deep (you talk to the first). The
agent asked works on a background tab of its own, so its page tools (WebMCP) are those of that tab. No agent can
change Builder, nor give another agent the tools that create things: only you can, in **Settings → Agents**.

The `panel.*` tools are offered only in the chat of a row you started in the [Agents Panel](agent-manager.md#agents-that-start-agents),
when its agent **Can ask** and another **Can be asked**, and there in place of `agents.ask`; the agents it starts there
get none of them (they keep `agents.ask`).

## Speech (`speech.*`)

See [Speak](speak.md).

| Tool | What it does | Effect | Confirmation | Parameters |
|---|---|---|---|---|
| `speech.say` | Reads a text aloud to you with the agent's voice; returns once it starts | read | Never | `text` |

Offered only to an agent with **Speaks on its own** switched on (Browser too, in its editor), while Speak is on and has a
voice profile. It only makes sound and touches no site, so it is never confirmed nor held to the agent's sites.

## Tools that come from elsewhere

| Kind | Name the model sees | Effect | Confirmation |
|---|---|---|---|
| [MCP server](mcp.md) tool | `mcp.<server>.<tool>` → `mcp__<server>__<tool>` | write; read for a tool the server marks read-only, with **Trust its read-only hints** on | Site policy of the server (it has its own, like a site); Never for a read |
| [WebMCP](webmcp.md) tool of the page | `webmcp.<name>` → `webmcp__<name>` | write | Site policy of the page |
| [Custom](custom-tools.md) tool you have, preset | its name, dots as `__` | as its base | as its base |
| Custom HTTP request | its name | read for GET or **This request only reads**; else write | Never for a read; else site policy of the API's site |
| Custom script | its name | read when it only reads; else write | Never for a read; else site policy of its site |

A custom tool that sends a value you saved for it (`{{secret:name}}`) is confirmed every time.

The page's WebMCP tools follow the tab: when the model opens another page during a turn, the new page's tools are
listed from its next step. A page offers at most 25 tools (**Settings → [Limits](limits.md)**).
