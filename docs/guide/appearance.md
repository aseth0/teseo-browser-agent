# Appearance

**Settings → Appearance** sets how the chat looks. Beside the options is the side panel itself, with an example
conversation on an invented page: nothing is sent to a model. Its buttons work and change your real settings: the
view menu (**Show the chat as**) and the page button, the only one there that changes what the model receives.

Over it, five figures: the **Theme** with its mode and whether the accent is yours, the **Text** size and font, how
the **Steps** show, how **Layers** starts, and how much of the **Popup** shows. The options are on five tabs, **Chat**,
**Theme**, **Fonts**, **Layers** and **Popup**, each a list of rows with the choices on the right. Which mentions work in the message box is in
[Settings → Auto-inject → Mentions](chat.md#settings--auto-inject).

## Chat

| Option | What it does |
|---|---|
| **Text size** | The messages and the message box, from 90% to 175% of the default. The side panel's text size menu offers four of these sizes. |
| **Steps between your message and the answer** | *Grouped* (the default): reasoning and tool calls go in collapsible blocks, and what the model writes stays in view. *Inline*: each step as it comes, to follow a run closely. |
| **Reasoning** | *Collapsed* (the default) is open while the model thinks and folds afterwards; *Expanded* stays open; *Hidden* leaves it out of the chat and the turn diagrams. |
| **Tool calls** | *Collapsed* (the default), *Expanded*, with their result, or *Compact*, one line each, for long runs. |
| **Auto-scroll** | *Always* follow new text (the default), or *Only at the end*, so you can read above while an answer streams. The preview does not show it. |

Which tools the wrench menu shows is set with the eye in **Settings → Tools**. What each tool call and answer shows
is in [Settings → Display](#display).

## Theme

- **Mode**: System (the default), Light or Dark.
- **Themes**: Default, Ocean, Forest, Grape, Rose, Flexoki and High contrast, each a card with a small chat in its
  colors, light on the left and dark on the right: its **bold**, *italic* and `code`, and some of its Layers highlight
  colors under its name. Choosing one sets its accent, its text colors, its highlight colors and its palette; the
  mode and the fonts stay as you chose them. Bold follows the theme's accent; each theme has an italic and a code
  color to go with it, and its own colors for what things are (a tool, the model, a page, what the extension knows:
  the bars of the texts sent to the model, the tags of the tools). The *Only when* tags, what changes things and the
  background of your messages follow the accent.

**Your changes** go over the theme:

- **Accent**: the color of buttons, headings and list markers, and of bold unless you set one. **Reset** goes back
  to the theme's own.
- **Text colors**: **Bold**, **Italic** and **Code**, in light and dark alike. A color that would not read on the
  background is darkened (or lightened) until it does. **Reset** goes back to the theme's own.

### Your themes

**Save as theme…** keeps the current appearance under a name; your themes are listed under the built-in ones. A
theme you save also keeps the mode, the fonts, the [bubble's look](page-widget.md#bubble-look) and [its actions'](page-widget.md#actions-look), and choosing it
later sets them too. Saving under the name of one of your themes asks before replacing it; the built-in names are taken. Up to
50 themes; × in a card's corner deletes one, once you confirm.

- **Import** (*From file…* or *From JSON…*) adds the themes to yours without applying them: choose one to use it. A
  theme of the same name is replaced.
- **Export** (*To file…* or *To JSON (copy)*) gives the current appearance as one theme; **All your themes to file…**
  exports every theme you saved.

## Fonts

Fonts installed on your computer: nothing is downloaded.

- **Text**: System (the default), Serif, Rounded, Humanist or Monospace, each a card with a sample.
- **Code**: System mono (the default), Menlo, SF Mono or Courier; the sample `{0O1l}` tells zero from O and one from l.
- **Another installed font**: the name of one on your computer, for text, for code or both. It goes before the
  choice above, which shows when it is missing. A name has only letters, digits, spaces, dots and dashes.
- **Where**: *Everywhere* (the default: the side panel, Settings and the chat floating on a page) or *Only the
  messages* of the chat.

A theme you save keeps the fonts; the built-in themes leave them as you chose.

## Layers

How the [Layers](layers.md#layers) view starts, and its colors:

| Option | What it does |
|---|---|
| **Every message's layers start shown** | Off by default: each message's layers open without clicking its chip. |
| **Start with the highlights on** | On by default: Layers colors each part by where it comes from. |

**Highlight colors** has a color for each origin, *From the web* and *From the extension* (the highlight is the color
with transparency, in light and dark). Each changed one has a **Reset**, and **Reset all** goes back to the defaults.
A theme sets them too.

## Popup

What the [toolbar button's popup](chat-windows.md) shows. On this tab the preview beside the options is the popup
itself, which follows each switch (nothing in it can be clicked). Everything shows by default.

| Group | Switches |
|---|---|
| **This site** | **Site access**: the line saying the tab's site is not enabled, with **Enable it** ([Where the chat opens](chat-windows.md)) |
| **Open the chat** | **Page**, **Panel**, **Full screen**: one per tile; the others share the width |
| **Into the chat** | **Screenshot** and, under it, **Section**, **Visible**, **Full page**; **Tab's audio**; **Requests** |
| **Agents** | **Agents Panel** |
| **Details** | **Shortcuts** (the keys under the tiles and beside the names) and **Block titles** (off: a more compact popup) |

A block with nothing left shows nothing, not even its title. **Settings** (the gear) always shows, so the popup can
always bring you back here. A hidden **Tab's audio** or **Requests** still shows while it captures or records, or
while what it caught waits for review, so it can be stopped. What the popup gains in a later version shows until you
hide it here.

## Diagrams

**Show the chat as → Diagrams** draws each turn above its answer, in a **Turn diagram** box: open for the latest
turn, folded for older ones, with the turn's thoughts, tool calls, agents and errors counted on its line. The steps
themselves are folded under it, in **Steps**.

**Draw this turn as** chooses the diagram:

| Choice | Draws |
|---|---|
| **Sequence** | You, the agent, its tools and the agents it asked |
| **Flow** | Each step as a box, top to bottom |
| **Mind map** | Thoughts, tools by group and agents |
| **Timeline** | The model calls, and what ran between them |
| **Tokens** | The tokens of each model call, in and out |

The choice is remembered for the next turns. Sequence, Flow and Mind map are drawn as the turn runs.

**Mermaid blocks.** While answers show as Markdown, a ` ```mermaid ` block in one is drawn as a diagram. **Diagram** / **Code**
switches to its code, and the corner button copies the code. A kind of diagram that cannot be drawn shows its code,
with a line saying why. Diagrams never show links or images.

**Zoom.** A drawn diagram starts as wide as the chat (**Fit**). **−** and **+** zoom from 25% to 300%, scrolling when it
is larger; the last button fits it to the width again.

**Jira markup**, in the same menu, shows answers as Jira markup to paste in an issue or a comment; copying an
answer copies it that way.

## Display

**Settings → Display** sets what the chat shows of each tool call and under each answer. It changes only what you
see: the model gets the same. Beside the options is the side panel itself with the example conversation, as in
Appearance, and the calls and answers already in a chat change at once too. Each option starts as the chat looked
before it could be changed.

**Tool calls**

| Option | What it does |
|---|---|
| **Arguments** | *JSON* (the default): what the model sent, as it sent it. *Fields*: a name and its value each, as on a confirmation card; text as it is, anything else as JSON. |
| **Result shown first as** | *Text* (the default) or *JSON*, for a result that holds JSON; its **Text \| JSON** switch still changes it. |
| **Screenshot thumbnail** | The small image in the row of a call that returned one. Hidden, the result still shows it. |
| **Tab chip** | The title of the tab the call ran on, as it was then. |
| **Memory item title** | The title of the memory item a memory call reads, changes or deletes. |
| **Auto-attached pills** | What went to the model on its own after the call (memory, bookmarks, the plan), as pills in its row. |
| **Sub-agent or script steps** | What another agent or a script tool did inside the call: open while it works, then *Closed when done* (the default) or *Left open*. |

**Under the answer**

| Option | What it does |
|---|---|
| **Agent** | The agent that gave the answer (none for Browser). |
| **Tokens and time** | The turn's tokens and response time, at the end of the row. |

**Always shown**: these cannot be hidden, as they say something you must see. The **“from the web · untrusted”**
mark on a result read from a page, a server or a site; **errors**; the **cut mark** (✂) of a result cut to a size
limit; and the **DevTools** badge of a call that ran on the [DevTools engine](devtools-engine.md).

The options travel with the settings in an export. A value another build of the extension saved that this one does
not have shows as the default.
