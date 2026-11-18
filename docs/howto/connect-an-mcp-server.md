# Connect an MCP server with OAuth

Give the chat the tools of an online service you sign in to, such as a task tracker, through its MCP server.

**Example:** your team's task tracker on `tasks.example.com` offers an MCP server at `https://tasks.example.com/mcp`.
You want to ask the chat about your open tasks.

## What you need

- The server's web address (`https://…`). Servers that you start with a command on your computer cannot be used from
  a browser extension.
- An account on the service.

## What you do

1. **Settings → MCP servers → ＋ By URL**.
2. **Name**: `tasks` (lowercase letters, digits, `-` and `_`). **URL**: `https://tasks.example.com/mcp`. In **How it
   lets you in**, keep **Sign in, if it asks**: the sign-in takes the place of a key.
3. **Save**, then click the server's line to open its panel, and **Test connection**. It shows **Sign in** (or
   **Allow and sign in**, when the extension needs access to the sign-in site first).
4. Click it. The service's sign-in page opens in a window: sign in and accept. The panel then says **Signed in**.
5. Its line shows how many tools it has, and the panel lists them.

## What you type

> List my open tasks in the Website project, and which are due this week.

## What you approve

Every use of the server asks first in a card, like an action on a site. **Allow on mcp:tasks ▾ → In this
conversation** or **Always (site policy)** lets it run without asking. **Trust its read-only hints**, in the server's
editor, lets the tools that the server itself says only read run without asking.

## If it goes wrong

- **The MCP button shows a warning and "No tools from tasks"**: the server was not reached, and your messages go on
  without it. Open it in Settings and click **Test connection**; its
  **Connection logs**, in the same panel, show each attempt.
- ***…needs you to sign in***: the sign-in expired. Click **Sign in** on its line again.
- ***Not signed in*** after the sign-in window: the service wants a client of its own. Under **Sign in, if it asks** in
  the server's editor, fill in the **Client ID** it gave you (and **Client secret** and **Scope** if it says so).
- ***Request timed out*** on a tool that is slow by nature: raise **Tool timeout** in the server's editor. If
  the server then says the task is already running, the first call is still going: wait for it to end.
- **Answers get slow with a big server**: switch on **Its tools on demand** in its editor.
- **To disconnect**: **Sign out** in its panel.

More details: [MCP servers](../guide/mcp.md) · [Acting on pages](../guide/acting-on-pages.md) ·
[Troubleshooting](../guide/troubleshooting.md#an-mcp-server-is-not-reached-or-waits-for-sign-in).
