# Bookmarks

Teseo can search, list, save and delete your bookmarks, within a folder you choose. Everything is off
until you allow it.

## Allowing bookmarks

The **Allowed** switch at the top of **Settings → Bookmarks** (or **Allow bookmarks…** in its **Folder** tab) asks the
browser for the bookmarks permission (an optional permission: the browser asks only from that click). Switched off,
it removes it. Under it, three figures: the folder the model sees, how many bookmarks are in it, and auto-attach.

**Folder the extension sees**, in the **Folder** tab, limits what the model sees and where it saves:

- **All bookmarks** (the default): the bookmarks bar, Other bookmarks and mobile bookmarks.
- **One folder**: the model sees, searches and saves only inside it, with paths starting there. It does not learn
  the rest of your bookmarks.
- **Use a "Teseo" folder** creates (or reuses) a `Teseo` folder in Other bookmarks and selects it.

If the chosen folder is deleted, the tools stop working until you choose another; they never fall back to all
bookmarks.

## What the model can do

| Tool | | Confirmed |
|---|---|---|
| `bookmarks.search` | Searches titles, URLs and folders (words in any alphabet match words that begin with them; `"a phrase"` must appear as written); up to 20 results | No |
| `bookmarks.list` | Lists a folder's bookmarks and subfolders | No |
| `bookmarks.save` | Saves a bookmark: by default the page open in the chat, into the chosen folder (Other bookmarks with *All bookmarks*) | Every time |
| `bookmarks.delete` | Deletes a bookmark or an empty folder | Every time |

## Mentioning a bookmark

Type `b::` and the bookmark's title in lowercase with dashes (suggestions list them) to attach its title, URL and
folder to your message. The **Mentions and texts** tab says so, with the texts the model gets.

## Auto-attach

**Auto-attach**, on its card in the **Matching** tab (off by default), adds matching bookmarks to a message without a
mention:

- **Match needed**: the share of your message's words a bookmark covers, rarer words weighing more. 60% by default;
  presets Broad, Moderate, Precise and Strict. Words count whole, unlike a search: *"lem"* in a message does not
  match *"Lemon pie"*.
- **At most, per message**: 1 by default (up to 3).
- **Also check the model's replies between its steps** (off): matches what the model writes before a tool call too.
- **Try a message**, under the card, shows for a message as you would send it how well each bookmark matches and
  which would be attached: moving the bar shows its effect at once.

Each bookmark is attached at most once per conversation, and a pill under your message lists those attached.

## The bookmarks panel

The bookmarks button in the side panel opens a panel to search your bookmarks, browse folders, open one in a new tab,
bookmark **This page**, or delete one (after a confirmation in the panel).
