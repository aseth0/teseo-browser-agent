# Teseo documentation

New here? Start with [Getting started](guide/getting-started.md).

## How-to guides

Short guides built around one example each: [all of them](howto/README.md).

- **Everyday tasks:** [fill in a form](howto/fill-a-form.md),
  [compare products across tabs](howto/compare-across-tabs.md), [research with web search](howto/research-the-web.md),
  [extract data into a table](howto/extract-a-table.md), [watch a page and continue](howto/watch-a-page.md),
  [ask about part of a page](howto/ask-about-part-of-a-page.md), [chat about a PDF](howto/chat-about-a-pdf.md),
  [a one-click widget button](howto/widget-button.md).
- **For advanced users:** [a custom tool from a recording](howto/tool-from-a-recording.md),
  [connect an MCP server with OAuth](howto/connect-an-mcp-server.md),
  [run several agents at once](howto/run-several-agents.md).
- [Troubleshooting](guide/troubleshooting.md): what you see, why, and what to do.

## The chat

- [Using the chat](guide/chat.md): what goes with each message, models and thinking, messages and the queue.
- [Where the chat opens](guide/chat-windows.md): side panel, floating on the page, full screen, following you across
  tabs.
- [Mentions](guide/mentions.md): `::site`, `/skill`, `$tool`, `#conversation`, `b::bookmark`.
- [Attachments](guide/attachments.md): images, screenshots, text files, PDFs.
- [Chat views, Layers and the context meter](guide/layers.md): see every request the model got.
- [Appearance](guide/appearance.md): text size, themes, how steps and reasoning show.
- [Voice dictation](guide/voice.md).
- [A tab's audio](guide/tab-audio.md): save it, read its transcript next to it, or put it in the chat.
- [Speak](guide/speak.md): answers and your selection read aloud, with voice profiles.

## Models

- [Providers and models](guide/providers.md): presets, headers and body, thinking and reasoning, troubleshooting.
- [Your prompt and About you](guide/prompt.md): the system prompt, every fixed text, the prompt preview.

## Acting on pages

- [Acting on pages](guide/acting-on-pages.md): the browser tools, site access, site policies, confirmations.
- [When the model asks you](guide/user-tools.md): questions, picking an element, plans.
- [Tab watches](guide/tab-watches.md): wait for something on a tab, then go on.
- [The DevTools engine](guide/devtools-engine.md): real input, hover, drag, screenshots of any tab.
- [Recording a page's requests](guide/recordings.md): learn a site's API by using it.
- [The action log](guide/action-log.md).

## Making it yours

- [Agents](guide/agents.md) and [the agent manager](guide/agent-manager.md).
- [Skills](guide/skills.md): reusable instructions in the Agent Skills format.
- [Site templates](guide/site-templates.md): data extracted from websites with Liquid.
- [Custom tools](guide/custom-tools.md): shortcuts, HTTP requests, scripts, shared sources.
- [Tools and tools on demand](guide/tools.md).
- [MCP servers](guide/mcp.md) and [WebMCP](guide/webmcp.md).
- [The page widget](guide/page-widget.md): buttons on the page, with or without the model.

## Memory and context

- [Memory](guide/memory.md): notes kept across conversations.
- [Saved conversations](guide/history.md), including temporary ones.
- [Compaction](guide/compaction.md): long conversations within the context window.
- [Limits](guide/limits.md).

## The web

- [Web search](guide/web-search.md): searching and reading in background tabs.
- [Bookmarks](guide/bookmarks.md).

## Privacy and security

- [Privacy and security](guide/privacy-and-security.md): where data goes, permissions, prompt injection, secrets.
- [Word blacklist](guide/word-blacklist.md): mask names before anything reaches the model.

## Reference

- [Settings reference](guide/settings.md) and [FAQ](guide/faq.md); [moving your setup to another browser](guide/settings.md#export-and-import).
- [Tool reference](guide/tool-reference.md): every tool the model can be offered, how it is confirmed, its parameters.

## For contributors

- [CONTRIBUTING.md](../CONTRIBUTING.md): building, testing, conventions, where to extend.
- [Architecture](ARCHITECTURE.md), [model context](context.md), [compaction internals](compaction.md),
  [use cases](use-cases/README.md).
