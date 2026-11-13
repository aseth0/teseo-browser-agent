# Use cases

Workflows thought through before building anything: what the extension can already do, and what it
would need. Each case lists the **candidate features** it asks for; the table below gathers them, so
a new case can be checked against the others. A feature several cases ask for is a good next step.

Features marked ✅ have shipped: their pages stay as design notes, and the [documentation](../README.md)
describes them as they work today.

| Case | Works today with | Needs |
|---|---|---|
| [Jira incident → its Mattermost channel](jira-mattermost-incident.md) | HTTP custom tool + site skill | page widget (an action on page load), read-only POST, browser session on POST, chained calls, agents |
| [A bubble of actions per site](page-actions-bubble.md) | HTTP custom tools + site skills (the user writes the prompt) | page widget (actions on click) |

## Candidate features

| Feature | What it is | Asked for by |
|---|---|---|
| **[Page widget](page-widget.md)** | ✅ Shipped ([The page widget](../guide/page-widget.md)). A bubble injected into matching pages, with actions the user (or the model) configures (Settings → Actions): a tool by name and/or a prompt, an input (text or selection), values read from the page, outputs as cards; on click or on page load. Absorbs the earlier *tool boxes* and *page actions*. | Jira → Mattermost; bubble of actions |
| **[Agents](agents.md)** | ✅ Shipped ([Agents](../guide/agents.md)). Named profiles for the chat, each with only the tools, sites, skills and model the user gives it; agents that call other agents (sub-agents); a Builder agent, the only one that creates skills, tools, actions and agents. | Jira → Mattermost; page widget (actions with the model) |
| **Read-only POST** | ✅ Shipped: **This request only reads** on an HTTP custom tool ([Custom tools](../guide/custom-tools.md)). A custom HTTP tool whose POST only reads (search endpoints), so it runs without a confirmation. | Jira → Mattermost |
| **Browser cookies** | ✅ GET: an HTTP custom tool may send the browser's session for the API's site ("Send the browser's session for this site"), when there is no personal token. ✅ POST too: the CSRF header from one of the site's cookies (`X-CSRF-Token: {{cookie:MMCSRF}}`). | Jira → Mattermost |
| **Chained calls** | ✅ Shipped: an action's [steps](../guide/page-widget.md#steps), and [script tools](../guide/custom-tools.md#a-script) that call other tools. One tool or widget whose result feeds another call (e.g. a team id → its name, to build a link). | Jira → Mattermost |
| **Proactive triggers** | The agent acts when a page opens, without a message from the user. The page widget's "on page load" actions cover the read-only part (the model too, through steps); not asked for on its own. | — |

When adding a case: copy the template below into a new file, add its row to the first table, and
add it to "Asked for by" of each feature it needs (or a new feature row).

```markdown
# <Case title>

## The workflow
## What works today
## What it would need
## Open questions
```
