# Tools and tools on demand

**Settings → Tools** lists every tool the model can be offered, grouped: the browser tools, the tools that ask you,
web search, memory, history, bookmarks, skills, and those that create things, plus your custom tools, MCP servers
and the tools of the page you are on. What each tool does: the [tool reference](tool-reference.md).

Four figures say how many tools are **Offered** (and how many are hidden from the menu), about how many tokens their
definitions take **In every request**, whether the tools that create things come **On demand** (and what that
saves), and how many tools have **Texts changed**. Then six tabs:

**Tools**: the groups on the left, each with how many of its tools are offered; a group's tools on the right, one
line each.

- **A tool switched off is not offered** to the model. The switch over the list switches every tool listed at once.
- Each tool is tagged **read**, **write** or **interact**; **modified** marks a tool whose texts you changed.
- The 👁 eye shows or hides a tool, or a whole group, in the chat's tools menu (the wrench under the message box),
  without changing whether it is offered.
- The filter finds tools by name or description in every group, and the chips show only the **Read**, **Write**,
  **Interact**, **Off**, **Hidden from menu** or **Modified** ones.
- Clicking a tool opens it in a panel on the right: its two switches, its **description** and its **replies** to the
  model, each editable and restored to the default, and its parameters (shown, not editable). Escape or ✕ closes it.

**Matching**, **On demand**, **Mentions** and **Shared texts** hold what the sections below describe; **Shared texts** has the
replies every page action uses, and the texts that wrap the tools websites offer (WebMCP). **Limits and shortcuts**
has the capture shortcuts and the tools' main [limits](limits.md), as cards.

## The tools menus

The wrench under the message box shows how many tools are offered and lists them by group: tick or untick a tool,
or a whole group, to switch it on or off: the same setting as in **Settings → Tools**, or, while you talk to
another [agent](agents.md), that agent's tools. Tools waiting to be loaded are tagged **on demand**.

MCP servers' tools have a button of their own next to it. When a server you switched on offers no tools, the
button shows a warning, and the list says it was not reached or is waiting for you to sign in; its logs are in
**Settings → MCP servers**.

## Mentioning a tool

`$tool.name` in a message offers that tool for that message, even when it is off (see [mentions](mentions.md)).
With **Force the mentioned tool** (**Settings → Tools → Mentions**), the model's first call must be the mentioned tool
(any of them, when several). Some servers or models do not accept this; the tool is then only asked for.

## Matching: which tools reach the model

**Settings → Tools → Matching** chooses, with the same matching as memory's auto-attach, which groups of tools go
with each message:

- **All tools** (the default): every tool switched on, with every message. Nothing is matched.
- **Recommended**: every tool is still offered, and the groups your message matches are named with it, for the
  model to prefer their tools (*Tools recommended* in [Layers](layers.md)).
- **Only matching**: only the groups your message matches are offered. The others are listed in `tools.load`'s
  description (as the [tools on demand](#tools-on-demand) are), and the model loads one when the task needs it. When
  your message points at no tool (*hello*), nothing is held. A group that matched, that the model loaded or used
  (one of its tools was called), or one of whose tools you mentioned stays offered for the rest of the conversation:
  a short follow-up (*"and at 11, then"*) keeps it. One offered only because nothing stood out does not stay.

What is matched, by group: **Web**, **History**, **Bookmarks**, each section of your [custom tools](custom-tools.md)
(those without a section together), and each [MCP server](mcp.md) set to *Same as Tools → Matching*, its default.
Each server can instead have a choice of its own in Settings → MCP servers (its panel's **Offered**, or its
editor): *Always offered*, *Recommended when it matches* or *Only when it matches*, whatever is set here, or *On
demand* (its own line in `tools.load`).

A server's **What it is for** (its panel in [Settings → MCP servers](mcp.md), optional) is matched along with its tools,
by words and by meaning: in your language, it lets a message such as *"guarda esto en mis apuntes"* find a notes
server without an embeddings model. It is never sent to the model.

Each tool is compared by its group's name, its own name and its description (yours, when you changed one), and a
group goes by its best tool: a large group gains nothing from its size, and the recommendation names the tools your
message matches first. The rest is always offered, as the system prompt or the agent relies on it: the browser's
tools, those that ask you, memory, skills, site templates, speech, the agents' (`agents.ask`, `panel.*`), the page's
own (WebMCP), `tools.load`, `tools.read_more`, the tools that manage custom tools and page actions, and a tool your
message mentions (`$tool`).

Your message is matched against **every tool offered** (the browser's too), so that a group is held only when your
message points at another tool, never just because it is the only one being matched.

- **By words** (always; the only way without an embeddings model): each tool by its own name split into words
  (`find_projects` → *find projects*) and its description; the server's name counts for the group, not for
  ordering its tools. **Match needed** (40%, *Broad*, by default) is how much of your message the best tool must
  cover, the rare words weighing more and your words that no tool has counting half against it; then the groups
  near that best one pass (within half of it for *Only matching*, 85% of it to be recommended). Greetings and words
  such as *there*, *please* or *tengo* are left out first.
  - **Without an embeddings model, expect it to work in the language of the tools' descriptions** (often English):
    *"what tasks do I have today?"* finds the tasks server. A message in another language shares no word with them
    (*"¿qué tareas tengo hoy?"*), so nothing stands out: *Only matching* then **offers** the groups rather than hold
    them, and nothing is recommended. Measured on a generic catalog with English descriptions: of 8 English
    messages, 7 offered the right server (the other offered all); of 9 Spanish ones, all offered everything; the
    right server was never held.
  - The 🔧 pill and **Try a message** say *by words only*, and when nothing stood out.
- **By meaning**: with [Memory → Semantic search](memory.md) on, a group also passes by meaning, by its closest
  tool, with the same embeddings model: this works across languages (*"créame una tarea"* finds a tool that *adds
  tasks*). It is judged against all the tools for that message, not by a fixed percentage, as each model has a
  scale of its own and its scores bunch together: the closest tool must **stand out** from the others, then the
  groups whose closest tool is near it pass. How near, for *Only matching*: **Offer more** (the default: it rarely
  holds the one you need), **Balanced** or **Hold more** (fewer offered, more tokens saved; more often the model
  loads the one it needs with `tools.load`, which it did 12 of 12 times when tried). Fewer pass to be *Recommended*.
  Measured on a generic catalog: the right group held 0, 1 and 2 times of 9, other groups let in 8, 5 and 3. When nothing stands out (*hello*,
  a question about something else), *Only matching* offers its groups rather than hold them, and nothing is
  recommended. Groups held stay listed in `tools.load`, which the model loads when the task needs them.
  - Each tool is **indexed** once: its own name and its description (not its server's name) go to the provider, in
    batches, and again only when they change. The card says how many are indexed (*45 of 86 tools indexed*, a
    bar, *indexing…*), any error, and has **Index now**. Opening the tab, or a message, starts it when tools are
    missing; a message never waits for it: a tool not indexed yet matches by words only.
  - Each message sends only itself, once for memory and the tools. Without an answer in 2 seconds, it goes by
    words, and the chat says so. Leaving meaning out of a conversation (✨ menu) leaves it out for the tools too.
- **Try a message** shows how well each group matches a message, by words and, once you stop typing, by meaning
  (two meters, the meaning one marked where Only matching needed it for that message, and a line with what a group
  needed, or that nothing stood out), its matching tools first in bold, and each group's mode (a server's own
  choice too).

It applies to the agent you talk to, not to the agents it asks.

**What it did, in the chat**: a 🔧 pill under your message, when something was matched: *Recommended: tasks*, or
*2 offered · 3 held* (or both). Click it for each group: its mode, what happened to it (recommended, offered and why,
held in `tools.load`, not recommended), its match by words and by meaning, and its matching tools, best first. None
when every group is *Recommended when it matches* and none matched. In [Layers](layers.md), the turn's phases show it
as *Matching the tools*, under *Preparing your message*.

A group's tools are ordered by how close each is to your message (by meaning when it is on, else by their own words,
not the server's name that they all share): what the recommendation names first, and what the pill shows.

## Tools on demand

To keep requests small, some groups of tools are offered only when the model asks for them with `tools.load`:

- the tools that create things: **Settings → Tools → On demand**, on by default. The
  tab says about how many tokens this saves in every request.
- each MCP server set **On demand** (Settings → MCP servers).

Once loaded, a group stays offered until the conversation ends.

The **tools that create things** are `skills.save`, `skills.delete`, `templates.save`, `templates.delete`,
`custom_tools.save`, `custom_tools.try`, `custom_tools.edit`, `custom_tools.delete`, `actions.save`,
`actions.delete`, `agents.save` and `agents.delete`. They load on demand for Browser (also when another agent asks
it). While [Builder](agents.md) is on, they are Builder's: Browser is not offered them at all.

With them come the skills that guide them (`create-agent`, `create-custom-tool`, `create-page-action`,
`create-script-tool`, `create-skill`, `create-template`, `manage-creations`): while they are on demand, Browser's
system prompt does not list those skills; `tools.load` names them with the group and again once it is loaded. Until
then `templates.run` runs saved templates only, without the draft views that creating or fixing one needs.
