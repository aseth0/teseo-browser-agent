# Changelog

What changed in each version of Teseo. Versions before 0.61.0 are not listed here; see
the git tags and their commits.

## 0.79.0

### Added
- `@agent` mentions in the message box: `@` lists the agents the chat's agent may ask (name and description),
  filtered as you type; the one you pick is asked for that message (the model is told you named it, and the tool
  that asks agents is offered even if it is off). An email address is not a mention. Switch them off in
  Settings → Auto-inject → Mentions; the text the model gets is in Settings → Agents.

### Changed
- The toolbar popup: **Agents Panel** is now a button at the top, beside ⚙ Settings, instead of a row of its own
  at the bottom.

## 0.78.1

### Fixed
- The chat no longer scrolls as a whole: at times, in the side panel, all of it (its top bar included) went up
  out of sight and left an empty space under the message box, until the panel was reloaded. Only the list of
  messages scrolls.

## 0.78.0

### Changed
- The Chrome Web Store version now has the DevTools engine (real clicks, keys and typing, hover, drag, screenshots
  of any tab), off until you turn it on in Settings → Chromium DevTools. It asks for the browser's debugger
  permission, which the browser does not let an extension ask for later: on updating, Chrome asks you to accept it
  and keeps the extension off until you do. It still leaves out the sources of custom tools.

## 0.77.1

### Fixed
- The model can put a custom tool in a group when it creates or changes one (`custom_tools.save` and
  `custom_tools.edit` take `group`), move it to another and take it out; the card you review shows the group.
  Before, only Settings could.

## 0.77.0

### Added
- Each release carries the Firefox trial build, `teseo-browser-agent-X.Y.Z-firefox.zip` (unsigned: Firefox loads
  it only as a temporary add-on), and the sources it is built from, `teseo-browser-agent-X.Y.Z-firefox-sources.zip`,
  as addons.mozilla.org asks for bundled code. `pnpm zip:firefox` makes both; the sources zip holds only the files
  git tracks. Firefox is still not supported.

### Changed
- The Firefox trial build never checks for a new version: whether Mozilla will update it is not decided yet.
- The Firefox trial build follows Mozilla's add-on policies: it leaves out the sources of custom tools (tools kept
  in sync with a file at a URL; importing from a file or a URL once stays), and says so with a notice of its own; it
  never runs in private windows; and the data Firefox asks you to accept at install now also names authentication
  information (your keys and sign-ins, each sent only to its own service), bookmarks and your voice when you
  dictate. The privacy policy says what differs in Firefox.

### Fixed
- The Firefox trial build no longer logs an error in the browser console every time the chat or the toolbar popup
  looks for the window you are using, and if the last window you used was a pop-up, it now takes your last
  normal window, as in Chrome.

## 0.76.0

### Added
- The downloadable version tells you when a newer version is out. The first time you open the toolbar popup
  after the browser starts, it asks GitHub for the latest release (one request, carrying nothing of yours). If
  there is a newer one, the popup shows its number and a link to the releases until you close it with × (a later
  release shows it again), and Settings → About says your version is out of date until you update. Turn it off
  in Settings → About → Check for a new version. The Chrome Web Store version, which the store updates, never
  checks.

## 0.75.3

### Changed
- The Chrome Web Store version leaves out the sources of custom tools (tools kept in sync with a file at a
  URL): the store does not let an extension keep code in sync with a server. Importing from a file or a URL
  stays. The downloadable version keeps sources.

### Fixed
- Tool matching by words: a best match that reached the match needed only once rounded (39.9% shown as 40%)
  held every group instead of offering it.

## 0.75.2

### Fixed
- A message sent after the chat sat idle a while no longer waits on "…" for good where the side panel lives in a
  tab (Vivaldi): the chat opens a new connection to the worker when the old one went quiet, sends a message the
  worker did not answer once more, and then says so.

## 0.75.1

### Fixed
- An agent held to its sites reads its memory from any page: memory__read, memory__search and memory__list touch
  no site, so they no longer refuse "the agent may not use this page" in a full-tab chat or on a page not among
  the agent's sites. Saving and deleting are confirmed every time, as before.

## 0.75.0

### Added
- The phases of a turn, as they happen: while the agent works, the chat names the step going on instead of "…",
  and Layers lists them all with how long each took (starting the agent, listing the tools, what was attached to
  your message and by which source, each model call with its wait for the first token, reasoning and answer, each
  tool call, a confirmation waited for, an agent asked). They stay in your message once the turn ends.
- Tool matching (**Settings → Tools → Matching**): which tool groups go with a message. *All tools* (the default, as
  before), *Recommended* (every tool, and the groups your message matches named with it) or *Only matching* (only
  those; the others listed in `tools.load`, for the model to load when needed). Web, history, bookmarks, each custom
  tools section and each MCP server are matched, a group by its best tool; each MCP server can have its own choice.
- How a tool matches: by words and, with Memory's Semantic search, by meaning (in any language), judged against all
  the other tools for the message, not by a fixed percentage. When nothing stands out, *Only matching* offers rather
  than holds. How many groups it holds by meaning: *Offer more* (the default), *Balanced* or *Hold more*. Without an
  embeddings model it matches by words, which works in the language of the tools' descriptions; the tab and the pill
  say so. The tools are indexed in the background, and the tab shows how far.
- A group whose tool was used stays offered for the conversation; one offered only because nothing stood out does
  not. Each MCP server can have a **What it is for** of its own, in your words, matched with its tools.
- A 🔧 pill under your message says what tool matching did; the phases of a turn show it as *Matching the tools*.

### Changed
- An MCP server's **Its tools on demand** switch is now **Offered**, in its panel and its editor: *Same as Tools →
  Matching* (the default), *Always offered*, *Recommended when it matches*, *Only when it matches* or *On demand*.
- An MCP server that was not reached is no longer said in the chat with every message: the MCP button marks it, and
  a notice says why only when the model calls one of its tools.

### Fixed
- Messages no longer wait up to 15 seconds, again and again, for an MCP server that does not answer: the servers are
  connected as a conversation starts, before its first message, and a message goes without the tools of one that is
  not in yet. A server that failed is tried again when a new conversation starts.
- Auto-attach of memory, bookmarks and saved conversations no longer finds a full match in a message that shares one
  word with an item: the message's words no item has count against the match too (each as half a rare word). The
  model's own searches and the search boxes still find by any word.

## 0.74.0

### Added
- Agents hand each other work as a brief: `agents.ask` and `panel.start` take, besides the task, what is already
  known, what not to do, when it is done and what to send back, each optional; the asked agent gets them in sections
  and ends its answer with what it did and what it could not do or verify, and the caller is told how many tool
  calls it made and how many failed.
- The chat floating on a page has 🎤 dictation, on any site, even one that keeps the microphone from its frames: it
  records with the microphone allowed to the extension, and stops when the chat is folded or closed, or the page goes.

### Changed
- While dictating, the message box is framed in red with a strip inside it: the time, the sound's waves, the words
  just transcribed and **Stop**; *Finishing dictation…* in amber once stopped, instead of the dashed border.
- Firefox has no chat floating on the page, as it has no Speak: the popup's **Page** tile, **Settings → Appearance
  → Popup** and **Settings → Bubble → Opening the chat** show it greyed with the **unavailable** mark, and Settings →
  About lists it. There the bubble, its actions that open the chat, a card's **Open in the chat** and **Alt+Shift+F**
  open the chat full screen in a tab, with the action's message or the card's conversation.

### Fixed
- In Vivaldi, the chat floating on a page showed "… refused to connect": its frame is now a page of its own, loaded
  from the extension's fixed address, and shows the chat only in the bubble's frame, with a one-time ticket from it.
  A page that frames or opens that page by itself gets an empty document; every other page of Teseo stays out of a
  web page's reach, as before. A page can now tell that Teseo is installed, as with most extensions.
- In Firefox, connecting to an MCP server failed before any request ("Invalid domain … for
  declarativeNetRequest.updateSessionRules"): the rule that takes the Origin header out of the extension's own
  requests named the extension by its id, which in Firefox is not a domain.
- Where the browser cannot read aloud (Firefox), pages no longer get Speak's buttons, which could only fail with
  "Not read aloud": the speaker beside a selection (its actions still show), the one on an action's text boxes,
  and an action's answers read on their own.
- In Firefox, the chat floating on a page no longer opens only to fail with "can't access property
  "onActivated", … tabs is undefined": Firefox gives an extension page framed by a web page none of the APIs the
  chat needs.
- After the extension was reloaded or updated, the bubble on a page already open stayed there dead, kept the new
  one from starting, and its chat showed "… refused to connect", until the page was reloaded: the old copy failed
  while leaving. It now always leaves the page to the new one.

## 0.73.0

### Added
- Each version of Teseo now says what it leaves out, the same way everywhere, with one sentence per reason:
  the browser has no API for it (with a link to its docs page), or the Chrome Web Store version leaves it out
  (with a link to the downloadable version).
  - A section your version lacks stays in the Settings menu with an **unavailable** mark, and says what it
    does, why it is not here and where to get it.
  - A single control shows greyed with the same mark, and the reason under it: an agent's voice, the
    **Tab's audio** row in Settings → Appearance → Popup, and `browser.hover`, `browser.drag` and `speech.say`
    in Settings → Tools.
  - Tools your version lacks are never offered to the model; one that calls them anyway is told the tool is
    not in this version, not that it is unknown.
- **Settings → About**: the version, links to the docs, releases and issues, and what this version leaves out,
  or that it has every feature.

### Changed
- In Firefox, **Settings → Speak** stays in the menu with its notice instead of vanishing. Where the browser
  cannot capture a tab's audio, the popup shows that line greyed instead of leaving it out, and
  Settings → Voice no longer names it outside its own tab.
- Every link out of the extension comes from one place: the repository in `package.json`, or `TESEO_REPO_URL`
  at build time. Releases link to the latest; the docs, to the installed version's tag in a release built in
  that same repository, else to the default branch. The Chromium DevTools section no longer links to an old
  repository.

## 0.72.0

### Added
- A pinned conversation for the floating chat: 📌 on its bar keeps that conversation in the floating chat of every
  tab, the pin shown on in each, until it is unpinned (or the browser closes; not in incognito windows). Each message
  carries the page of the tab it is written from; each tab answers with its site's agent (else the agent it last
  talked to), chosen for that tab only. One tab runs a turn at a time: the others say where it runs and send nothing,
  and each shows the turns sent elsewhere once shown again; a chat never saves over turns another one saved since.
  Unpinned, each tab goes back to its own conversation; a pinned conversation deleted from the history, or moved to
  the side panel, unpins itself.
- Page widget actions beside the selected text: tick **Show beside selected text** in an action's editor (actions on a
  click that take a text or the selection) and, when you select text on its sites, the selection's 🔊 becomes a small
  toolbar with its icon (up to four, the rest behind **…**). It runs with the selection and its card, the same as the
  bubble's, opens under the toolbar next to the selection, inside the window; Esc, ✕, or a new selection closes it.
  Saved actions without the field show as before, and builds before this one ignore it.
- Settings → Providers → Models in the picker: tick the models you use, from the server's list (↻ Refresh from
  provider asks again) or typed. The chat's model picker then lists only those, the default model and the one in
  use; Show all lists the rest, and the filter looks through all of them. With none ticked it lists them all, as
  before. Exported providers keep them.
- The model picker lists the last five models picked, from any provider, first under Recent.
- The model fields of agents, page widget actions and compaction suggest the provider's default and ticked models.
- Settings → Voice tunes speech-to-text. **Vocabulary** (names, acronyms, terms; up to 300 characters) goes as the
  model's `prompt`, ahead of the last words dictated, and alone with a tab's audio. **Temperature** is sent only when
  set. **Silence level** (the loudest sound under which a chunk is not sent) and **Stop after silence** (seconds, 0:
  never) replace the fixed 0.01 and one minute. A tab's audio has its own **Language** (empty: detected, as before).
  **Test** records five seconds from the microphone, sends them with dictation's settings or a tab's audio's and
  shows the text, or the server's refusal as it said it, and the loudest level heard. Saved settings without them
  work as before, and builds before this one ignore them.

### Changed
- Settings → Custom tools: the editor leads you through a tool step by step, in the order it is made, the name and
  description for the model last. Each step folds to one line with ✓ and Change once done, keeping what was typed or
  tried in it; problems show beside their field once you have been through its step, and the side card counts what
  is left, with links to the steps. A new HTTP request can be filled from a pasted URL or curl command, or start from
  an example; what looks like a key is kept out of the URL and body the model reads (headers stay yours, keys in the
  query or body become saved values, user:password@ an Authorization header, cookies are left out). The values found
  in the request are each fixed, filled by the model (the description asked right there) or a saved value. Try it is
  a step: status, time and size, and the keys clicked in the JSON answer build Answer cut to, with how much smaller
  it gets. Inputs insert themselves into URLs, bodies and templates by a click; a name is suggested; an empty script
  offers Insert example; another kind or a pasted request over one being written asks first. Tools saved before open
  and save as they were.
- Settings → Actions: an action's editor is a guide, like the custom tool editor. It starts with what the action is for
  (answer about the selection, look it up with a tool, open the chat, check each page as it loads, several steps),
  each with an example, or a ready example that fills it; then one step at a time, with only what that kind uses:
  where it shows, what it takes, values from the page (optional), what it runs (chips insert `{input}` and the page's
  values), how the answer shows, Try it, and last its name and icon, with one suggested. Steps done fold to a line;
  the model, a tool before the prompt, reading aloud, the badge and the chat buttons fold until opened. Problems show
  beside their fields once a step was gone through, and the Checks card counts what is left. Actions saved before
  open folded, as the kind they are, and save unchanged. Choosing another kind or an example asks first, naming what
  it would clear, and keeps the steps that still apply done. An action on page load gets a badge with **Make it
  steps**; one with steps on page load now offers only tools that read, to each step too.
- The chat's context meter shows what the context is made of: the last request split into what every call sends
  again (the tool definitions, by group and by tool, and the system prompt) and what grows with the conversation
  (page blocks, tool results, messages and answers, site skills, images), with what each part changed since the
  call before. A small chart follows the input of every call, with the compactions marked, the first request and the
  last change. Links go to Settings → Tools, Limits and Compaction, and Compact now says how much trimming would
  take out. The session's totals add the reasoning tokens and, when the server reports them, the cached input
  tokens. The table by origin is folded under By origin.
- Smaller requests. While the tools that create things are on demand (Settings → Tools, on by default), Browser's
  system prompt no longer lists the skills that guide them; `tools.load` names them with the group and once it is
  loaded (new text `tools.load_skills`). Until then `templates.run` runs saved templates only (its own description,
  `tools.templates_run_saved`); a draft given anyway is refused saying to load the group (`tools.load_first`).
- Lower defaults: Page block 1,500 tokens (was 2,000), Tool result 8,000 characters (was 12,000), Page text
  7,000 characters (was 10,000), and 2 latest results sent whole during a turn (was 3), besides every result of
  the latest step (parallel calls) and the latest skill and reference read. A request near the window's end keeps
  only the latest one whole, besides those. Values you set in Settings → Limits or Compaction are kept.
- Shorter descriptions for `memory.save`, `browser.wait_for`, `browser.watch` and every browser tool's `tabId`.

## 0.71.1

### Added
- An action chooses how its boxes of text are read aloud (its editor → Reading aloud): the voice, its agent's or one
  of your profiles, and when, on a click of 🔊 (as before) or on their own as its card shows them. An answer written
  into one box is read as it streams; boxes wait their turn, and closing the card drops those not read yet.
- The chat can read each answer aloud on its own, as it is written, from its first piece: Settings → Speak →
  Reading → Answers read on their own, separately for the floating chat on a page, the side panel, and the Agents
  Panel (the chat shown, or every chat one after another). A reading on its own waits for the one in progress.

### Changed
- The plan reminder counts the model's tool calls instead of rounds: every 8 calls without showing the plan
  again, and every 20 in the turn even when it kept updating it. Both are in Settings → Limits (the second, 0: off).
  Its text (`plan.reminder`) asks the model to check its next steps still follow the plan.

## 0.71.0

### Added
- Page widget actions can read the page's main text as Markdown with `{{page}}`, as a value from the page or in a
  read step, up to its own limit (Settings → Limits → Page text for a page widget action, also in Settings →
  Actions). Site skills take it too, and Try picks a tab for an action that reads it.
- A speaker on each text box of an action's card reads it with Speak, in the voice of the action's agent, with
  Stop while it reads. Settings → Speak → Reading → Button on action boxes.
- Without a voice profile, Speak reads with the system's voice (Settings → Speak → Reading → System voice). This
  adds the `tts` permission.

### Changed
- The guide tells that each value a page widget action reads from the page is cut at 1,000 characters, and that
  `browser.get_page_text` can be an action's tool.

### Fixed
- In Vivaldi, the side panel no longer closes on its own when a message is sent while the background was asleep,
  when a shortcut wakes it, or when the pin is turned on.
- The background keeps a short trace of the side panel's opens and states, for when it closes unasked
  (`chrome.storage.session.get('panelTrace')` in the service worker's console).

## 0.70.0

### Added
- Speak: text read aloud by a text-to-speech model of one of your providers (`/audio/speech`). Settings → Audio →
  Speak holds voice profiles (provider, model, voice, speed), each with Test, and the sizes of the pieces read, the
  reading rules of a language (Spanish so far) and your own pronunciations. Read a selection with a shortcut, with
  the speaker beside the text you select or beside the selection chip; read an answer with the speaker under it.
  A pill on the page and a line in the popup show the reading and stop it; it goes on when you change tab or close
  the side panel.
- A voice profile can have its own reading rules (none, or a language); one without them follows Speak's
  "Default reading rules".
- Voice profiles export and import on their own from Settings → Speak, to a file or the clipboard, without keys.
  An import adds each profile or replaces the one of its name, and leaves the default as it is; a profile whose
  provider is not among yours comes in without one, marked. The paste box also takes a `Name=voice@speed` list.
- Agents can have a voice profile each, and a switch that lets an agent read aloud on its own (`speech.say`, off
  by default).
- Settings → Display chooses what the chat shows on each tool call and under the answer; Settings → Alerts, how
  the agent tells you it waits for you while the chat is out of view (silent, the badge, or a notification);
  Settings → Bubble → Actions, the shape, layout, labels and size of the bubble's actions.
- Settings → Export and import: one file with the parts you choose.
- Agents Panel (was "Agents at work"): its rows come back when you reopen it, and an agent of a row can start
  others, wait for them and tell them more (`panel.start`, `panel.wait`, `panel.send`).
- The popup says when the tab's site is not enabled, with Enable it.
- Firefox build (trial): the sidebar as the side panel; no tab audio, DevTools engine or Speak there.
- Settings → Limits: how long a model request may wait to start or stay silent, and how much text Speak reads at
  a time.

### Changed
- Custom tools' scripts run in QuickJS (WebAssembly): no sandbox page and no `unsafe-eval`. An endless loop is cut.
- The conversation is saved as the turn goes: closing the panel mid-turn keeps what was done, marked as stopped.
- History search ranks from a small search document kept with each conversation instead of reading them all; a
  query with a quoted phrase still reads them in full. Only the best 20 matches show a snippet.
- The bubble hidden on a site leaves nothing of it running there (no action on page load, no listener) until you
  call it back with its shortcut, Settings → Bubble, or by floating the chat there.
- The bubble's actions are square and large unless you set them otherwise.
- HTTP custom tools, a script's `request()` and tool sources follow no redirect; the error says so.
- `web.read` redirected to another site reads it only under that site's policy. A site's "auto" policy does not
  apply on its plain http pages, except on this machine.
- The confirmation card inside a page offers Allow and Deny only; "Always" is set from the extension's own pages.
- A model request that hears nothing for too long is given up, and a 429 or 5xx is asked again up to twice. An
  MCP server that does not connect in time is left out of that run.
- Page refs carry a token of their page (`ref_k3x_12`): one from before a navigation is refused.
- Settings has an Audio group, with Voice and Speak.
- Restore default, Clear the action log and Reset a preset ask first.

### Fixed
- A setting changed in one page is no longer overwritten by another page's older copy, and one changed just
  before its page closes is stored.
- After the extension reloads, tabs already open take the new page script: clicks and typing no longer report
  success with nothing done.
- A lost connection or an error in the middle of a tool call leaves a conversation the model's server accepts.
- Importing settings with a History retention asks before it deletes conversations; retention ignores values
  that are not whole numbers from 1 up, and never deletes a conversation open in another chat.
- Turning Temporary on and off in an empty chat no longer leaves that conversation unsaved.
- A recording keeps the answers that arrive while it settles after Stop, and its page hooks step aside when it
  ends.
- MCP → From a provider: a check that ends after you pick another provider is not shown, so one provider's key
  never goes to another's servers. A read-only MCP tool is retried only when the connection failed.
- Importing or syncing a custom tool keeps its saved secrets, session and "read only" only for the same site and
  method.
- Number fields keep what you type until you leave them. New agent keeps the tab you chose. A met watch is not
  lost when the chat is busy.
- On a narrow side panel, the bar under the messages goes on to more lines and the page no longer scrolls
  sideways.
- Stop keeps the results of the tool calls that had already ended. A `<think>` tag counts only at the start of an
  answer.
- `wait_for` and watches no longer read the whole page at every check, and a search cut at its limit is never
  taken as "gone". Real input reaches elements inside shadow roots.
- A debugger left attached by a stopped worker is detached when it starts again; a screenshot's mask takes itself
  away if its unmask never comes.
- Memory vectors are tied to the server they came from; a changed vector length no longer re-sends everything.
- The Agents Panel's tools, page keys and the widget's place answer only to the extension or to the page's own
  site.

## 0.69.1

### Added
- Settings → Compaction → Learned lists, per model, the window learned from a server's "too long" error and the
  correction of the estimates, each with Forget.

### Changed
- "Context nearly full" says how full, of which window and where it comes from, and what the tools take:
  "Context nearly full (66k of 72k, default window; tools 28k)".
- On a window that is only Settings → Compaction's guess for an unknown one, a turn shortens its earlier results
  only so far on its own: no more unless the server refuses a request as too long.
- Once the server reports a request's usage, the next one of the turn is counted from it plus what changed,
  instead of the whole estimate times the model's correction.
- A request shortened to fit keeps the latest two tool results whole (one before); this turn's calls always
  keep their arguments.
- Compact now always answers: what it compacted (tokens before and after), or why there is nothing to compact,
  with the share of the system prompt and the tools when that is what fills the context. A step that would save
  nothing is not made.
- The context meter says which window a turn counts on when the model's is unknown.

### Fixed
- A window is learned only from an error that refused the request as too long, and a learned one smaller than what
  a later call took is forgotten.

## 0.69.0

### Added
- Settings → Appearance → Popup chooses what the toolbar popup shows: each tile, each screenshot, Tab's audio,
  Requests and Agents at work, and whether it shows the keys and the block titles. The popup itself is the
  preview. A hidden line still shows while it captures or records, or while what it caught waits for review;
  Settings (the gear) always shows.
- Settings → Appearance → Fonts: a text font and a code font from short lists, or one installed on the computer by
  name, everywhere or only in the messages. Saved and exported themes keep them.
- Bold follows the theme's accent, and each built-in theme brings its italic and code colors and its colors for
  what things are (a tool, the model, a page…). Bold, italic and code can also be set by hand over a theme.
- MCP servers: several servers from a provider can be ticked and added together, and those already added are
  marked.

### Changed
- The toolbar popup comes in three blocks: Open the chat, Into the chat and Agents. Each tile shows its key, and
  the place the bubble opens the chat in is marked default. Tab's audio and Requests are lines with ● Start; while
  busy, the line turns the accent color with a blinking dot and Stop.
- Settings has a RAG group (Auto-inject, Memory, Skills, Site templates, Bookmarks, History). Most sections now
  share one layout: a head with the section's main switch, a strip of figures, tabs, filter chips, and rows with
  switches. That covers the RAG sections, Compaction, Appearance, Word blacklist, Limits, Tools, Custom tools,
  MCP servers, Chromium DevTools, Recording, Actions, Bubble, Voice, Providers, Web search, Site policies and Logs.
- Tools opens each tool in a side panel. Providers, Recording and Custom tools list on the left and show the chosen
  one on the right. Limits are cards in a tab per kind. Matching tabs show what each match needs, with Try a
  message under them.
- Bookmark auto-attach compares whole words, as memory and history do ("lem" no longer matches "Lemon pie").

### Fixed
- Switches: the knob sits inside its track, and keeps its size inside editors.

## 0.68.2

### Fixed
- `browser.press_key` without the DevTools engine behaves like a real key: events carry `key`, `code` and the
  `keyCode` many pages read, go to the element focused first, and the browser's part is done unless the page
  cancels it (Enter presses a button or link or sends a form, Space presses a button or ticks a checkbox, the
  arrows move a drop-down's choice, Tab moves the focus).
- Synthetic clicks send a real mouse's events and move the focus as a press does. When something else covers the
  element at its center (a dialog, a banner), the model is told so instead of taking the click for a success.
- `browser.type` checks the value of date, time, color, range and number fields before it goes in, and refuses
  checkboxes and buttons. Elements in a disabled `<fieldset>` or under an `aria-disabled` one count as disabled,
  and a disabled option is not selected.
- `browser.get_page_text` and `web.read` keep tables as Markdown tables. When a page has no article, its text no
  longer includes the contents of scripts and styles, which could carry tokens.
- The page snapshot's names come from Playwright's accessibility code: no more glued or repeated names
  ("49,99 €49,99€"), and aria-hidden copies are left out.
- Searches in memory, history and bookmarks find words in any alphabet, and Chinese, Japanese or Thai words.
  Letters such as ß or ł match their base letters.
- Memory tool calls show the item's title in the chat, in the call's row and above its arguments.
  `memory__search` no longer claims to return a snippet.

## 0.68.1

### Fixed
- A slow MCP tool no longer has to fail at 60 seconds: each server has a Tool timeout (seconds) in its
  editor, 1 to 3600, for all its tools. Empty keeps the 60 seconds; Stop still cuts a call.

## 0.68.0

### Added
- The headings of the model's answers fold and unfold, in the chat and in the page widget's cards: a
  heading's button hides what is under it, down to the next heading of its level or higher, its
  subheadings too. What is folded stays as the answer streams and once it is finished, for as long as
  the panel is open; it is not saved.
- Memory items can match by meaning as well as by words (Settings → Memory → Semantic search, off by
  default), with an embeddings model of a provider you configured, chosen from the models it lists
  (those that look like embeddings first) or typed. The text of your items and each message you send go
  to that provider; pinned items stay out, and word blacklist terms are masked. An item passes by its
  words or by its meaning, each with its own threshold, and Auto-attach's search shows both. If the
  provider does not answer, the message goes by words only and the chat says so.

### Changed
- Memory items linked to the open site no longer all go whole: pinned ones do, and so do those your
  message matches, at Auto-attach's match level even with Auto-attach off. The rest go as a line with
  their title, and the model reads them when they touch the task. Items are not pinned for you: pin
  those that must always go. Turning off Settings → Auto-inject → Only those that match goes back to
  sending them all whole; an agent without `memory.read` always gets them whole.
- Pinned now also applies to an item linked to a site: it goes whole while that site is open.
- The model is told to read the memory items whose title touches the task before acting, that your
  message wins over an item that conflicts with it, and to propose updating an item that covers or
  contradicts what it learned instead of adding another.
- The ✨ menu groups its rows as Memory, Site and Saved, with a new "Match by meaning" that stays off for
  that conversation.

## 0.67.1

### Changed
- The model is told when to start a plan: `user.plan` comes first in a task of several steps, and a
  question or a task of one or two actions goes without. After 3 rounds of tool calls in a turn with
  no plan shown, it is asked once to show one if several steps remain (a "Plan reminder" pill).

### Fixed
- A plan with steps left survives a compaction: the model used to lose its steps once they were
  summarized or trimmed, while the panel still showed the plan.
- Closing a plan in the panel now lasts: it stays closed when the conversation is opened again, and
  the model is no longer reminded of it, nor sent it after a compaction.

## 0.67.0

### Added
- Screenshots from the toolbar popup: a Screenshot row with Section (drag over a part of the page),
  Visible and Full page. The image is attached to the chat's message box, not sent: the chat
  floating on the page, or else the side panel, opened for it. A section is dragged on the page as
  it is, and the panel opens after; if the browser does not let it open by then, an "Attach to chat"
  button by the section does. Full page is captured on the DevTools engine when it is on, otherwise
  scrolled a screen at a time, and attached in parts of a screen each, as many as a message takes.
- Keyboard shortcuts for the screenshots: Alt+Shift+S for Visible; Section and Full page have none
  until you set one on the browser's shortcuts page.
- Settings → Shortcuts shows each action with its browser shortcut and a key of its own, recorded
  there: click its field and press the keys. Such a key works in the websites the extension may read
  and in its own pages; a key the browser or the system keeps, one that types a character, another
  action's browser shortcut or a key set already is refused with the reason. A screenshot from it
  needs access to every site. The section opens the browser's shortcuts page too.
- Presets for recording a page's requests (Settings → Recording): API calls (the default: fetch, XHR and
  WebSockets, JSON and text answers, a repeated call kept once, analytics, tracking, pixel and ad addresses left
  out), Everything and Errors only, editable, and your own. Calls a preset leaves out are only counted; the review
  says how many.
- Recording from the toolbar popup (a Record line under Screenshot: a preset, then This tab, or with the DevTools
  engine Several tabs and Tabs and mouse) and with a shortcut (none until you set one). While it records, the
  toolbar icon counts its calls and a pill on the page shows it with Stop; stopping opens the review in the chat.
- The review's search understands the Network panel's words: method:, status-code:, domain:, -domain:,
  mime-type:, larger-than:.
- At the top of a Settings section, its shortcuts and the size limits that apply to it, set there
  as in Settings → Shortcuts and Settings → Limits (the same values): About you, Skills, Site
  templates, Auto-inject, Memory, Compaction, Tools, Custom tools, Recording, Bubble, History, Voice
  and Web search. Memory's index limit moved there.
- A tab's audio, from the toolbar popup's Audio line or a shortcut (none until you set one): you keep hearing the
  tab while it is captured, with the popup closed too. Choose where it goes: Review, a page of its own with the audio
  and its transcript in step, each line editable and a click on its time playing from there; Chat, its transcript in
  the message box of the chat for that tab, not sent; or Audio only, a .webm file to save. It is transcribed as it
  plays with Settings → Voice's model, in chunks of 30 seconds or less; a chunk that fails leaves a gap, with Retry.
- Settings → Voice: what the pill shows while a tab's audio is captured (its transcript, its sound's waves), chosen
  from options with a drawing of each, and its chunk length.
- Settings → Limits: Transcript of a tab's audio sent with a message (20,000 characters) and How long a tab's audio
  is captured (60 minutes).

### Changed
- Every Settings section has its icon in the menu: Compaction, Limits, Word blacklist, Chromium
  DevTools, Actions, Shortcuts, Providers, Web search, Website access, Site policies and Logs had none.
- Settings → Bubble points to Settings → Shortcuts when its shortcut is not set.
- A recording starts and stops from the toolbar popup's Record line, the pill on the page or its shortcut:
  the chat's ⏺ button is gone. Its review still opens in the chat.
- A recording goes on when the chat closes, until you stop it, its tab closes or it reaches a limit.
- Without the DevTools engine, Everything also lists documents, form posts, scripts and WebSocket and beacon
  connections (answers' bodies only for fetch and XHR, as before), and a recording stops when its tab goes to a
  site the extension may not read.
- Settings → Skills, Site templates, Custom tools, Actions, Agents and Memory share one toolbar: Select,
  Import ▾ and Export ▾. On/off is drawn as a switch (Agents' Can ask and Can be asked too) and an export
  never looks at it.
- Export ▾ downloads or copies all of them, those the filter shows, or those chosen with Select (a column
  of checkboxes and a bar with Download and Copy JSON).
- Import ▾ reads a file, pasted JSON or a URL (a raw file; a file's page on GitHub is read as its raw
  file), one item or many, always through a preview: each item new, replacing yours, or left out with
  why, ticked to import. A URL asks access to that one site only. Old export files import as before.
- The floating chat's **◨ Open in the side panel** is on its own bar, next to **–**, and opens the side
  panel the way the bubble does.
- The recording review fits the side panel: a head with the site, calls, time, preset and how many were left
  out; folding sections that each say where they stand (Calls, Private values, Variables for a tool, What the
  model gets); and the actions kept at the bottom: **Attach N calls** first, **Make a tool…** (was Create a tool
  from it), **Discard** apart, with a line saying nothing is sent until you send your message.
- **What the model gets** shows exactly the text that goes with your message, hidden values as the model sees
  them, and its size against Settings → Limits; past the limit, it says how many calls go without their bodies.
- The ticked calls carry the numbers the model and the variables use (#1, #2…). A call's Variables tab is now
  **Values**, and **Hide selected value** sits by what the call sent or got.
- The attached recording's chip says its size.
- Another recording waiting for review shows as a band under the review's head.
- The recording review's variables moved to a step of their own: **Make a tool…** first shows the calls
  ticked and what changes each time the tool runs, in plain words (*You give it each time*, *From #1's
  answer*, *Worked out (+1)*, *Always as recorded*), each with where it comes from and where it is used;
  then **Make the tool** attaches it. The × that took a variable out is gone: *Always as recorded* does
  the same, and a variable taken out before now shows as that.
- **Attach** sends a recording without its variables: only **Make a tool…** sends them to the model.
- Ten more limits can be changed in Settings → Limits: visible elements read from the page,
  elements read by browser__read_page, selected text, records of a site skill list, ::site mentions
  per message, page text, structured data, matches listed by browser__find_in_dom, WebMCP tool
  result, and WebMCP tools a page can offer (only lowered). Nested renders and WebMCP tool
  descriptions and parameters stay fixed.
- A Settings section's "Sent to the model" fold is tinted in the accent color, and its "Mentions" fold
  in blue with an @, told apart from each other and from the other folds.
- browser__get_page_text tells the model the default size in force, not the shipped one.
- Settings → Limits says when the tool result limit cuts a tool's text first.
- While the model works on your last message, its answers go back to it with their reasoning: models that
  think between tool calls (such as Qwen3) keep on from it instead of starting over, and call tools with
  fewer empty arguments. A server that rejects the field is asked again without it.
- Script tools are easier for the model to write: custom_tools.save tells it that each input is also a
  variable by its name, that the script calls the tools in `uses` with `tool()`, and that it runs apart
  from any page (its `document` is not the page's). A script that declares one of its inputs again, or
  uses a name it does not have (`navigate is not defined`), gets an error that says so and what a script has.
- A recording hides the values under secret-looking keys in multipart forms too (by each part's name) and in
  JSON sent line by line (NDJSON, the `data:` lines of server-sent events). A text body it cannot read but that
  has named fields (`name="…"`, XML say) is marked ⚠ in the review and starts unticked.
- Without the DevTools engine, a page's answers are read whole up to 200,000 characters (was 1 MB): a JSON
  answer longer than that shows as too large to check for secrets.
- A stopped recording that no chat takes is discarded after 30 minutes, so that its bodies do not stay in the
  browser's session storage.
- A tab's audio is captured only on a site the extension may read, as a recording is: elsewhere it says "This site
  is not enabled." instead of capturing with no pill on the page.
- A server that refuses `verbose_json` (gpt-4o-transcribe, many local ones) is asked for it once: the next chunks go
  for the text alone, instead of each being uploaded twice.
- A recording's WebSocket call that a preset leaves out releases its "repeated call" key like any other, so a
  later one with the same body is kept.
- The chat shown in Settings → Appearance no longer takes a conversation handed off from the bubble, as it
  already took no screenshot or recording.
- A build made from a branch says which branch and commit it comes from, beside its version on its card in
  chrome://extensions (`0.67.0 (feat/x @ 1a2b3c4)`, with `+` when it has changes not yet committed) and in the
  toolbar icon's tooltip, to tell which build is loaded. A release, built from its tag, says neither.
- Settings → Tools: the texts of `tools.load` are folded under "Sent to the model", as on other pages.
- Settings: Auto-inject moves to the Chat group, between Bubble and History.
- Settings → Bubble and the actions' "What it shows": these options are radio buttons over a drawing of each: where
  the chat opens, the floating chat's side and height, what the bubble does while it works, and what an action shows.

### Fixed
- `browser.type` into a chat composer or another rich text editor (Slate, Lexical, ProseMirror): the text now reaches
  the editor's own state, so Enter sends it. Clearing the field took the editor's nodes away from under it: the text
  was lost or only seemed to be there, and Enter sent nothing, or the old draft. The text typed now replaces a
  selection of the contents.
- On the DevTools engine, `browser.type` and `browser.press_key` no longer say they did what did not reach the page: text
  or a key that went elsewhere is an error, and no Enter follows the text. When the page lacks the browser's focus (you
  just wrote in the side panel), a real press on the text field gives it the focus first.
- `browser.type` with `clear: false` on the DevTools engine adds to the end of the value; a field not focused yet got
  the text at its start.
- An import holding the same name twice, one of yours, saved both over it; the second is now left out.
- A file of another list (say site templates pasted into Skills) says where it goes instead of being
  read as one item.
- In Vivaldi, **Float on this page** no longer leaves the side panel blank (the browser's start page)
  until the extension is reloaded: the panel is now closed the way its shortcut closes it.
- In an import's preview, each item's box shows beside its name, not above it.
- The buttons under the message box, and those in the top bar, are no longer cut off at the right edge:
  when one grows after the panel opens (the tools' count, the agent's name, the model) or the chat fills
  its top bar buttons, those that no longer fit go behind **⋯** as before.
- A recording preset with no kind of call ticked can no longer be saved (it recorded nothing); one saved
  before says so instead of starting.
- A recording that fails to start (the site not enabled, another debugger on the tab…) no longer leaves an
  empty one waiting for review: it says why.
- A recording that stops while the chat reviews another now waits until that review ends, instead of
  replacing it and losing what you ticked and hid.
- The review's search no longer hides every call while a term like `domain:` or `larger-than:1` is still
  being typed.
- In Vivaldi, a recording's Stop, a screenshot, the bubble's chat, the popup's **Panel** and the floating
  chat's **◨** no longer close a side panel that is open: what they bring shows in it.
- A recorded request sent compressed (gzip or deflate, as large JSON APIs often do) no longer shows as
  garbled characters in the review: it is unpacked, and secret-looking values in it are hidden as in any
  other body. A body that is not text (an image, protobuf, a file) shows as `(binary, N bytes)`, in the
  review and for the model.
- The review no longer takes IP addresses, timestamps or numeric ids for phone numbers (nor a timestamp
  in milliseconds for a card number): an IP address only gets a note (ⓘ) and no longer leaves its call
  unticked, and the same kind under the same key is listed once, with how many.
- Without the DevTools engine, a recorded answer longer than 20,000 characters no longer shows the
  secret-looking values it holds: the page now tells it whole (up to 1 MB), so they are hidden before it
  is cut. A JSON answer over 1 MB, which cannot be checked, is not shown.
- The model can now read and click what a page draws inside an SVG: the HTML in its `foreignObject`, such
  as the icons of a chat app's side rail, shows with its refs in the page's elements, `browser.read_page`,
  `browser.find` and `browser.get_html`. Before, those entries were missing, or only their names showed
  as plain text.
- `browser.find`, `browser.find_in_dom`'s `attr` and `browser.select` by visible text no longer depend on
  accents: "agora" finds "Ágora". What the model is shown keeps the page's accents.
- On the DevTools engine, a click on an element in a list that scrolls smoothly no longer lands where the
  element was before the list scrolled to it (another entry, or a gap) while the reply said *clicked*.
- A click that changes nothing on the page now says so (*clicked, but nothing changed*) instead of
  *clicked*, so the model does not take a miss for a success. What only hovering or focusing the element
  shows, such as its tooltip or a focus ring, is not a change; what the page does on the click event is.
- The model now reads the links and buttons inside a list or panel that scrolls by keyboard (a chat's
  channel list, say) one by one, each with its ref. It used to see the whole area as a single clickable
  entry with its text glued together, and had to search the page's HTML to reach them.
- A dotted date or time (`2026.11.02.14.30`) no longer counts as a phone number in the review; a number under
  `number`, `contact`, `sms` or an item of `phones[]` does.
- An address pattern with many `*` in a recording preset or a `domain:` search no longer slows a recording
  down on long addresses.
- A key set in Settings → Shortcuts for the audio command now says it cannot capture a tab's audio (the browser
  lets the extension capture a tab only after the toolbar button or a browser shortcut), instead of the browser's
  own error.
- A long capture no longer keeps the whole audio in the recorder's buffer, and only the last 20 failed chunks keep
  their audio for **Retry**; an older one says so.
- A click that only changes the look of what was clicked once a request answers (a star, a like, a follow
  button turning on) is no longer reported as "clicked, but nothing changed"; nor is one that opens a menu or
  dialog rendered into a shadow root created then, or that fills a same-origin frame.
- A page's snapshot no longer goes into an SVG drawing's shapes (a large inline map is thousands of paths):
  only its groups, for the HTML a drawing holds.
- In the recording review, ticking a call or typing a variable's name no longer waits for the model preview of
  a big recording: it shows first, and the preview catches up.
- The audio pill disappears with the capture's end rather than a moment before it.
- The recording and audio pills come back when a page replaces its document (an app's own navigation), and the
  toolbar popup's **Panel** tile, asked right after the extension starts, no longer closes a side panel that is
  open in Vivaldi.
- Settings → Bubble: the Own color picker is a compact swatch, like the ones in Appearance, instead of a bar filling
  the row.

### Documentation
- Screenshots of the recording review and of what the model gets.
- Screenshots of the toolbar popup, the tab picker, the agent manager, importing into a Settings list,
  a question and a plan from the model and the page widget's bubble; the earlier ones taken again
  from the current version.
- Custom tools: what a script has (its inputs also by name, request(), tool(), note()), and that it
  reaches pages only through tool().

## 0.66.0

### Added
- A tab picker in the page bar (the window's side panel and full screen): the open tabs by window,
  installed apps' marked, with the chat's tab and yours; choosing one makes the chat work on it.
  "Use this tab" stays, and "Go to it" brings the chat's tab to the front of its window.
- The model is told when you send a message from the side panel while on another tab than the
  chat's: that tab's id, title and address.
- `browser.switch_tab` brings an open tab to the front of its window (not the window itself), when
  you ask or agree; the tab the chat works on does not change.
- `user.plan` reminders: when the model has gone five rounds of tool calls without updating a plan
  it showed in this turn, and steps are left, the plan goes after the step's last result for it to
  update, shown in the chat as a "Plan reminder" pill. The system prompt says the model can show a
  plan, and a plan may have any number of steps.
- The toolbar popup opens the chat full screen in a tab.

### Changed
- `browser.list_tabs` lists the window of the chat's tab, or with `window: "all"` every window,
  grouped (its type, `app` for an installed app, whether it is focused, its active tab). Tabs are
  marked `workingOn` (the chat's) and `userOn` (the one you are looking at); the agent's own
  minimized windows are left out.
- The toolbar popup has a Settings gear top right and the three ways to open the chat on one line:
  on this page, in the side panel and full screen; the agent manager has a row of its own below.
- A plan whose steps are all done leaves the panel once its turn ends; a new plan brings it back.
- The chat opened full screen in a tab takes the tab's whole width: prose keeps a readable line
  length (120 characters), tables, code, diagrams and images use the whole width.
- On the DevTools engine, a tab in the background (or in a minimized window), which real input does
  not reach, gets a click, typing, a key or a scroll as synthetic events, and the model is told so
  and how to get real input; hover, drag and keys with modifiers fail and say why.

### Fixed
- `browser.list_tabs` no longer lists only the last focused window (from an installed app's window,
  only that one).
- The chat no longer changes to another agent after a sub-agent is given the site ("Always" on its
  card during `agents.ask`). It changes to a site's agent only on reaching another site, from Browser
  or an agent a site chose, never from one you chose; a status line says when it does.
- On the DevTools engine, the agent's own bubble or floating chat no longer covers the element it
  clicks or types in.
- `browser.type` with `submit` waits for the page to take the text in before Enter, so editors that
  keep their own state (ProseMirror and the like) send it.

## 0.65.2

### Added
- The model gets the list of your site templates in the system prompt: each one's description,
  and its views with the paths they apply to and what they extract. It can then suggest a
  `::site/view` mention for data from another site. Built-in templates are not listed.
- A view of a site template has an optional description, in the editor, in `templates.save` and
  in `TEMPLATE.md` (`<!-- view: … | description: … -->`).

### Changed
- A site template's description is for the model too: what it extracts and when it helps.

## 0.65.1

### Added
- An agent asked by another that runs out of rounds of tool calls asks you whether to go on, in a
  card: **Continue** lets it go on where it was, with as many rounds again; **Stop** gives its caller
  what it has, as before.

## 0.65.0

### Changed
- The page's visible elements read like a short Markdown page instead of an indented tree: the
  page's sections as `--- main ---`, headings as `#`, links as `[name](href) [ref_N]`, a group that
  fits on one line (a menu, a search form) with its parts joined by ` · `, and one `- ` line per
  list item or table row. Wrappers without a name (lists, list items, articles) are left out, and a
  label's text is not repeated next to the field it names. `browser.read_page` and `browser.find`
  write elements the same way.
- With only interactive elements read, a list item or a table row keeps its short text, so that
  buttons repeated on every item can be told apart.

### Fixed
- A link inside a heading (a search result's or an issue's title) has its ref and its target again.

## 0.64.1

### Added
- `memory.list`: the memory items an agent may read (its own and the global ones), a page at a
  time, by site or pinned.
- A memory item has a title of its own (up to 80 characters), required for a new one; the system
  prompt and `memory.read` show it instead of the text's first line.

### Changed
- The skills that make page widget actions, custom tools, script tools and site templates come
  with whole examples of each case, a section on security (no secrets, a fixed host, reads by
  default, what a page or an answer says is data) and the mistakes that make a call fail.
- `actions.save` describes each kind of step (a read of the page, a tool, a question to the model)
  with its own fields, instead of a step being any object.

### Fixed
- A tool call with empty or broken arguments gets an error that names what is missing, with each
  argument's hint; a call to a tool that does not exist suggests the closest names.
- A call blocked again by the repeated-calls guard makes the next request ask for an answer, not
  more calls.
- Background tabs (`web.read`, sub-agents) open in a normal window, never in an installed app's
  (PWA) window, which stole the focus; a sub-agent works in a background copy of your page.
- `web.read` takes `maxChars`, and the same read in a run may be repeated.

## 0.63.3

### Fixed
- A tool call that arrives with arguments that are not JSON is never run. The model is told so,
  with the start of what came and the text around where it breaks.
- A call that arrives with no arguments, for a tool that requires some, says so instead of
  "missing argument". It tells the model the server may have cut them off and to send long ones
  in smaller calls.
- Tool calls from servers that leave out `index`, send every call under index 0, or send a call
  twice (once without arguments) are put together as one call each.
- A script tool's syntax error gives its line and column, with the line and a caret.
- `custom_tools.save` and `try` describe both shapes of a script (steps that call tools, or
  requests to an API) and say which part is missing. A parameter name like `timeoutSec` comes
  back with the name to use (`timeout_sec`).
- An edit whose `old` text is not found shows the closest text, ready to copy. An empty `old`
  says how to add text or replace all of it.
- A wrong tool, skill or template name in `agents.save` comes with the closest real names. A
  wrong reference file of a skill lists the files it has.
- `browser.type`, `click` and the other tools that need a `ref` say where to get one when it is
  missing.

## 0.63.2

### Fixed
- A tool call's arguments are checked against the tool's whole schema before anything runs:
  wrong types, values not among the options, required values inside objects and misspelt names.
  The model gets every problem at once, with what to fix. `custom_tools.try` checks its sample
  the same way.
- Arguments that can only mean one thing are read as the tool takes them: `"5"` as 5, `"true"` as
  true, one value as a list of it, `"Down"` as `down`, `tab_id` as `tabId`, and null as not given.
- A call that fails twice in a turn with the same tool and the same arguments is not run a third
  time. The second failure tells the model to change its approach.

## 0.63.1

### Fixed
- An MCP tool's JSON answer reaches action steps and script tools (`tool()`) as data, so "Keep
  only" and the boxes can pick paths in it. The model still gets it as before.

## 0.63.0

### Added
- **The DevTools engine** (Settings → Chromium DevTools, off by default). While it is on:
  - `browser.click`, `type`, `press_key` and `scroll` send real input.
  - `browser.screenshot` can capture any tab, one element, the whole page, or a phone or dark
    view. Sensitive fields are masked.
  - `browser.wait_for` can wait for the network to go quiet.
  - The new `browser.hover` and `browser.drag` are offered.
  - The engine reaches only the sites the extension can read. It is attached for one call at a
    time, and the chat shows a DevTools chip meanwhile.
  - What the engine cannot do fails and says why. It never falls back to synthetic events.
  - Its tools carry a "DevTools" badge in Settings → Tools, the 🔧 menu and the chat.
- **Recording through DevTools**: with the engine on, ⏺ records this tab, several tabs, or tabs and
  your clicks and typing.
  - It also captures Web Workers, WebSockets and the page's own load.
  - The review marks with ⚠ what looks sensitive, and those calls start unticked.
  - Any value can be hidden under a name, which the model sees as `••••[name]`. A custom tool
    sends it as `{{secret:name}}`, only to its own site.
  - Each call shows its site, and a recording that touched several sites lists them.
- **Action steps**: an action can chain steps by name: read from the page, call a tool, ask the
  model.
  - A tool step can run once for each item of a list, up to 20.
  - Values put into URLs are encoded.
  - An action can show a badge on the bubble.
  - The result card can carry on in the floating chat (💬) or in the side panel (◨), with the
    steps' values.
  - `actions.save` takes steps too.
- **Edit before allowing**: the review card of every save (memories, skills, site templates, agents,
  actions, custom tools) has Edit. You fix a field on the card and allow the corrected version,
  and the model is told what you changed.
- **`chat.compact`**: the model can compact the conversation at the end of the turn, when you ask
  (`$chat.compact keep the prices`) or on its own. Its instructions go to the summarizer.
- **About you** (Settings): write about yourself once. `{{about_user}}` in your system prompt or
  in an agent's instructions is replaced by it, cut to Settings → Limits.
- **A tool call's result on its own**: the call's row has `args` and `result` switches, and
  `error` for a failed call. A screenshot shows as a thumbnail that opens the result.
- **Links in history titles**: `[text](https://…)` in a conversation's title is a link in History.
  The model gets the title as written.

### Changed
- Your messages render as Markdown, like the model's replies. Mentions stay chips.
- One color palette across the panel: each color means one thing, the same for tools, steps,
  content from pages and what goes to the model.
- `agents.catalog` lists tool groups with how many tools each has. With `group`, it lists that
  group's tools.

### Fixed
- A conversation is no longer compacted a second time on the turn after a compaction.
- The end of the chat (an Allow/Deny card, a notice) stays reachable after unfolding a tool
  mid-turn.
- The page bubble shows on sites that hide undefined custom elements, such as Reddit.

## 0.62.0

### Added
- **Agents at work**, a page in a tab that runs several agents at once, each on its own tab.
  - It opens from the side panel's top bar.
  - Each agent has its own agent profile and model. "+ New agent" picks its tab and agent.
  - The list shows each agent's page and what it is doing now, and marks with ⚠ the ones waiting
    for you. ↗ brings an agent's tab to the front.
  - Its chat opens beside the list, and the divider between them can be dragged.
  - History shows, on each conversation, every agent that took part in it.
- **Toolbar popup**: the extension's button now offers:
  - Agents at work;
  - Chat on this page;
  - Chat in the side panel;
  - Settings.

  ⌥⇧A still opens the side panel.
- **Full-screen chat**: "Open in a tab" in the side panel's top bar opens the chat as a page in a
  normal tab, with its own agent and model.
- **PDF attachments**: the paperclip's File…, a drop or a paste takes PDFs.
  - Their text goes to the model page by page. A long one is cut at a page's start, and the model
    reads on with `tools.read_more`.
  - A scanned PDF, with no text, goes as images of its pages.
  - A saved conversation keeps only the PDF's name.
- **Voice dictation**: 🎤 in the message box fills it as you speak, a chunk at a time, through
  your provider's `/audio/transcriptions`.
  - The text stays in the box for you to send.
  - Settings → Voice sets the audio model, the language, the chunk length and the microphone.
  - Silent chunks are skipped, and dictation stops after a minute of silence.
  - The first time, the side panel asks you to allow the microphone once in a tab.

### Changed
- The save tools (templates, agent profiles and the like) take small find-and-replace edits
  instead of the whole content, and their review card shows a line diff.
- While the agent works, the message box shows only Stop.
  - Enter queues what you write, and ⌘/Ctrl+Enter sends it now.
  - The queue above the box has its own "send now".

## 0.61.1

### Added
- **`custom_tools.try`**: the model runs a custom tool's draft once, unsaved, with sample values,
  and sees what it would answer. You are asked every time, and its card shows the whole draft.
  The create-custom-tool and create-script-tool skills now try a tool before saving it.

### Changed
- Custom tools are easier for the model to write:
  - what keeps a draft from being saved says how to fix it: how to declare an input, what
    `{value}` is for, how to set a required parameter, and the base tool's parameters;
  - an `extract` that finds nothing names the answer's keys; a script that returns nothing, or
    does not parse, says so;
  - a base tool or a tool in `uses` can be named as the model sees it (`web__search`), and a tool
    in `uses` that does not exist is refused;
  - create-custom-tool asks the model to look at the API first (with `custom_tools.try` or a
    recording) and to give optional inputs a default.
- Any tool call whose object or list arrives as JSON text is read as the tool expects, instead
  of failing.

### Fixed
- In Vivaldi, which has no side panel per tab, the chat's pin no longer closes the side panel.
  The pin is hidden there, and the side panel always follows you across tabs.

## 0.61.0

### Added
- **Word blacklist** (Settings → Word blacklist). It keeps a list of sensitive terms, each with the
  placeholder you choose, for example `CLIENT_A`.
  - The terms are replaced before anything reaches the model, and restored in its replies, its
    reasoning and its tool calls.
  - It applies with the providers and models you pick, or on the pages you list. With neither
    listed, it always applies. Once a chat goes masked, it stays masked.
  - A page bar chip shows when it is on, and turns it on or off for one chat.
  - It can hide screenshots and images from the model.
  - The terms are kept in the extension's private store. They can be exported to JSON and imported
    from JSON or CSV.
- **`browser.get_html`**: the cleaned HTML of the elements matching a CSS selector, with scripts,
  styles and comments removed and long attributes cut. It shows the model a page's real markup, for
  example to write a site template's selectors.
- **Reading on after a cut.**
  - `browser.get_page_text`, `web.read` and `browser.get_html` take `from`, so the model can
    continue where a long text was cut.
  - Any other tool result cut for length, and an attached file that was cut, can be read on with
    the new `tools.read_more`.
- **The chat's pin** (top bar).
  - On, the default: the side panel follows you from tab to tab, and the chat keeps working on the
    tab its conversation started on. The page bar shows "Working on: …", with "Use this tab" to move
    the chat to the tab you are on.
  - Off: each tab has its own side panel and chat.
- **Message queue.** While the agent works, up to 3 messages can be queued and go in order when
  the turn ends. "Send now" stops the turn and sends a message at once.

### Changed
- Site templates are easier for the model to write:
  - the create-template skill warns about parentheses in conditions, and asks the model to keep to
    the page the user named;
  - Liquid errors such as "invalid range syntax" and "render limit exceeded" come with a hint;
  - the description of `browser.find_in_dom`'s `attr` makes clear that it matches attribute values,
    not names.
- The page bar's template chips list only the templates the chat's agent gets.

### Fixed
- Switching tabs no longer moves a working chat to the new tab, which lost the page and the site
  access it was using.
- Deleting the open conversation in History no longer brings it back when the panel is closed.
- A template whose output is one line longer than the limit is now cut inside the line, instead of
  coming back empty.
- The `mcp` e2e scenario no longer fails intermittently in the full run.
