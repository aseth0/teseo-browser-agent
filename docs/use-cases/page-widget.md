# Page widget (design notes)

> ✅ Shipped. How the page widget works today: [The page widget](../guide/page-widget.md). This page keeps how it
> was designed and built, phase by phase.

A small box injected into matching pages, movable and hideable, holding **actions** the user
configures. Each action produces its own card. It replaces two earlier candidates: *tool boxes*
(a box filled by a tool without the model) and *page actions* (a bubble of prompts); both are
actions of this widget. Cases: [Jira → Mattermost](jira-mattermost-incident.md),
[bubble of actions](page-actions-bubble.md).

Named *widget*, not *panel*, so it is never mixed up with the side panel. Vivaldi also calls the boxes
of its Dashboard "widgets": the UI says "Page widget" where it first appears. In code: `page-widget`.

## The widget

- One widget, shown only on pages where at least one action matches. Empty widgets everywhere are
  noise.
- A bubble, draggable, its position saved per site. The pointer on it (a short rest) unfolds the
  actions in a column, away from the nearest edge: round buttons with an icon the user picks (an
  emoji; the name's initial without one), the name on hover. A selection action runs at once; a text
  one asks in a small pop-up, pre-filled with the selection; the answer shows in a card beside them,
  closed by ✕ or Escape inside it (a click elsewhere on the page leaves it running), moved by its head. A click on the bubble opens the side panel
  (`chrome.sidePanel.open` from the content script's message); where the browser refuses, it keeps
  the actions open instead. Hidden per site (✕ under the actions) and globally, with a keyboard
  shortcut (`commands`) to bring it back. On a site where it is hidden nothing of the bubble runs,
  not even its actions on page load, until it is shown again: a page there reads the site's place
  and leaves (no listener, timer or request), hiding it on an open page tears it all down (loads in
  flight stopped with their port), the background refuses a run asked from that site, and calling it
  back (the shortcut, Settings → Bubble's Show, floating the chat on the page) has the background put
  the widget into the site's open tabs, where it starts as on a fresh page. A chat floating on the
  page when it is hidden stays, unfolded, until it is closed. Saving actions also puts it into the open tabs they reach.
  A bar (horizontal or vertical by the edge it is dropped on) may come later as another form.
- Injected by a content script registered on the sites with access
  (`chrome.scripting.registerContentScripts`), in a closed shadow root. The barrier is the design,
  not the shadow root: the page can neither launch actions (clicks checked with `isTrusted`) nor read
  results (data travels in messages to the background, never through the page's DOM).
- An agent of its own in `AGENTS` (`src/agents/registry.ts`) once it can write (phase 2): its own
  column in Settings → Website access, so what the widget may do on a site is decided apart from the
  chat. Reading needs no policy.
- SPAs (Jira, Mattermost, GitHub) change URL without reloading: watch navigation to re-run "on page load"
  actions when the ticket or channel changes.
- Cards: repeating an action replaces its card; cards stay until closed or the page changes.

## An action

```
Action
  name, label
  where:   URL patterns (empty = every site with access granted, never <all_urls>)
  when:    on click | on page load   (page load: no model, read-only tools only)
  input:   none | selection | text   (text is pre-filled with the selection, editable)
  reads:   { key: "{{selector:…}}" } values from the page, as in site templates
  run:
    tool:   { name, args: { term: "{input}", key: "{reads.key}" } }   an existing tool, by name
    prompt: "Translate to Spanish: {input}"   with the model, optional; a model per action
    (both: the tool runs first, its result goes into the prompt)
  outputs:
    - { label, from: "[]", text: "{display_name}", link: "…/{name}" }   a path on the tool's answer;
                                each element of a list a line, its keys in the text and the link
    - { label, from: "answer.translation" }   a key of the JSON the model is asked for
    - { label, from: "answer" }               free text, streamed; only when it is the sole output
  open_chat: true/false   instead of outputs: the side panel, with the prompt
```

- Actions live in their own Settings section, **Actions** (the widget is only the box that shows
  them). They **reference** tools by name instead of defining requests: the tool keeps its headers,
  browser session, confirmation and site policy. A prompt-only action has no tool.
- Several outputs with the model mean a structured answer: JSON with the outputs' names as keys,
  split into the boxes. One output is free text, streamed, with the reasoning folded but visible.
- Tool + prompt is the only chain allowed at first ("find similar incidents, then summarize them").
  Longer chains are a flow, another product.
- `reads`, `args` and `from` reuse the engines that exist: selectors from site templates, paths from
  the HTTP custom tools' `extract`. No third mini-language.

## Rules

- **Writes confirm inside the card**, like the chat's confirmation card; never a browser `confirm()`
  the page could imitate.
- **Cost.** With the model only on click; a model per action (a cheap one to translate). "On page
  load" actions without the model still cost requests to the API: a short cache per page key and a
  small delay, so walking through fifty tickets is not fifty searches.
- **Trust.** The card's input is the user's text. What comes from a tool or from the page is
  untrusted, marked as in web search: a channel message saying "ignore the above" gets no more power
  in a summary than it has in the chat.
- **Open chat** depends on `chrome.sidePanel.open` accepting a click in the page as a gesture. If it
  does not: the card says "Open the side panel" and leaves the prompt ready. No second chat inside
  the card.

## Before phase 1

- **`chrome.sidePanel.open` from a click in the page.** Phase 4 depends on it, but the answer changes
  how the card is designed, so it is checked now: a snippet in the service-worker console adds a
  button to the page and tries to open the side panel when it is clicked (and once without a click,
  which must fail).
- **A GET that finds Mattermost channels by name**, for the real case. `GET /users/me/channels`
  returns every channel of the user, and `extractPath` does not filter by `INC-12345`; the searches
  (`channels/search`) are POST, which phase 1 does not allow. Likely candidate, from the public API
  docs and unverified: `GET /api/v4/teams/{team}/channels/autocomplete?name=…`. If none exists: a
  filter on the outputs (`contains {input}`), or the "This request only reads" box moves up to
  phase 1.

## Phases

1. **The widget, with tool actions, without the model.** ✅ Built. Settings → Actions (create, edit, switch
   on/off, Try). The content script registered on the sites with access, registered again when the
   actions or the permissions change. The widget: drag, fold, hide (✕ per site, a keyboard shortcut,
   Settings → Actions), its position per site; it follows an SPA's URL. The input (text, pre-filled with the selection). A click asks the
   background, which runs the tool directly; outputs cut with the existing `extractPath`, links from a
   template. **Read-only tools only**: the page can never set off a write. Built without React (plain
   DOM): it is injected into every matching page. e2e with a page of the mock server.
   *Example:* on any site, "Search Wikipedia" with a text field; `platypus` → a card with the
   articles found, each a link.

   **1b. The model makes actions.** ✅ Built. Writing the paths and templates by hand is the hard part, and a
   model does it well because it sees the real answer first. From the chat, on the page: "a button
   here that searches the selection in Mattermost and lists the channels". The model creates the
   tool if missing (`create-custom-tool`), tries it with a sample value to see the answer's shape,
   and proposes the action with a new `actions.save`: `where` from the page's URL, the tool with
   `{input}`, boxes picked from the real answer. Always confirmed: the card shows the whole action
   and the result of trying it with the sample; the user approves, and it is saved switched on.
   From then on the button runs without the model. Needs `actions.save` (always asks) and a
   built-in skill `create-page-action`; their texts go to `TEXT_DEFS` and the skill, shown to the
   user before writing them. A page that sways the model shows in the card (a link to another
   domain), and actions only read. The trial runs before the user is asked: when no box finds
   anything, the start of the answer goes back to the model (untrusted) to fix the paths. A tool
   saved just now is not offered to the model until the next message, but `actions.save` finds it;
   and a site the tool may not reach yet is asked for from the chat, like a tool's.
2. **Actions with the model.** Split: **2a** ✅ built (below, read-only), **2b** ✅ built: write tools
   confirmed in the card (summary and details as the chat's card; Allow, Deny: no "Always on the
   site" in a card on a page, whose renderer could answer for the user; only trusted clicks; closing
   the card denies) by the site policies of the widget's column in
   Website access ("Page widget"), or of the action's agent; read only refuses, and so does a run
   with no card to ask in. Not the tools that ask the user nor those always confirmed (`*.save`);
   `actions.save` keeps to tools that read (it tries the action before the user is asked). Try in
   Settings asks too, **2c** ✅ built: import/export (Settings → Actions, JSON like custom tools: imported off,
   replacing the one of the same name, the agent by its name and left out when it is not there, the
   model only with a provider of that id), **2d** ✅ built: `actions.save`
   makes actions with a prompt (only its tool is tried before the user is asked; the prompt is
   shown on the card, not tried) and for an agent (by name, its tool one of the agent's; an update keeps its agent unless the call names one, "Browser" (or "Default") moving it to Browser, and the card says "(was …)" when it changes); its model
   stays the user's choice. As built in 2a: an action may have a prompt (`{input}`),
   with or without a tool (the tool runs first; its answer goes after the prompt as
   `<untrusted_tool_result>`); one request, no tools for the model, over a port so the card shows the
   answer as it is written and the reasoning folded (closing the card stops it); its own model, else
   its agent's, else the chat's; with several boxes, each has a key and the model answers in JSON
   (`response_format: json_object`, sent again without it where the server rejects it), also taken
   from a fence. As its agent: the agent's instructions follow the widget's system prompt. Texts in
   `TEXT_DEFS`: `system.widget`, `widget.tool_result`, `widget.json_outputs`. The bubble also shows on every
   site the extension may read, without actions (Settings → Actions, on by default): there it only
   opens the chat; on every website when the user grants access to every site (asked from that
   setting). A prompt may set its thinking level (none: the chat's for that model). The card is
   resized from any edge or corner (its size kept per site), moved by its head (until it closes), and a model's answer has "Open in the chat": the request
   (the tool's answer attached as context) and the answer become a new conversation in the side
   panel, as the action's agent; where the click cannot open the panel, it waits there (part of
   phase 4). The design was:
   One-shot request streamed into the card, reasoning folded; tool +
   prompt; a model per action; several outputs from a JSON answer (`response_format` where the
   provider supports it, else the JSON asked for in the prompt and parsed; that fixed text goes to
   `TEXT_DEFS`, shown to the user first). Write tools, confirmed inside the card, with the widget's
   column in Website access. Import/export of actions (JSON, like custom tools).
3. **On page load.** ✅ Built. "When it runs": on a click, or on page load (a tool that reads; no
   prompt, nothing typed). Values from the page (`reads`, by name: `{{selector:css}}`,
   `{{selector:css?attr}}`, `{{meta:name}}`, `{{schema:@Type:path}}`, `{{url}}`), read by the widget itself
   (content/page-values, no Readability) and used by the tool's parameters as `{name}`, on click
   too. On load: one second after the page loads or its URL changes (SPAs), again at three for a
   page still drawing; one whose values are missing does not run. The bubble counts the actions
   that found something and marks their buttons; a click opens the card at once. The background
   keeps each answer ten minutes by the action and its values (storage.session). HTTP custom tools
   other than GET may be marked "This request only reads" (user only, like the session): a read,
   not confirmed, usable on page load. The design was: Read-only tools only; values read from the page (`reads`); a cache per page key
   and a small delay; SPA navigation; the "This request only reads" box for search POSTs (unless
   phase 1 already needed it).
4. **Open chat.** ✅ Built. "What it does": shows a card, or opens the chat with a message (its
   prompt, with what it takes and reads in it), sent at once in a new conversation as the action's
   agent, the page attached as for any message (the panel sends it once that agent is chosen and the
   page known). `chrome.sidePanel.open` inside the click; where the browser does not allow it, the
   card says so and the message waits there (storage.session, ten minutes), as "Open in the chat"
   does with an answer. No tool, no boxes, on a click only. Prompts of actions with the model now
   take the values read from the page too. The design was: `chrome.sidePanel.open` from the card,
   or "Open the side panel" with the prompt ready.
5. **Open chat here.** 5a ✅ Built: "💬 Open the chat here" in the bubble opens `sidepanel.html?floating`
   in the widget (its own closed shadow root), its page the tab it floats in as `tabs.getCurrent()`
   says (never its URL). Moved by its bar, resized from any edge, place and size kept per site;
   folded (–) or closed (✕). The background keeps, per tab, that it is open and its conversation
   (storage.session `floating:<tab>`): after a reload it opens again with it. Allow on the
   confirmation and access cards works only after the frame has been in full view for 0.5 s
   (`useSeen`: threshold 0 on the document, so any part covered counts; the widget's resize handles
   lie outside the frame, since even a see-through element over it counts). Checked in Chromium:
   the frame loads with `use_dynamic_url`, the static URL is refused to pages, the page sees no
   frame (`window.length` 0 inside the closed root), and opacity, `filter`, transforms and covers,
   whole or a corner, read as not seen. Known limit: the turn runs while the chat's port is open,
   so a reload or a link the agent follows in that tab stops it (the conversation reopens, the turn
   does not go on): lifted in 5b-2. 5b-1 ✅ Built: a conversation moves between the side panel ("Float on this page",
   where the page widget is; the panel then closes) and the floating chat ("Open in the side panel";
   where the browser does not let the click open it, the conversation waits there and the floating
   chat starts anew), between turns, as a handoff with its id and messages (`core/handoff`, its `tab`: the
   floating chat of that tab takes it, the panel only those without one). ⌥⇧F opens or folds the
   floating chat. With it open, actions that open the chat and "Open in the chat" go into it, no
   side panel opened. Settings → Appearance → Chat (`chatWindow`): where the widget opens the chat
   (the bubble, its actions that open the chat, "Open in the chat": the side panel, or floating on
   the page, then the bubble opens and folds it), and the floating chat's first place and size on a
   site (side, width, a height or the whole window), until moved there; a button starts it so on
   every site again. 5b-2 ✅ Built: a floating chat's turn survives its page reloading or the agent
   taking the tab elsewhere. The background keeps each chat's run in a session; when the floating
   chat's port closes mid-run, the run goes on away for up to 60 s (an API call every 20 s keeps the
   service worker up), its questions waiting. The chat, opening that conversation again in that tab,
   sends `attach` and gets `resume` (the history the run started from), then what the run sent
   since (only the questions still waiting), then the rest as it comes. Only the floating chat of
   the same tab takes a run over. Closing it (✕) or its tab stops its run; so does closing the side
   panel, as before. Where the page the agent went to has no widget, the run stops after the 60 s.
   The design was:
   The whole chat, every feature of the side panel, floating on the page instead
   of beside it: from the bubble (an item under the actions, and a keyboard shortcut), on any page
   the widget shows on.
   - **What it is.** The side panel's own page (`sidepanel.html?floating&tab=<id>`) in an iframe
     inside the widget's closed shadow root: the same React app, settings, conversations, agents,
     tools and confirmations, nothing rebuilt. Its page is the tab it floats in (not "the active
     tab" as for the side panel). Movable by its title bar, resized from any edge (as the card),
     its place and size kept per site; folded to the bubble, or closed (✕, Escape from its bar).
     Going on with a conversation of the side panel, or moving it there ("Open in the side panel"),
     goes through the history: a conversation is never live in two places at once.
   - **Risks, and what answers them.**
     - *The page sees the extension.* The chat's page and files must be
       `web_accessible_resources` for an iframe to load them: a page could tell the extension is
       installed. `use_dynamic_url` (a URL that changes each session) keeps them from being
       fingerprinted; only the widget asks for them.
     - *Clickjacking.* The page owns the iframe's host element: it could make it see-through, or
       cover it, and steer a click onto "Allow". The chat inside the iframe checks it is really seen
       (IntersectionObserver v2, `trackVisibility`): the confirmation and access cards' buttons work
       only while the frame has been fully visible a moment (~0.5 s), and say so otherwise. Their
       keyboard is the iframe's own.
     - *Reading it.* The page cannot read the iframe (another origin), nor its messages (they go
       through the extension's ports, never `postMessage`).
     - *Where not.* Pages the widget cannot reach (chrome://, the Web Store, sites without access)
       keep the side panel.
   - **Checked before building:** that Vivaldi and Chrome let an extension page load in an iframe
     on any site with `use_dynamic_url`, that `trackVisibility` reports the cases above (opacity,
     covered, transformed), and the panel's layout in a small resizable frame.

## Example actions

Built on public APIs, so every phase can be tried without a work account. The tools are ordinary
HTTP custom tools, tried first with **Try** in the editor.

| Tool | Request | Answer cut to |
|---|---|---|
| `wiki.search` | `GET https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={query}&srlimit=5&format=json` | `query.search[].{title,pageid}` |
| `wiki.summary` | `GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}` | `{title,extract}` |
| `wiki.whoami` | `GET https://en.wikipedia.org/w/api.php?action=query&meta=userinfo&format=json`, browser session ticked | `query.userinfo.{id,name,anon}` |
| `github.search_repos` | `GET https://api.github.com/search/repositories?q={query}&per_page=5` | `items[].{full_name,html_url,stargazers_count}` |
| `github.repo` | `GET https://api.github.com/repos/{owner}/{repo}` | `{full_name,stargazers_count,open_issues_count}` |
| `echo.post` | `POST https://httpbin.org/post` with `{"note": {note}}` (returns what it gets) | `json` |

What each action checks:

- **Phase 1, text input → a list of links** (the shape of "Channels of the INC"): "Search Wikipedia",
  on click, input text; `wiki.search` with `query: "{input}"`; output `[]` with text `{title}`, linked
  to `https://en.wikipedia.org/wiki/{title}`. Same with `github.search_repos` and `html_url`.
- **Phase 1, the selection as input, two outputs:** on `*.wikipedia.org`, select a word → "Summary",
  `wiki.summary` with `title: "{input}"`; outputs `title` and `extract`.
- **Phase 1, the browser session:** "Who am I", input none, `wiki.whoami`. Signed in to Wikipedia it
  shows your user; signed out, your IP and `anon`.
- **Phase 2, the model:** on `*.wikipedia.org`, input selection, prompt "Translate to Spanish:
  {input}"; outputs `translation` and `notes` (the JSON answer split into boxes). Tool + prompt:
  `wiki.summary`, then "Explain this to a child in three sentences"; one free-text output, streamed.
- **Phase 2, a write confirmed in the card:** "Send a note", input text, `echo.post`; the card asks
  before sending, and shows the note that came back.
- **Phase 3, on page load, values read from the page and SPA navigation:** on `github.com/*/*`,
  `reads: { owner, repo }` from the page (which selectors or meta tags hold them: to look at),
  `github.repo`; outputs stars and open issues. GitHub changes repository without reloading, so the
  card must follow; and it allows 60 requests an hour without signing in, so a cache that does not
  work shows at once.
- **Phase 4, open chat:** on `*.wikipedia.org`, "Ask about this article", `open_chat` with "Summarize
  this article".

The real case, Jira → Mattermost, is in [its own file](jira-mattermost-incident.md): "Channels of the
INC" (text input, a list of channels with links), on click first and on page load later.
