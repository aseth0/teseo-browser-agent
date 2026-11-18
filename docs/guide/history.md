# Saved conversations

Conversations are saved in the browser after every turn, with the page content they carried (screenshots are not
kept). While a turn runs, it is saved as it goes, each time a message is added: closing the panel mid-turn keeps
what was done so far, marked as stopped. In **Settings → History**:

- **Save conversations** (on), and what the side panel does when it opens: start a new conversation (default), or go
  on with the last one if it was touched in the last 30 minutes;
- retention: delete after *N* days untouched, keep at most *N* conversations (pinned ones are never deleted, nor
  one open in another chat or an Agents Panel row: it is deleted at a later save, once closed);
- **Export all (JSON)**, **Import…**, **Delete all**.

The history panel searches conversations (ranked with BM25, `"a phrase"` in quotes; words in any alphabet, and Chinese, Japanese or Thai cut into words), and pins, renames, exports or
deletes them. `[text](https://…)` in a title shows as a link in the panel; the model gets the title as written. `#conversation-name` in a message attaches one, and **auto-attach** (off by default) attaches those
your message matches. The model can search and read them too (`history.*`).

Searches rank from a small search document kept beside each conversation (`src/history/search-doc.ts`,
`src/history/search.ts`): it is built when the conversation is saved, rebuilt by a search that finds it missing (a
conversation imported or saved by an older version), and never exported. A query with a `"quoted phrase"` still reads
the conversations in full. The history panel shows a snippet for the best 20 matches; the others are listed by title.

## Settings → History

At the top, **Save conversations** (on); under it, three figures: how many are saved (and pinned), the space they
take, and how long they are kept. Then its tabs:

- **Conversations**: the saved ones, latest first, with their agents, messages and last change. Search them by title,
  show only the **📌 Pinned** ones or those of **This week**, pin one, or delete it once you confirm. They open from
  the side panel's history.
- **Saving**: what the side panel does when it opens; **Delete after (days untouched)** and **Keep at most
  (conversations)**, saved once you leave the field (when the new value would delete conversations now, it says how
  many first: **Delete them** applies it, **Undo** leaves the setting as it was; [importing settings](settings.md#export-and-import)
  with such a retention asks first too); **Export all (JSON)**, **Import…** and **Delete all**.
- **Matching**: **Auto-attach** (off) on its card attaches the saved conversations your message matches well enough,
  each cut to its limit in **Settings → Limits**. Its match is 60% by default (Broad, Moderate, Precise and Strict are
  quick choices; words of your message no saved conversation has count too, each half as much as a rare one), **At most, per message** is 1 (up to 3), and **Among** chooses *All saved conversations* (the
  default) or only the *Pinned conversations*: pin the few you want the model to draw on, and nothing else is
  attached by surprise. Under the card, **Try a message** shows for a message as you would send it how well each
  conversation matches and which would be attached. Under a message in the chat, a small clock pill says how many
  went.
- **Limits and texts**: **Saved conversation attached** (6,000 characters), the same value as in
  [Limits](limits.md); the `#conversation` mention and the texts the model gets.

## The history panel

The clock button in the top bar opens the saved conversations: pinned ones first, then by when they were last
touched; while you search, the best matches first. Click one to go on with it. One open in another chat now does not
open here: *In the Agents Panel* shows its row there instead, *Open in another chat* is left as it is (go on with it
there). The Agents Panel icon marks those [started in the Agents Panel](agent-manager.md#its-history). On each:

- **Pin**: listed first, never deleted by the retention, and searched in full (reasoning and tool arguments too);
- **Rename**;
- **MD** exports it as Markdown, to read or share; **{}** as JSON, with everything, to bring it back with
  **Import…** in Settings → History;
- **✕** deletes it, once you confirm.

**Select** picks several (or all) to **Delete selected**; **Done** ends it. **Auto-attach: …** shows the same
auto-attach settings as Settings → History, without the search to try.

## Temporary conversations

The hourglass in the top bar, **Temporary conversation**, starts conversations that are **not saved** in the history;
a banner says so while it is on. Turning it on or off starts a new conversation, so nothing is saved halfway. It turns
off by itself when you open a saved conversation. A temporary conversation cannot be moved between the side panel and
the page, since the other chat would save it. The button shows only while saving conversations is on.
