# Attachments

Add images, screenshots, text files and PDFs to a message.

## How to attach

- The paperclip, **Attach**, under the message box (behind **⋯** when the panel is narrow, see
  [The message box](chat.md#the-message-box)):
  - **File…**: one or several files.
  - **Web Screenshot** → **Take a full screenshot** (the visible part of the tab) or **Take a section screenshot**
    (drag a rectangle over the page; **Esc** cancels).
- **Paste** images, text files or PDFs into the message box.
- **Drop** files onto the message box.
- A [screenshot from the toolbar popup or a shortcut](#screenshots-from-the-popup-or-a-shortcut), without opening
  the chat first.
- A [recording of a page's requests](recordings.md#the-review), once you review it and click **Attach**: its chip
  says its calls, its site and its size as the model gets it.
- [A tab's audio](tab-audio.md), transcribed: its chip says its site and its length.

Each attachment shows as a chip above the box; hover it to see how it will be sent, and ✕ removes it.

## What can be attached

| Kind | Sent as | Limits |
|---|---|---|
| **Images** (any image type) | An image, shrunk to 1,568 px on its longest side if larger | 4 per message; files up to 20 MB |
| **Text files**: plain text, Markdown, CSV, JSON, XML, YAML, logs, HTML, CSS and source code (`.py`, `.js`, `.ts`, `.go`, `.java`, `.sql`, …) | Their text | 20,000 characters (cut past it, with a note); files up to 5 MB |
| **PDFs with text** | The text of their pages | Files up to 20 MB |
| **Scanned PDFs** (no text) | Images of their first pages, counted as images | Files up to 20 MB |

Anything else is refused. Password-protected or damaged PDFs are refused with a note. The per-message and size limits
can be changed in **Settings → [Limits](limits.md)**.

Screenshots work on the tab that is in front. If the browser refuses one, allowing access to all websites (or opening
the panel with the extension's icon) lets it.

While the agent is working, attachments stay in the box until you send the next message.

## Screenshots from the popup or a shortcut

The toolbar popup's **Screenshot** row, or a keyboard shortcut, takes a screenshot of the tab you are on and attaches
it to the chat's message box, not sent, ready to ask about:

| Button | Shortcut | Captures |
|---|---|---|
| **Section** | not set | A part of the page: drag a rectangle over it (**Esc** cancels) |
| **Visible** | **Alt+Shift+S** | The visible part of the page |
| **Full page** | not set | The whole page, top to bottom |

Set or change the keys on the browser's shortcuts page (**Settings → Shortcuts** → **Open the browser's shortcuts
page**), or give them keys of your own in **Settings → Shortcuts** ([keys set in Settings](chat-windows.md#keys-set-in-settings));
a screenshot from a key set there needs access to every site. The image
goes to the chat floating on that page if there is one; otherwise the side panel opens with it. The page widget's
bubble and floating chat are hidden while the page is captured. For **Visible** and **Full page** the side panel opens
first, and the page is captured as it then shows, next to the panel. **Section** is dragged on the page as it is, and
the side panel opens once it is captured; if the browser does not let it open by then (after a long drag, say), an
**Attach to chat** button shows by the section: click it to open the panel with the image. **Esc** or a click
elsewhere puts the button away; the image still waits for the chat for 10 minutes, whichever way you open it.

**Full page** cuts the page into parts of one screen each, one image per part, as many as a message takes (4 by
default, fewer when images are already attached); the box says how many parts were left out. With
[Chromium DevTools](devtools-engine.md) on, the page is captured in one go; otherwise it is scrolled a screen at a time
(about two screens a second) and scrolled back after, and what stays fixed on the page (a header, a cookie banner)
shows in every part.

If the page cannot be captured (a browser page, or the browser refuses), the box says why.

## In the saved conversation

Saved conversations keep attached images and PDFs by name only (no data); when you go on with such a conversation,
the model gets a note in their place.
