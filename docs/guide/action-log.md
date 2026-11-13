# The action log

**Settings → Logs** records each tool call of the chat, sub-agents and the page widget: when, where from, the agent,
the tool, the site, the decision and how long it took. It never records arguments, keys, page contents or results:
only what the confirmation card would show.

Four figures say how it is **Kept**, how many **Calls** it has (and how many were asked in a card), how many were
**Stopped** (denied or refused) and how many **Failed**.

**Keep the action log**: **This session** (the default), **In this browser** (the last 1,000 calls) or **Off**.

The list shows up to 200 calls that match its filters (the export has them all):

- a text box that finds a tool, agent or site;
- **From**: anywhere, the **Chat**, a **Sub-agent** or the **Page widget**;
- chips: **All**, **Asked in a card**, **Denied or refused** or **Failed**.

Each call's decision is one of *Without asking*, *Allowed*, *Always on the site*, *For this conversation*, *Denied* or
*Refused*. Use it to check what an agent did while you were away, or why an action failed.

**Export** saves every call, and each [MCP server](mcp.md)'s connection logs, as one
JSON file. **Clear** empties the log.
