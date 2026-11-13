# Speak

Teseo can read text aloud: an answer in the chat, or text you select on a page. It reads with a text-to-speech model
of one of your providers, through its OpenAI-compatible `/audio/speech` endpoint, and keeps reading while you change
tab or close the side panel.

Add a voice profile in **Settings → Speak** to choose the voice. Without one, the system's voice reads (the voices
your operating system and browser offer, with no provider): plainer, and the same for every agent. **Settings → Speak
→ Reading → System voice** turns that off; nothing is read then until you add a profile.

## Reading something aloud

- **An answer**: the 🔊 button under each answer, beside Copy, reads it with the voice of the agent that gave it.
  Its Markdown marks are not read, nor its code blocks.
- **Your selection, from the side panel**: the 🔊 button beside the selection chip in the page bar reads the text you
  selected, with the active agent's voice.
- **Your selection, on the page**: on sites where the [page widget](page-widget.md)'s bubble shows, a small 🔊 button
  appears under the text you select. If the page shows its own menu over your selection, the button moves to another
  corner. Where the bubble is hidden, there is no button either. **Settings → Speak → Reading → Button beside a
  selection** turns it off. Actions marked to show there join it as a small toolbar
  ([Beside the selected text](page-widget.md#beside-the-selected-text)).
- **A box of a page widget action's card**: the 🔊 beside Copy reads that box, with the action's voice: its own
  profile, else its agent's ([Reading a box aloud](page-widget.md#reading-a-box-aloud)). **Settings → Speak → Reading
  → Button on action boxes** turns it off. An action may also have its boxes read on their own, as soon as its card
  shows them (its editor's **Reading aloud**).
- **An answer, on its own**: as it is written, where **Settings → Speak → Reading → Answers read on their own** says
  ([below](#answers-read-on-their-own)).
- **With a shortcut**: *Read the selected text aloud, or stop reading* has no key until you set one, on the browser's
  shortcuts page or in **Settings → Shortcuts**. It reads the selection of the tab you are on, on any page the browser
  lets the extension script; pressed while something is being read, it stops it.
- **The agent, on its own**: an agent with **Speaks on its own** switched on (in its editor, **Settings → Agents**) is
  offered the tool `speech.say`, and reads a text aloud with its voice when it chooses to, for example when you ask it
  to say something. It only makes sound: it is never confirmed.

One reading at a time: one you start (a 🔊, the selection's button, the shortcut, Test, `speech.say`) replaces the
one in progress. One read on its own (an answer as its turn ends, an action's boxes as its card shows them) waits its
turn instead, and is read once the readings before it end; one you start empties that queue, and so does Stop. If
the voice server fails halfway, the readings that wait are dropped too.

While it reads, a pill on the page says *Preparing…* or *Reading 2 of 5* (and *· 2 more waiting* when readings wait their turn), with **Stop** (on pages the extension may
reach; you can drag it aside), and the toolbar popup shows a *Reading aloud* line with **Stop**. The button that
started it turns into **Stop** too. If the voice server fails halfway, the reading stops and a notification says why.

## Settings → Speak

The section has a switch for the whole feature, and three tabs.

### Voice profiles

A profile is a voice you can switch to: its **name**, a **provider** and its **model**, the **voice** as the server
names it, a **speed** (0.25 to 4; 1 is the voice's own) and its **reading rules** (see [Reading](#reading)): *As
Speak's default*, *None*, or a language. A Spanish voice and an English one can each have their own, so the English
one does not say *1 punto 15*. A profile that has its own rules shows them in its row of the list. There is no list of voices to choose from: type the name
your server uses. Some servers take a blend of two voices, such as `voice_a+voice_b`, as one name.

- **＋ New profile** adds one; **Duplicate** copies the one shown; **Delete** asks first, in the page.
- **Use by default** makes it the default profile: the one used where nothing else says which (the first profile until
  you choose one).
- **Test** reads a sample text (you can change it) with the profile as it is set, its reading rules included. If the server refuses, its answer
  shows under it: a server that does not know a voice usually answers with the list of the voices it has.

#### Exporting and importing profiles

Above the list, **Select**, **Import ▾** and **Export ▾** work as in the other lists
([Backups](settings.md#backups)), for the voice profiles alone: the rest of Speak's settings is not touched.

- **Export ▾** downloads `voice-profiles.json` or copies it, with all the profiles or those you tick after
  **Select** (or **Choose which…**): `{ "voiceProfiles": [ { "name", "providerId", "model", "voice", "speed",
  "language" } ] }`. A profile names its provider by id, as an agent does; no key goes in the file (the provider's
  key is the provider's, and the providers travel in [Export and import](settings.md#export-and-import)).
- **Import ▾** reads **From file…**, **Paste JSON…** or **From URL…** and shows each profile first: new, replacing
  yours of the same name, or left out, with why (no name, no voice, a speed that is not a number, a name twice).
  Tick those to take and click **Import N**. They are added to your profiles; one that replaces yours keeps its
  place, so the agents and the default that chose it still do. The default profile does not change. A speed out of
  bounds comes in bounded (0.25 to 4). A profile whose provider is not among yours comes in without one: its row in
  the list says *choose its provider*. A file of Settings → Export and import is read too: its Speak profiles.
- The paste box also takes a plain list, one profile per entry, `Name=voice@speed`, apart by commas, semicolons or new
  lines; the speed is optional:

  ```
  Reader=voice_a@1.15, Blend=voice_a+voice_b@1.2
  Plain=voice_c
  ```

  A list names no provider nor model: the preview asks for one provider and one model, for all of its profiles
  (without a provider, they come in to choose it later). They come in with the reading rules *None*. An entry that is
  not `Name=voice`, a speed that is not a number, and a name already in the list are left out.

Which voice reads what:

| What | Voice |
|---|---|
| An answer | The profile of the agent that gave it (**Voice** in its editor), else the default |
| A box of a page widget action | The action's own profile (its editor's **Reading aloud**), else its agent's, else the default |
| A selection (panel, page, shortcut) | The active agent's profile, else the default |
| `speech.say` | The profile of the agent calling it, else the default |

Each agent, Browser included, has a **Voice** section in its editor: the profile its answers are read with, and the
**Speaks on its own** switch, off by default.

### Reading

| Setting | Default |
|---|---|
| **First piece** | 120 characters (40 to 2,000) |
| **Other pieces** | 300 characters (40 to 2,000) |
| **Default reading rules** | As dictation: the **Language** of [Settings → Voice](voice.md#settings--voice); or *None*, or a language |
| **Pronunciations** | None. One per line, `written = said`, such as `example.test = example dot test` |
| **Button beside a selection** | On |
| **Button on action boxes** | On: a 🔊 on each box of text of a [page widget action](page-widget.md#reading-a-box-aloud)'s card |
| **System voice** | On: without a voice profile, the system's voice reads, in the language of the default reading rules |
| **Answers read on their own** | Off, in each place: see below |

The text is never sent all at once: a model running on a CPU would take long before saying anything. It goes a piece
at a time, whole sentences while they fit; the first piece is short, so the voice starts at once, and the next one is
asked for while the first plays. A sentence longer than a piece is cut at a comma, a colon or a closing bracket, and
the pause the model leaves at the end of every clip is cut there, so the voice goes on as after a comma.

A text longer than **Text read aloud at a time** ([Limits](limits.md), 20,000 characters unless you change it) is
read up to the end of its last whole sentence that fits, and the pill says that only its start is read: each piece
is a request to the voice's server, and a whole page selected by mistake would be hundreds.

**Reading rules** say how numbers and units are read. With Spanish, `0,26 s` is read as *0 coma 26 segundos*,
`1.15` as *1 punto 15* and `1.000.000` as *1000000*. English and languages without rules are read as written. Your
pronunciations apply first, whatever the language.

The rules that apply are those of the profile that reads, wherever the reading starts (an answer, a selection, the
shortcut, `speech.say`, Test). A profile set to *As Speak's default* uses **Default reading rules** here, and that
one, set to *As dictation*, the language of Settings → Voice.

### Answers read on their own

Each answer of the chat can be read aloud as it is written, with the voice of the agent that gave it, set apart for
each place the chat is:

| Setting | Default | |
|---|---|---|
| **Floating chat on a page** | Off | The chat floating on a page ([Chat windows](chat-windows.md)) |
| **Side panel** | Off | The side panel, and the chat open in a tab |
| **Agents Panel** | Off | *The chat shown*: only the answers of the chat whose row is selected; *Every chat, one after another*: those of every row, also those working out of sight ([Agents Panel](agent-manager.md)) |

The voice starts while the answer streams, as soon as its first piece is complete: **First piece** characters, or
fewer once the sentence being written would not fit in it. Each next piece is sent once nothing more can join it; a
sentence still being written is never read, so what is said never changes. An answer shorter than that is read
whole once its turn ends. What is read is what the answer's 🔊 reads: without its Markdown marks or code blocks.

The text the model writes before calling a tool is read too, if it grew long enough to start before the call; a
shorter one is not. A turn you stop: what is being read goes on to its last whole sentence. One that failed is not
read. It waits for the reading in progress to end, as above; a reading that waits takes the text as it grows, and
starts with all of it. If a text stops growing without ending (its chat closed), what is complete of it is read once
it has not grown for a minute. While it streams, the answer's 🔊 does not show Stop: the pill and the popup do.

No click is needed for the sound: it plays in the extension's offscreen document, or through the system's voice, not
in the page. What does need one is the voice provider's site, the first time: a reading on its own cannot ask for
it, so an answer's 🔊 (or a box's note) says why nothing was read; click it once to grant it.

### Shortcut

The reading shortcut, as in **Settings → Shortcuts**.

## What is sent, and where

Only the text being read goes, a piece at a time, to the provider of the voice profile, with the profile's model,
voice and speed, and the provider's key and headers (its extra body does not go). Nothing goes to the chat model. The
[word blacklist](word-blacklist.md) does not apply to text read aloud. The provider's site needs the extension's
access, as any provider's: **Test** and the panel's buttons ask for it; the shortcut, the page's button and
`speech.say` cannot ask, and say so.

The audio plays in the extension's offscreen document, the same one that holds [a tab's audio](tab-audio.md); reading
never interrupts a tab's audio being captured. Speak and the system voice are not available in Firefox, which has no
offscreen documents: there **Settings → Speak** stays in the menu with an **unavailable** mark and says so, and an
agent's voice shows greyed in its editor, as does `speech.say` in **Settings → Tools**, never offered there ([what each version has](settings.md#what-each-version-has)).

Voice profiles travel in the settings part of an [export](settings.md#export-and-import), each naming its provider as
the providers' part does and with its reading rules; an agent's voice travels with the agent. Importing that part
replaces all of your profiles at once; to add some, use Speak's own Import (above).
