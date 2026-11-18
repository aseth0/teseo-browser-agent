# Troubleshooting

Each section starts from what you see, then gives the likely causes and what to do.

## The model cannot read the page

| Cause | Fix |
|---|---|
| The extension has no access to the site yet: the page bar shows **Allow**, or the chat asks **Allow reading *site***. | Allow it there, or in **Settings → Website access** (one site, or **Allow access to all websites**). |
| The page is one no extension can read: browser pages (`chrome://`, `vivaldi://`, `about:`), extension pages, the Chrome Web Store, `file:` pages. The page bar says *not accessible*. | Open the content on a normal web page, or copy the part you need into the message. |
| The [agent](agents.md) has **Only its sites**, and this is not one of them. | Give the agent the site in the page bar's selector or in **Settings → Agents**, or switch to Browser. |
| The **Page** button in the [page bar](chat.md#the-page-bar) is off, or the ✨ menu leaves things out. | Turn it back on. |
| The model reads another tab than you think. | Check the site in the page bar; the [tab picker](chat.md#the-tab-picker) there moves the chat to another tab. |

## Screenshots are refused

| Message | Cause and fix |
|---|---|
| *Only the visible tab can be captured* | `browser.screenshot` captures the tab in front of its window. Bring it to the front, or turn on [the DevTools engine](devtools-engine.md), which captures any tab. |
| *Could not capture (…)* | The browser refused. Turn on **Allow access to all websites** in **Settings → Website access**, or open the panel with the extension's icon. |
| *This model may not take images* | The model cannot take images. Choose one that can (a "vision" model), or send the message without them. |
| The model gets a note instead of the image | The [word blacklist](word-blacklist.md)'s **Hide images from the model** is on. Turn it off, or have the list apply only with some providers or on some pages. |
| The popup's **Screenshot** buttons are greyed out | The tab is a browser page (settings, extensions, a new tab), which cannot be captured. Open the page you want first. |
| A screenshot from the popup or a shortcut does not show in the chat | The side panel could not open after a **Section** drag: click **Attach to chat** by the section. The image waits for the chat for 10 minutes, however you open it. A shortcut on a browser page captures nothing: the chat says why when you open it. |

## The agent is stuck, or repeats the same call

- **A call that fails, sent again unchanged.** The second failure of the same call (same tool, same arguments) in a
  turn tells the model so; a third is not run, and the model must answer or try another way. If it keeps failing, stop
  it and say what is wrong, or give it what it is missing.
- **The same text over and over.** A reply that keeps repeating itself is cut, with *Reply cut: it kept repeating …*.
  Send the message again, or try another model.
- **Stopped after 15 rounds.** A turn stops after 15 rounds of tool calls without an answer: *Stopped after 15 rounds
  of tool calls without an answer.* Click **Continue** to let it go on, or ask for a smaller step. An agent asked by
  another shows a card with **Continue** and **Stop**.
- **It waits for you.** A confirmation card or a question card holds the run until you answer it. In the
  [agent manager](agent-manager.md), the row shows **Waiting for you**.
- **Clicks that do nothing.** The tool call says *clicked, but nothing changed* when the page showed no change after
  it, and *clicked, but … is on top of it* when something else covers the element (a dialog or a banner to close
  first). Some pages ignore synthetic events: turn on [the DevTools engine](devtools-engine.md) for real input.
- **Typing that does not arrive.** On the DevTools engine, real input goes where the browser's focus is. If the page
  does not have it, because you just wrote in the side panel, the agent first presses on the text field. Text or a key
  that still does not reach the page is an error, *The text did not reach the field* or *The key did not reach the
  page*, and no Enter follows the text. Click the field yourself, or ask the agent to, and it can try again.

## The model says it has no tool for it

| Cause | Fix |
|---|---|
| The tool is unticked in **Settings → Tools**. | Tick it, or type `$tool.name` to offer it for one message. |
| The chat runs an [agent](agents.md) that was not given the tool. | Tick it in the agent's **Tools** (tools added later are not given to it), or switch to Browser. |
| The tool is offered [on demand](tools.md#tools-on-demand): the tools that create things, or an MCP server with **Its tools on demand**. The model has to load them with `tools.load` first, and small models may not. | Ask it to load them (*"load the tools that create things"*), or turn the on-demand option off. |
| **Builder** is on: the tools that create things are its alone. | See below. |
| The model cannot call tools at all: *… does not support tools: this turn goes on without them*. | Choose a model that supports tool calling. |
| The MCP server was not reached: the MCP button under the message box marks it. | See [MCP servers](#an-mcp-server-is-not-reached-or-waits-for-sign-in). |

## Browser cannot create skills, tools or agents

While [Builder](agents.md#built-in-agents) is switched on, the tools that create skills, site templates, custom tools,
actions and agents are Builder's alone: Browser is not offered them, and no agent can hand them out. Choose
**Builder** in the agent picker next to the model picker and ask again, or switch Builder off in **Settings → Agents**.

## Images are hidden from the model

With **Hide images from the model** on in **Settings → Word blacklist**, screenshots and attached images are replaced
by a note while the blacklist applies. Turn the option off, or limit when the list applies (some providers and models,
or some pages). In one chat, its chip in the [page bar](chat.md#the-page-bar) turns it off.

## A local model refuses the connection

| What you see | Cause and fix |
|---|---|
| *Could not connect to http://localhost:…* | The server is not running, or listens on another port. Start it, and check the **Base URL**. |
| *403* from Ollama (the test suggests checking the API key) | Ollama refuses requests from the extension. Start it with `OLLAMA_ORIGINS='chrome-extension://*' ollama serve`, or set `OLLAMA_ORIGINS` where its service runs and restart it. |
| The chat asks to allow `localhost`, or *No access to localhost* | Local servers are allowed at runtime, not up front. Click **Test connection** in **Settings → Providers** and allow it. |

See [Local models](providers.md#local-models).

## The provider answers with an error

Start with **Test connection** in **Settings → Providers**: it lists the server's models (*OK · N models*) or says
what failed, with what to check. The messages are explained in
[Providers → Troubleshooting](providers.md#troubleshooting). Beyond them:

| What you see | Cause and fix |
|---|---|
| *401* or *403* although the key is right | The gateway expects the key in another header: put `{{apiKey}}` there in **Extra headers**, such as `{"api-key": "{{apiKey}}"}`. |
| The key is asked for again | You changed the **Base URL**: a key is bound to the URL it was saved for. Type it again. |
| *400* about a field the server does not take | Remove or fix it in **Extra request body**. A *400* about reasoning or thinking is retried without it on its own; set **Thinking parameter** to **None** to stop sending it. |

## The context is full

The context meter shows how much of the model's window the conversation takes.

- [Compaction](compaction.md) shortens what is sent once the context reaches 80% of the window: earlier turns are
  trimmed, then summarized. **Compact now** in the meter runs it by hand; **Settings → Compaction** sets when.
- If the server still says the request is too long, it is sent again shortened more:
  *The server said the request was too long: sent again, shortened more.*
- A wrong window size makes the meter and compaction wrong: set the provider's **Context window, tokens**, or one
  model's in the context meter.
- Start a new conversation for a new task; mention the old one with `#` if you need it.

## An MCP server is not reached, or waits for sign-in

| What you see | Cause and fix |
|---|---|
| The MCP button shows a warning and *No tools from …*; or, when the model calls one of its tools, *MCP server "…" could not be reached, its tools are not offered: …* | The URL, the network, or the server is down. Open the server in **Settings → MCP servers** and click **Test connection**; its **Connection logs**, under it, show each attempt. |
| *The MCP server "…" needs you to sign in* | The sign-in is missing or expired. Click **Sign in** on its row (or **Allow and sign in**, when the extension needs access to the sign-in site first). |
| *Not signed in: …* after the sign-in window | The service refused. For a server that does not register clients itself, fill in **Client ID** (and **Client secret**, **Scope**) under **Sign-in (OAuth)**. |
| *Request timed out* on a tool that is slow by nature | The call went past the server's limit (60 seconds unless you set another). Raise **Tool timeout (seconds)** in its editor. If the server then says the task is already running, wait for the first call to end. |
| A server started with a command (stdio) | Not supported: a browser extension cannot start processes. Use the server's HTTP endpoint. |

See [Connect an MCP server with OAuth](../howto/connect-an-mcp-server.md).

## The extension cannot be installed

| What you see | Cause and fix |
|---|---|
| **Developer mode** or **Load unpacked** is greyed out, or says it is managed by your organization | A policy of your organization turns it off; `chrome://policy` lists the policies that apply. Only an administrator can change them. |

## Settings are gone after an update

Removing the extension deletes its data. Update by replacing the folder's contents and clicking ↻ on its card; see
[Getting started](getting-started.md#1-install-the-extension).
