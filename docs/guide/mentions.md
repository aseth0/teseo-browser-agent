# Mentions

Type these in the message box to attach something to one message. An empty chat shows a "What you can mention"
table.

| Mention | Attaches |
|---|---|
| `::site/view` | What a [site template](site-templates.md) reads from that site: from the active tab, another open tab of the site, or the view's URL opened in a background tab |
| `/skill` | A [skill](skills.md), loaded for this message |
| `$tool` | Asks the model to use that tool, even if it is switched off |
| `@agent` | Asks the model to ask that agent (see [Agents asking agents](agents.md#agents-asking-agents)) |
| `#saved-conversation` | A saved conversation |
| `b::bookmark` | A bookmark's title, URL and folder (once bookmarks are allowed) |

Each kind can be switched off in **Settings → Auto-inject → Mentions**.

## Agents

`@` lists the agents the chat's agent may ask: it needs **Can ask**, and they need **Can be asked** (Settings →
Agents); with nobody to ask, `@` says which of the two is missing. An agent is mentioned by its name in lowercase, with dashes
(`@research-bot` for *Research Bot*; any case works). The model is told you named it, and the tool that asks agents is offered for
that message even if it is off. The chat keeps talking to the agent you chose: the one you mention does the task it
is given and answers back. **Force the mentioned tool** (Settings → Tools) applies to `$tool` only.

A mention starts a word, so an email address (`someone@example.com`) is plain text, as is `@` followed by a name that
is no agent you may ask. The text the model gets is in **Settings → Agents → Mentions**.
