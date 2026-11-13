# A tab's audio

The toolbar popup's **Tab's audio** line captures what a tab plays: a talk, a video call, a podcast. You can save it as a
file, read and correct its transcript next to the audio, or put the transcript in the chat. You keep hearing the tab
while it captures, and it goes on with the popup closed.

It needs the browser's tab capture and an offscreen document, which Firefox does not have: there the popup shows the
line greyed, with an **unavailable** mark and *Not available in this browser* (its switch in **Settings → Appearance →
Popup** hides it), and the tab in **Settings → Voice** says why ([what each version has](settings.md#what-each-version-has)).

## Starting it

- **From the toolbar button**: on the **Tab's audio** line, choose where it goes, then press **● Start**. Your choice is remembered:
  - **Then review** (the default): once stopped, the [review](#the-review) opens in a tab of its own.
  - **Then to the chat**: once stopped, the transcript goes to the message box of the chat for that tab.
  - **Audio only**: nothing is transcribed. The popup offers **Save** and **Discard**.
- **With a shortcut**: *Start or stop capturing the tab's audio* has no key until you set one on the browser's
  shortcuts page. A key set in **Settings → Shortcuts** does not work for this: the browser lets the extension capture
  a tab only after the toolbar button or a browser shortcut.

**Review** and **Chat** need an audio model: choose it in [Settings → Voice](voice.md#settings--voice).

While it captures, the toolbar icon shows its minutes in red, and a pill on the page shows *Audio · 0:42* with **Stop**
(on pages the extension may reach; you can drag it aside). To stop it, click **Stop** on the pill or in the popup, or
press the shortcut again. In **Settings → Voice** the pill can show more while it captures: the last lines transcribed,
or those and the sound's waves. It also stops when the tab closes or at **How long a tab's audio is captured** (60 minutes,
[Limits](limits.md)). One tab at a time: save or discard the last audio before capturing another.

## The transcript

The audio goes to your audio model in chunks of 30 seconds (5 to 30, in [Settings → Voice](voice.md#settings--voice)),
as it plays, each on its own. The model detects the language unless you set one under **A tab's audio → Language**
(dictation's **Language** does not apply here). Each chunk goes with the **Vocabulary** as its prompt, but not with
the text before it (with it, some models give no text at all), and with the **Temperature** if set. So when you stop,
only the last chunk is left. Chunks under the **Silence level** are not sent.

Some models repeat the prompt as the text of a chunk with music or noise and no speech: with a **Vocabulary**,
check the transcript of such parts with your provider, and empty the vocabulary if its words show up there. The transcript goes on with the popup and the
review closed: the popup shows *transcribing…*, then *2 failed* if any chunk failed.

A model that gives times (such as `whisper-1`) gets a line per stretch of speech. Any other (such as
`gpt-4o-transcribe`) gets a line per chunk, so the audio follows it chunk by chunk. Shorter chunks show the text sooner,
with more requests and more sentences cut in two.

## The review

**Review** in the popup opens it again. It has the audio to play and the transcript under it, with the line playing
marked:

- **Click a time** to play from there.
- **Click a line** to correct it. Empty a line to leave it out.
- **Retry** sends a chunk that failed again.
- **Send to chat** puts the transcript, with your corrections, in the message box of the chat for the captured tab (the
  one in this window, if that tab closed). It is not sent: you write your message around it. If no chat is open, a new
  one opens.
- **Copy text** copies it, each line after its time.
- **Save** downloads the audio as a `.webm` file, to the browser's downloads folder.
- **Discard** drops the audio and the transcript, after asking here.

## What the model gets

The transcript is sent as text that came from a page, in an `<untrusted_page_content>` block, each line after its time
(`[1:05]`). A stretch not transcribed says so in its place. Past **Transcript of a tab's audio sent with a message**
(20,000 characters, [Limits](limits.md)), it is cut with a note, and the model can read on. Both texts are in
**Settings → Prompt preview**.

The audio itself goes only to your audio model's provider, never to the chat model. The
[word blacklist](word-blacklist.md) does not apply to audio.

## What is kept

The audio and its transcript stay in memory until you discard them or capture another. They are lost if the browser
closes or the extension reloads, so save what you want to keep.

## If it goes wrong

- **The browser did not let the extension capture this tab**: click the toolbar button on that tab and try again. The
  browser's own pages cannot be captured.
- **This site is not enabled**: the extension has no access to the site, so it cannot show the pill there and does not
  send the site's audio to your provider. Allow it in **Settings → Website access**.
- **A key set in Settings → Shortcuts cannot capture a tab's audio**: the browser lets the extension capture a tab only
  after the toolbar button or a browser shortcut. Set the key on the browser's shortcuts page, or use the popup.
- **Nothing was said, though you heard it**: some sites protect their audio, and the browser gives silence instead.
- **A chunk failed**: the review says why, and **Retry** sends it again. A key or model problem fails them all: check
  Settings → Voice. Only the last 20 failed chunks keep their audio for Retry; an older one says so.
- **The model gave no text, though there is sound**: a chunk with sound came back empty. It can be music with no
  words; if someone speaks there, **Retry** sends it again.
- **Invented text in quiet parts**: speech-to-text models can do this with faint sound. Correct or empty those lines.
