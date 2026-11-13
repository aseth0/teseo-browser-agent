# Transcribe what a tab plays

Capture a tab's audio, correct its transcript while you listen, and ask the chat about it.

**Example:** a 20-minute talk on `talks.example.com`. You want its key points, and the quotes right.

## What you need

- An audio model in **Settings → Voice**, such as `whisper-1` from OpenAI or Groq's Whisper models.
- The page open, and able to play.

## What you do

1. On the talk's tab, click the toolbar button. On the **Tab's audio** line, choose **Then review** and press **● Start**. The popup closes.
2. Play the talk. You keep hearing it, and the icon counts the minutes.
3. When it ends, click **Stop** on the pill on the page, or in the popup.

## What you see

1. The review opens in a tab of its own, with the audio and the transcript under it.
2. Click a time to hear that part, and correct the lines that came out wrong.
3. Click **Send to chat**. The chat opens for the talk's tab, with a chip above the message box:
   *Audio of talks.example.com (20:14)*.
4. Write your message and send it:

> List the key points of this talk, and quote the speaker on each, with the time.

The answer cites the times, so you can check each quote in the review, which stays open.

## What you approve

Nothing is sent to the chat model until you send your message. The audio goes to your audio model's provider as it
plays, unless you choose **Audio only**.

## If it goes wrong

- **Choose an audio model**: the popup says so when none is set. Its **Settings** button opens the section.
- **A line says *Not transcribed***: click **Retry** on it.
- **You only want the file**: choose **Audio only**, then **Save** in the popup.
- **You do not need to correct anything**: choose **Chat**, and the transcript goes to the message box when you stop.

More details: [A tab's audio](../guide/tab-audio.md) · [Voice dictation](../guide/voice.md) ·
[Limits](../guide/limits.md).
