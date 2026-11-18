# MCP servers

Teseo connects to remote [Model Context Protocol](https://modelcontextprotocol.io) servers and offers
their tools to the model. Set them up in **Settings → MCP servers**.

**Settings → MCP servers** has the layout of the other sections: four figures (how many servers there are and are
on, how many are **Connected** and need you to sign in, how many **Tools** they offer, in every request or on demand,
and how many run without asking), then two tabs, **Servers** and **Texts**.

Each server is a line: its switch, name and address, its status (a green dot and how many tools, *Sign in needed*,
the error, or *Not tested yet*), how it lets you in (or **Sign in**), and its policy. Clicking it opens it in a panel
on the right: **Test connection**, **Edit** and **Remove**, signing in or out, on, its policy and when its tools are offered, its tools, and its
connection logs. Escape or ✕ closes it.

**＋ By URL** opens the editor, its steps on the left:

1. **Where**: its **Name** (lowercase letters, digits, `-` and `_`; the model sees its tools as `mcp__<name>__<tool>`)
   and **URL** (Streamable HTTP, with a fallback to SSE).
2. **How it lets you in**, one of three:
   - **Headers**: its key, as `Authorization` or the header it asks for (JSON);
   - **A provider's key**: the provider chosen, its key filling `{{apiKey}}` in the headers;
   - **Sign in, if it asks**: OAuth when the server wants it; an optional Client ID, Client secret and Scope for one
     that does not register the extension itself, and other headers if it needs them.
3. **How its tools are offered**: when they reach the model, one of five:
   - **Same as Tools → Matching** (the default; with the mode set, e.g. *Same as Tools → Matching (All tools)*): as
     [Settings → Tools → Matching](tools.md#matching-which-tools-reach-the-model) is set. With *All tools*, in every
     request, as before.
   - **Always offered**: in every request, whatever your message matches.
   - **Recommended when it matches**: in every request, and named with your message when it matches its tools.
   - **Only when it matches**: offered when your message matches its tools; else listed in `tools.load`.
   - **On demand**: the model loads them only when it needs them (`tools.load`).

   The last four are the server's own, whatever Settings → Tools → Matching says.

   Then **Trust its read-only hints** (off by default, below) and the **Tool timeout** (1 to 3600 seconds; empty: 60).
   A server's line says *on demand*, *recommended when it matches*, *only when it matches*, or, while Matching is not
   *All tools*, *always offered*.
   Its panel's **Offered** changes it at once, without the editor. Its panel also has **What it is for**
   (optional, empty by default): what you use it for, in your words and language (*tasks, reminders, projects*).
   [Tool matching](tools.md#matching-which-tools-reach-the-model) compares it with your message along with its
   tools, by words and by meaning; it is never sent to the model, and not exported.

On the right, **Test it** connects with what is set there, unsaved, and lists the tools; **As the model sees them**
gives their names and about how many tokens they take; **Checks** says what must be fixed before **Save**.

**＋ From a provider…** asks a provider that offers MCP servers (a LiteLLM gateway, at `/v1/mcp/server`) which ones it
has. Tick as many as you want (or **Select all not added yet**) and **Add** them: they are tested once added. The ones
you already have, at the same address, are ticked and marked **added**.

Local servers started with a command (stdio) are not supported: a browser extension cannot start processes.

**Sign-in.** A server that needs OAuth shows **Sign in** once tested. The sign-in follows the MCP authorization
specification (discovery, dynamic client registration, PKCE, refresh) in a browser window; tokens are kept with the
extension's secrets, never exported or logged. Once signed in, **Sign out** forgets the tokens and tests the server
again.

**Connection logs.** **Test connection**, in a server's panel, connects and lists its tools; its line shows the result.
Under them, its **Connection logs**: the server's tests, sign-ins, connections and tool calls in this browser session,
latest first, to **Export** as JSON or **Clear**. Look there when a server stops answering. **Settings → Logs** exports them
for every server, with the [action log](action-log.md).

**Slow tools.** A call that takes longer than the server's **Tool timeout** fails with *Request timed out*, and the
client asks the server to cancel it. A server that goes on anyway may refuse another call until the first one ends.
Give a server whose tools are slow a longer timeout; it applies to all the server's tools, and **Stop** still cuts a call.

**A server that does not answer.** The servers are connected when a conversation starts, before its first message,
and no message of the chat waits for one that has not connected yet: it goes without that server's tools, which are
offered once it is in. A server that fails, or takes more than 15 seconds to connect, is left out and tried again
when you start a new conversation. A message waits (up to those 15 seconds) only for a server that had already
connected since the browser started, when the extension has to connect to it again; actions and tools that run on
their own wait for every server. The chat does not say that a server was not reached: the MCP
button under the message box marks the servers it has no tools from, and **Layers** counts them in the turn's
*Listing the tools* step. Only when the model calls a tool of such a server does a notice say why it was not
reached. **Test connection** tries at once. A call that failed is
made again on a new connection only when it surely did nothing: the server forgot the session, or a tool that only
reads (with **Trust its read-only hints**) lost its connection. Never after the server's own error or a timeout.

**Confirmation.** Every MCP tool is treated as an action and asks before it runs, as a site's actions do (the
server has a policy of its own, like a site), unless you turn on **Trust its read-only hints**: then the tools the server marks
read-only run without asking. What a server returns reaches the model as untrusted content.

**Import and export** use the `mcpServers` JSON format of other MCP clients. Header values are left out unless you
choose to include them; imported servers arrive switched off, to be tested first.
