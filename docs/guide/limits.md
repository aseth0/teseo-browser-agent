# Limits

**Settings → Limits** has every limit on what can reach the model in one part of a request, and what happens
past it. Four figures say how many limits there are (and how many are fixed), how many you **Changed**, and the
current **Page block** and **Tool result**. Then a tab for each kind:

- **With your message**: the page block, what is attached (images, files, recordings, a tab's audio, saved
  conversations, `::site` mentions);
- **What the model reads**: tool results and what the browser tools and WebMCP return;
- **Memory, skills and texts**: the memory index and items, About you, site skills and templates, the text sent to
  be summarized;
- **Time and runs**: waiting on a page, tab watches, the Agents Panel, waiting on the model, script tools.

Each limit is a card: its value, its field and range, what happens past it (✂), and links to the sections that show
it at their top. The filter finds a limit in every tab by name or by what happens past it; **Changed** and **Fixed**
show only those.

Each Settings section also shows the limits that apply to it at its top, with the same fields: a value changed
there is the one changed here (see [Settings reference](settings.md#the-top-of-a-section)).

Where a message was cut to a limit, the chat says so with ✂ (on the tool call, the template chip, the context
meter), and so does [Layers](layers.md). Fields elsewhere in Settings that have a limit show it as ✂ and its value;
hovering says what happens past it.

## Changing a limit

Type a new value in its field. A changed limit's card is marked with the accent and shows:

- ↺, which puts it back to the default, and the default under the field;
- **uses N** under the field when the value you typed is outside its range: the nearest end of the range is used.

Only the limits with a range can be changed or reset; the three fixed ones say *fixed*.

## Limits you can change

| Limit | Default | Range | Past it | When to change it |
|---|---|---|---|---|
| **Page block** | 1,500 tokens | 500–20,000 | Filled by priority (page details, then selected text, then visible elements): the first part that does not fit is cut, the rest left out with a note | Raise it when the model misses what is on long pages; lower it to send less with every message |
| **Site template output** | 4,000 characters | 500–50,000 | Cut at whole lines; the note says how many were left out | Raise it when a [template](site-templates.md)'s data is cut |
| **Site skill value** | 2,000 characters | 200–20,000 | Cut, with a note (lists: whole records, then how many more) | Raise it when a site [skill](skills.md)'s page values are cut |
| **Saved conversation attached (# or auto)** | 6,000 characters | 1,000–50,000 | Its transcript is cut, with a note | Raise it to give the model more of an [earlier conversation](history.md) |
| **Memory index (in the system prompt, and the one for the open site)** | 4,000 characters | 500–50,000 | The rest of the index is left out, with a note (`memory.search` still finds them; those of the open site go with a later message); the items sent in full are never cut | Raise it when you keep many [memory](memory.md) items |
| **Images attached to a message** | 4 images | 1–10 | The rest are not attached (the message box says so) | Raise it if your model takes more images per request |
| **Attached image, longest side** | 1,568 pixels | 512–4,096 | Made smaller (and sent as JPEG) before it goes | Lower it to save context; raise it for small text in images |
| **Tool result** | 8,000 characters | 2,000–200,000 | Cut, with a note (the model can read on with `tools.read_more`) | Raise it for a model with a large context window; lower it to save context |
| **Recording of requests sent with a message** | 30,000 characters | 5,000–200,000 | The calls that do not fit go without their bodies, with a note | Raise it when a [recording](recordings.md)'s bodies are left out |
| **Attached file (Attach → File…)** | 20,000 characters | 2,000–200,000 | Cut, with a note | Raise it for long [attachments](attachments.md) |
| **Transcript of a tab's audio sent with a message** | 20,000 characters | 2,000–200,000 | Cut, with a note (the model can read on) | Raise it for long [audio](tab-audio.md); 20,000 characters is about 25 minutes of speech |
| **How long a tab's audio is captured** | 60 minutes | 1–240 | The capture stops, as with Stop | Raise it for long [audio](tab-audio.md), which is kept in memory until you save or discard it |
| **Waiting on a page (browser.wait_for)** | 120 seconds | 10–600 | It stops waiting and says what has not happened | Raise it for pages that take long (a long answer being written) |
| **Tab watches running at once (browser.watch)** | 5 watches | 1–20 | A new one is refused | Raise it to [watch](tab-watches.md) more tabs at once |
| **Agents a conversation starts in the Agents Panel (panel.start)** | 3 agents | 1–10 | A new one is refused until one of its rows is removed | Raise it to let an agent of the [Agents Panel](agent-manager.md#agents-that-start-agents) hand out more work at once |
| **Times the agents it started wake a conversation of the Agents Panel, until you write** | 5 notices | 0–20 | The next notice waits for your next message (0: never woken) | Lower it to keep an [orchestrating agent](agent-manager.md#agents-that-start-agents) from going on by itself; raise it for long hand-outs |
| **Waiting for a model's answer to start** | 120 seconds | 30–900 | The request is given up with an error | Raise it for a slow local model, or a long prompt it reads before answering |
| **Silence in the middle of a model's answer** | 60 seconds | 15–600 | The request is given up with an error | Raise it for a model that thinks a long time between parts of its answer |
| **Text read aloud at a time (Speak)** | 20,000 characters | 500–200,000 | The rest is not read, and the pill says so | Raise it to have [Speak](speak.md) read longer texts in one go: each piece is a request to the voice's server |
| **Time of a script tool** | 30 seconds | 5–300 | The script stops with an error | Raise it for a [script](custom-tools.md#a-script) whose requests are slow |
| **Steps of a script tool (tool())** | 30 steps | 1–100 | The script stops with an error | Raise it for a [script](custom-tools.md#a-script) that calls many tools |
| **Time of a script tool that calls tools** | 300 seconds | 30–1,800 | The script stops with an error | Raise it for a slow script |
| **Screenshot (browser__screenshot), longest side** · ctx | 1,568 pixels | 512–4,096 | Made smaller before it goes | Lower it to save context; raise it when the model cannot read small text |
| **Page text a call may ask for (browser__get_page_text maxChars)** · ctx | 50,000 characters | 5,000–500,000 | A larger `maxChars` comes to this | Raise it to let the model read long pages at once; also bounds `web.read` |
| **Conversation sent to be summarized (Compaction)** · ctx | 60,000 characters | 5,000–500,000 | Its oldest part is left out | Raise it when the summarizing model has a large window |
| **Pinned memory items, sent in full** · ctx | 8,000 characters | 500–50,000 | The pinned items that do not fit go in the memory index instead (`memory.read` reads them) | Raise it when you pin many items |
| **Memory items for the open site sent in full, per message** · ctx | 20 items | 1–200 | The rest go by title, and whole with a later message | Raise it when a site has many items |
| **About you (where {{about_user}} is)** | 4,000 characters | 500–20,000 | The end is cut, with a note | Raise it for a long [About you](prompt.md) |
| **How long a tab watch runs (browser.watch)** | 60 minutes | 1–720 | It ends, and you are told | Raise it for a watch that waits for hours |
| **Tool calls between plan reminders (since the model last showed its plan)** | 8 tool calls | 2–50 | The model is sent its [plan](user-tools.md) with the steps left, to check it still follows it | Lower it when the model loses track of its plan in long tasks |
| **Tool calls between plan reminders, even after updates (0: off)** | 20 tool calls | 0–100 | The model is sent its plan, even if it updated it meanwhile | Lower it when the model ticks steps off without following the plan; 0 turns it off |
| **Visible elements read from the page** | 300 elements | 50–2,000 | The rest are left out, with a note | Raise it for long pages whose elements the model misses; the page block's size still applies |
| **Elements read by browser__read_page** | 800 elements | 100–5,000 | The rest are left out, with a note | Raise it for pages with many controls |
| **Selected text** | 4,000 characters | 500–50,000 | Cut, with a note | Raise it to send longer selections |
| **Records of a site skill list** | 100 records | 10–1,000 | The rest are not read | Raise it together with **Site skill value**, which cuts the list first |
| **::site mentions per message** | 3 mentions | 1–10 | The rest are not read (the message box warns) | Raise it to mention more [sites](site-templates.md) at once |
| **Page text (browser__get_page_text)** | 7,000 characters | 2,000–100,000 | Cut, with a note (the model can ask for another size) | The size read when the model asks for none; never more than **Page text a call may ask for**. Also for `web.read` |
| **Page text for a page widget action ({{page}})** | 10,000 characters | 2,000–100,000 | Cut, with a note | What a [page widget action](page-widget.md#values-from-the-page) reads as `{{page}}`. Its other values from the page, and the selection it takes, are cut to 1,000 characters, which cannot be changed |
| **Structured data (browser__get_structured_data)** | 15,000 characters | 2,000–200,000 | Cut, with a note | Raise it for pages with a lot of JSON-LD |
| **Matches listed by browser__find_in_dom** | 20 elements | 5–200 | The rest are counted, not listed | Raise it for lists the model reads with selectors |
| **WebMCP tools a page can offer** | 25 tools | 1–25 | The rest are not offered | Lower it to let [websites](webmcp.md) add fewer tools to each request; it cannot be raised |
| **WebMCP tool result** | 20,000 characters | 2,000–200,000 | Cut, with a note | Raise it for a website tool with long answers |

The page block is counted in estimated tokens, the same for every model.

A tool's answer is also cut at **Tool result**. Where **Page text**, **Page text a call may ask for**, **Structured
data** or **WebMCP tool result** is set above it, the row says so: the tool result limit cuts first, and the model
reads the rest with `tools.read_more`.

## Fixed limits

| Limit | Value | Past it | Why it is fixed |
|---|---|---|---|
| **Nested {% render %} in site templates** | 3 levels | The template fails with an error | It is checked when a template is saved: a lower value would break templates saved already |
| **WebMCP tool description** | 1,000 characters | Cut | The website writes it, and it goes to the model with the tool definitions |
| **WebMCP tool parameters (JSON schema)** | 4,000 characters | The tool is offered without parameters | The same: written by the website, sent outside any untrusted block |

## A busy or failing server

When the model's server answers 429 (busy) or a 5xx error, the request is asked again, up to twice, before anything
of the answer is shown: after the time its `Retry-After` header says (at most 30 seconds), or else after 1 second,
then 2. If it then answers, the chat notes it once (*the server answered 429, asked again.*); if not, the turn fails
with the server's error. The two waiting limits above apply to each request, not to the waits between them.

## Rounds of tool calls

A turn lets the model call tools for at most 15 rounds without answering. It then stops, and the chat says
**Stopped after 15 rounds of tool calls without an answer.** with **Continue**, which lets it go on for as many
rounds again. An agent asked by another stops the same way, and you are asked whether it may go on. This limit is
not in **Settings → Limits**.
