# Tools and tools on demand

**Settings → Tools** lists every tool the model can be offered, grouped: the browser tools, the tools that ask you,
web search, memory, history, bookmarks, skills, and those that create things, plus your custom tools, MCP servers
and the tools of the page you are on. What each tool does: the [tool reference](tool-reference.md).

Four figures say how many tools are **Offered** (and how many are hidden from the menu), about how many tokens their
definitions take **In every request**, whether the tools that create things come **On demand** (and what that
saves), and how many tools have **Texts changed**. Then five tabs:

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

**On demand**, **Mentions** and **Shared texts** hold what the sections below describe; **Shared texts** has the
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

## Tools on demand

To keep requests small, some groups of tools are offered only when the model asks for them with `tools.load`:

- the tools that create things: **Settings → Tools → On demand**, on by default. The
  tab says about how many tokens this saves in every request.
- each MCP server with **Its tools on demand**.

Once loaded, a group stays offered until the conversation ends.

The **tools that create things** are `skills.save`, `skills.delete`, `templates.save`, `templates.delete`,
`custom_tools.save`, `custom_tools.try`, `custom_tools.edit`, `custom_tools.delete`, `actions.save`,
`actions.delete`, `agents.save` and `agents.delete`. They load on demand for Browser (also when another agent asks
it). While [Builder](agents.md) is on, they are Builder's: Browser is not offered them at all.

With them come the skills that guide them (`create-agent`, `create-custom-tool`, `create-page-action`,
`create-script-tool`, `create-skill`, `create-template`, `manage-creations`): while they are on demand, Browser's
system prompt does not list those skills; `tools.load` names them with the group and again once it is loaded. Until
then `templates.run` runs saved templates only, without the draft views that creating or fixing one needs.
