# Chat views, Layers and the context meter

## Show the chat as

The **Show the chat as** menu shows the conversation as **Markdown** (the default), **Plain text**, **Jira
markup** (copying an answer copies it in Jira's markup), **Diagrams** or **Layers**.

## Layers

**Layers** shows what really happened on each call to the model. Each message line ends with the call's usage (*↑
tokens* sent, *↓ tokens · seconds* received) and a chip that opens its layers:

- **Received**: what came back, piece by piece: reasoning, text, tool calls.
- **Sent**: the whole request: the system message, every message tagged *New* or *resent* with its token count, and a
  summary of the tool definitions sent (with a table by group and **Copy the tool definitions (JSON)**). A request
  sent after a [compaction](compaction.md) says so.

**Highlight where the text comes from** colors each part by its origin, with a legend:

| From the web | From the extension |
|---|---|
| Page block · Site templates · Site skill values · MCP results · Saved conversations · Page tool results | Your message · Memory · Skills · Other extension values |

Everything in the left column is untrusted: it comes from pages and servers. The colors can be changed in
**Settings → Appearance**, which also chooses whether every message's layers, and the highlights, start shown.

Layers is the place to see why the model did what it did, how big each request is, and whether a skill, template or
memory item went where you expected.

## The context meter

The ring next to the message box shows how much of the model's context window the last call used (a token count
when the window is unknown); it turns to a warning at 80%. A ✂ mark means something was cut to a limit this turn.

Click it for the details:

- the model, the tokens used and its **context window**, with where that number came from (published by the server,
  learned when the server refused a longer request, set for the provider, or set by you). **Set it** (when unknown)
  or **Change** asks for the window of this model in tokens: **Save** keeps it, **As found** forgets the one you set
  and goes back to where it came from. Set it when the server publishes none, so the meter and
  [compaction](compaction.md#settings--compaction) count right.
- how much the last request grew since the call before, and a small chart of the input of every call of the
  conversation, with the compactions marked (dashed) and the window when it is in sight; under it, how many calls and
  the first request;
- whether the count was reported by the server or estimated, and how much of it the server's prompt cache served,
  when it says;
- the last request split in two, with what each part changed since the call before:
  - **Sent again with every call**: the tool definitions and the system prompt. The tool definitions unfold into
    their groups (as the tools menu groups them: Browser, Memory, an MCP server, a page's WebMCP tools…), and each
    group into its heaviest tools, each one a link to it in **Settings → [Tools](tools.md)**;
  - **Grows with the conversation**: page blocks, tool results, your messages and the model's answers, site skills,
    and how much of it is images; **Settings → [Limits](limits.md)** shortens page blocks and tool results.

  The split is estimated (about 4 characters a token). A conversation opened again shows it after its next call;
- **Compact now**, which [compacts](compaction.md) the conversation at once, with how much trimming the earlier turns
  would take out (a summary takes out more), and a link to **Settings → Compaction**;
- **By origin**, folded: the last request in the Layers colors, and the last response;
- what was cut this turn (**Settings → [Limits](limits.md)**);
- the session's totals: model calls, input tokens (and how many came from the prompt cache), output tokens (and how
  many were reasoning).
