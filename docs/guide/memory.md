# Memory

**Memory** keeps notes across conversations: preferences, facts about a site, rules (*"prices in euros"*,
*"on tracker.example.com, the component field is mandatory"*). Manage it in **Settings → Memory** or from the
memory button in the side panel.

Each item has a text and a title (up to 80 characters). A new item the model saves needs a title; one of yours without
a title goes by its text's first line. Each item decides how it reaches the model:

| Item | Reaches the model |
|---|---|
| **Pinned** | Whole, with every request |
| **Linked to sites and pinned** | Whole, while one of those sites is open |
| **Linked to sites** | While one of those sites is open: whole if your message matches it, else as one line with its title, which the model reads when it needs it |
| Any other | As one line in an index (its title); the model reads it in full when it needs it |

- The model can search, read, save and delete items (`memory.*`); you review every save and confirm every delete. It
  is told to read the items whose title touches the task before acting, that your message wins over an item that
  conflicts with it, and to propose updating an item that covers or contradicts what it learned instead of adding
  another. In the chat, a call that names an item by id (read, update, delete) shows its title in the call's row and
  over its arguments.
- **Auto-attach** (off by default) attaches the items your message matches well enough, at a match level you set
  (Broad, Moderate, Precise, Strict).
- **Semantic search** (off by default) also matches items by meaning, with an embeddings model of one
  of your providers: a message about getting money back finds an item about returns.
- **Only those that match** (on by default, in [Settings → Auto-inject](chat.md#settings--auto-inject)) is what sends a
  site's items by title. Off, all of them go whole while the site is open. An agent without `memory.read` always gets
  them whole, as a title would be of no use to it.
- Items can belong to agents, be switched off, and be exported or imported as JSON.
- An agent's memory is *external* (shared with every agent) or *internal* (its alone).

## Settings → Memory

At the top, **Use memory** (on): off, neither the items nor the memory tools reach the model, and your items stay.
Under it, three figures: how many items there are (switched off, saved by the model), the **pinned** items for every
site against their limit (8,000 characters), and the **index of titles** against its own (4,000). A bar turns amber
past three quarters: past the limit, the rest of the index is left out with a note; the model's search still finds
those items, and a site's go with a later message. Then four tabs.

**Items**: **Search memory…**, **＋ New item**, **Select**, **Import ▾** and **Export ▾** ([Backups](settings.md#backups)).
A chip on each item says how it reaches the model, and the same chips over the list show only those of a kind, with
how many there are:

| Chip | |
|---|---|
| 📌 **Always** | Pinned, for every site: whole with every request |
| ◉ **On its sites** | Whole while one of its sites is open (pinned, or with *Only those that match* off) |
| ◎ **Site, if it matches** | While one of its sites is open: whole if your message matches it, else by its title |
| ≡ **By title** | One line in the index: the model reads it when it needs it |

Under its title, an item's sites (or *Every site*) and its agents; on the right, its pin and delete buttons. The
export holds whatever you or the model wrote, personal details too: keep the file private.

**Matching**: the three matches needed, side by side on cards, and under them a message to try them on.

- **Auto-attach** (off) attaches the items your message matches well enough, neither pinned nor linked to a site
  (those go anyway). Its match is 60% by default, with Broad, Moderate, Precise and Strict as quick choices; it also
  decides which items of the open site go whole, even with Auto-attach off. **At most, per message** is 2 (up to 5).
  **Also check the model's replies between its steps** (off) matches what the model writes before calling a tool
  too, and adds what matches after that tool's result.
- **Meaning needed**, for semantic search (its tab, below): set it by trying messages under the cards, as its scale
  changes from model to model. Dimmed while semantic search is off.
- **Model's search**: the least match the model's own `memory__search` results need. Off (the default): any item
  with one of the query's words is found. Raise it when the model's searches bring back too much that does not fit.

**Try a message**, under the cards, shows for a message as you would send it and **For** an agent how well each item
matches (with semantic search on, two meters, **Words** and **Meaning**, each with its own mark), its chip, and which
would be attached: moving a bar shows its effect at once. Under a message in the chat, a small memory pill says how
many went.

**Semantic search**: **Also match memory items by meaning** (off) uses an embeddings model of a provider you configured (OpenAI,
OpenRouter, Ollama and LM Studio document embeddings; not every provider has them). Choose the **Provider** and the
**Embeddings model** (those that look like one are listed first; any name can be typed), and press **Test**: the
switch waits for it, and shows the model's dimensions. The text of your items, and each message you send while it is
on, go to that provider; pinned items don't need it and stay out. With the [word blacklist](word-blacklist.md) on,
its terms are masked in all of that. Turning it on starts indexing, and the tab shows how far it went. An item passes
by its words **or** by its meaning. **Model prefixes** are for models that ask for one before a query or a document.
If the provider does not answer in time (2 seconds), the message goes by words only and the chat says so; changing
the model, the provider's address or an item embeds it again. When the model returns vectors of another length than
**Test** found (it was replaced under the same name), the indexing status says so: run **Test** again.

**Limits and texts**: **Pinned memory items, sent in full**, the **Memory index** (500 to 50,000) and **Memory
items for the open site sent in full** (20 per message), the same settings as in [Limits](limits.md); and the texts
the model gets, as in Prompt preview.

## Memory for the open site

Each item goes once while the model still sees it. With **Only those that match** on, for each message:

1. **Pinned** items go whole.
2. Items your **message matches** go whole, the best match first. The site's name in your message does not count, nor
   do an item's sites: what counts is its title and text, at **Match needed**.
3. The rest go as **one line**, their id and title, and the model opens one with `memory.read` if it needs it.

An item that went by title goes whole once a later message matches it. One the model saw whole and you edited since
goes whole again, even without a match. **Memory items for the open site sent in full** caps the first two levels:
those past it go by title for now and whole with a later message. A message with only attachments matches nothing, so
only the pinned go whole.

BM25 compares words, in any alphabet, not meanings: *"find cheap flights"* does not match *"the filters are in the side menu"*. That item
stays known to the model by its title, and it reads it if it may matter. If a rule must always apply on a site, pin it.
Items saved before this behaved as *whole on their site* are not pinned for you: pin those you want that way.

## The side panel's list

The memory button, next to the history's, lists the items: first those that go with the next message, whole or by
title (for the agent you talk to, on this page's site), then the rest. Search them, pin or unpin them, or delete them (once you confirm).
**Edit…** opens Settings → Memory to add or change items.
