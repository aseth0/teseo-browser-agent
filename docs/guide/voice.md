# Voice dictation

The 🎤 button under the message box dictates into it: speak, and the text appears at the caret. Nothing is sent to
the chat model until you send the message, so you can correct it first.

- **Dictate** starts; **Stop dictating** stops (it also stops when you send, change conversation or the agent
  manager hides the chat).
- While it records, the message box is framed in red, with a strip inside it: the time, the sound's waves, the words
  just transcribed (or *…* while a piece is being transcribed) and **Stop**. The text comes a piece at a time (every
  **Chunk length** seconds), not word by word. Once stopped, the strip says *Finishing dictation…* in amber while the
  last piece is transcribed.
- The first time, the browser asks for the microphone. If it is blocked, **Allow microphone** opens a page to grant
  it once.
- In the chat floating on a page, the extension records in the background, with the microphone you allowed it, on any
  site, even one that keeps the microphone from its frames; the site is not asked. Folding or closing the chat, leaving
  the page or closing the tab stops it.

## Settings → Voice

Three figures say which **Audio model** transcribes, the **Microphone** and language, and the **Chunks** of dictation and
of a tab's audio. The tabs **Dictation** and **A tab's audio** hold the settings below; **Shortcut and limits** has a
tab's audio shortcut and limits.

| Setting | Default |
|---|---|
| **Audio model** | A provider and a speech-to-text model (those are listed first; any name can be typed) |
| **Microphone** | The browser's default |
| **Language** | Detected; or an ISO-639-1 code such as `en` or `es` |
| **Chunk length (seconds)** | 3 (0.5 to 30) |
| **Vocabulary** | Empty; names, acronyms and terms the model should spell right, up to 300 characters |
| **Temperature** | Empty: not sent (the server's default); 0 to 1 |
| **Silence level** | 0.01; a chunk whose loudest sound is under it is not sent (0 to 0.1; 0 sends every chunk, and dictation still stops after silence under 0.01) |
| **Stop after silence (seconds)** | 60 (10 to 600; 0: never) |
| **A tab's audio: while it is captured, the page shows** | The time and Stop; or the transcript too; or the transcript and the sound's waves too |
| **A tab's audio: chunk length (seconds)** | 30 (5 to 30, by fives) |
| **A tab's audio: language** | Detected; or a 2 or 3 letter code (anything else is not sent, and says so) |

Audio is sent in chunks to the provider's `/audio/transcriptions` endpoint (OpenAI-compatible). Each chunk's `prompt`
is the **Vocabulary**, then the last 200 characters transcribed so far, to keep it consistent. The vocabulary goes
first because Whisper-style models read only the end of a long prompt (about 224 tokens): the words before the cut
must be there. 300 + 200 characters usually stay within it; a long list of names and acronyms, or a language other
than English, takes more tokens, and then the model drops the start of the vocabulary. Put the words that matter
most at the end.

The **Vocabulary**, temperature and the rest of Voice's settings travel with the settings exported in [Export and
import](settings.md#export-and-import); the microphone does not. The [word blacklist](word-blacklist.md) does not apply to audio.

A setting left empty is not sent, so a server that does not take it is not bothered. When a server refuses one (a
`temperature` it does not support, a language it does not know), dictation stops with the server's own words.

### Test

**Test** records five seconds from the chosen microphone, sends them as dictation would send its first chunk (model,
language, vocabulary, temperature), or, with **A tab's audio** chosen beside it, as a tab's audio chunk (its own
language), and shows the text, or what the server said when it refused. Try a tab's audio settings here before a long
capture: a language or temperature the server refuses makes every chunk of it fail. It also shows the loudest level
heard (*not measured* when the browser gives no level): set **Silence level** below what you hear when you speak,
and above the level of the room. Leaving the tab or the page stops it, and nothing is sent.

**Settings → Voice** is in the **Audio** group of Settings, beside **Speak**, which reads text aloud: see [Speak](speak.md).
Speak's reading rules follow the **Language** set here unless you choose others there.

The same model transcribes [a tab's audio](tab-audio.md), with its own language, detected unless you set one under
**A tab's audio** (**Language** under Dictation is the one you dictate in; a page may speak any other). It also gets
the vocabulary, temperature and silence level. Its shortcut and limits are in **Shortcut and limits**.
