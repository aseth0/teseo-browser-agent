# Word blacklist

**Settings → Word blacklist** replaces terms with placeholders before anything is sent to the model (a client's
name → `CLIENT_A`), and puts them back in its answers and tool calls. It covers the system prompt, your messages,
the history, tool calls and results, sub-agents, summaries and the page widget.

- Matching is whole-word and ignores case and accents.
- It can apply always, or only with some providers and models, or on some pages: then it turns on in a chat once
  the chat's provider and model, a page the chat opened or the page it is on match, and stays on unless you turn it
  off with [its chip](#in-the-chat).
- **Hide images from the model** replaces screenshots and images while it is on.
- Saved conversations keep the real terms; they are masked again on every request.
- Voice transcription is not masked.

## Settings

**Settings → Word blacklist** has the layout of the other sections: **Use the blacklist**, beside its title,
switches it on or off without losing your terms. Four figures say how many **Terms** there are (and how many to
check), **With** which providers, **On** which pages, and whether **Images** are sent. Then three tabs:

**Terms**

- Each row is a **Real term** and what it is **Sent as**; **＋ Add term** adds one at the top, ✕ removes one. The
  filter box finds them by term or replacement; **Import…** and **Export** are beside it (see below). Two terms with
  the same replacement, or a replacement that contains another term, are errors: nothing is saved until you fix them.
- **⚠** next to a replacement means it looks like an ordinary word (letters only). When the model uses that word in
  its own sense, putting the term back would replace it by mistake: prefer a placeholder such as `CLIENT_A`.

**Where it applies**

- **Providers and models**: switch a provider on to apply it there; its box takes a comma-separated list of model
  ids (empty: any of its models).
- **Pages**: one URL pattern per line, such as `*.example.com`.
- **While it is on**: **Hide images from the model** sends screenshots and attached images as a short note.

**Try it** shows a text as the model would get it, masked the same way as a request, with each placeholder marked
and a chip for each term replaced. Nothing is sent.

It applies when the chat's provider and model are ticked, or when a page matches. Leave both empty to always apply.
Use them to mask only what goes to an outside provider, or only while you work on a client's site.
What goes to the provider of [Semantic search](memory.md#settings--memory) is always masked while the blacklist is on,
whatever these say: an item indexed there belongs to no chat for them to apply to.

## In the chat

While the blacklist is enabled and has terms, the [page bar](chat.md#the-page-bar) shows a chip for it, and a click
turns it on or off for this chat only:

- **Word blacklist**: it is on. A click turns it off; once something was masked, the chip asks first, since the model
  would then get the whole conversation with the real terms.
- **Word blacklist: off**: it does not apply yet. A click turns it on.

Your choice lasts while the chat stays open.

## Export and import

**Export** saves the terms to `word-blacklist.json`. **Import…** reads that file, or a table of two columns
(the term, then its replacement) saved as CSV, TSV or TXT: separated by commas, semicolons or tabs, with or without
a *Term, Replacement* header row. Imported terms are added to the list; a term already there takes the file's
replacement. The file holds the real terms in plain text: keep it somewhere safe.
