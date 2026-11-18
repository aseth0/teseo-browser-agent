// The offscreen document's side of the floating chat's dictation (voice/protocol): on each port, one
// dictation as the side panel's (sidepanel/useDictation): the microphone Settings → Voice chose, a level
// meter, a recorder per chunk, each chunk transcribed and its text handed back in order. Stopped by the
// chat (its last chunks still go back); dropped when the port closes, the chat's frame gone: the
// microphone off, the requests aborted. The extension's own pages only, never a content script.
import { browser } from 'wxt/browser';
import { errorText } from '../core/errors';
import { isExtensionPage } from '../core/sender';
import { openMic } from './mic';
import { DICTATION_PORT, type DictationStart, type DictationToChat, type DictationToOffscreen } from './protocol';
import { chunkRecorder, levelMeter } from './recorder';
import { startSession, type Session } from './session';
import { dictationOptions, transcribe } from './transcribe';

const release = (stream: MediaStream) => stream.getTracks().forEach((t) => t.stop());
export const LEVEL_EVERY_MS = 200; // the sound level to the chat's strip, while it records

export function listenDictation(ask: (c: MediaStreamConstraints) => Promise<MediaStream> = (c) => navigator.mediaDevices.getUserMedia(c)) {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== DICTATION_PORT) return;
    if (!isExtensionPage(port.sender)) return port.disconnect();
    let session: Session | undefined;
    let begun = false;
    let gone = false;
    const requests = new AbortController();
    const tell = (m: DictationToChat) => {
      if (!gone) port.postMessage(m);
    };
    port.onDisconnect.addListener(() => {
      gone = true;
      requests.abort();
      session?.stop();
    });

    const begin = async (o: DictationStart) => {
      let stream: MediaStream;
      try {
        stream = await openMic(ask, o.deviceId);
      } catch (e) {
        return tell({ type: 'failed', name: (e as { name?: string } | null)?.name, error: errorText(e) });
      }
      // The chat went while the browser gave it: off at once.
      if (gone) return release(stream);
      const meter = levelMeter(stream);
      const levels = setInterval(() => tell({ type: 'level', level: meter.level() }), LEVEL_EVERY_MS);
      let out = 0;
      const sending = (by: number) => tell({ type: 'pending', count: (out += by) });
      session = startSession({
        chunkMs: o.chunkMs,
        record: () => chunkRecorder(stream),
        peak: meter.peak,
        send: (audio, tail) => {
          sending(1);
          return transcribe(o.provider, audio, dictationOptions(o, tail), requests.signal).finally(() => sending(-1));
        },
        silenceLevel: o.silenceLevel,
        silenceStopMs: o.silenceStopMs ?? Infinity,
        insert: (text) => tell({ type: 'text', text }),
        release: () => {
          clearInterval(levels);
          meter.close();
          release(stream);
        },
        onStopping: () => tell({ type: 'stopping' }),
        onEnd: (end) => tell({ type: 'end', end }),
      });
      tell({ type: 'started' });
    };

    port.onMessage.addListener((msg: DictationToOffscreen) => {
      if (msg?.type === 'stop') return session?.stop();
      if (msg?.type !== 'start' || begun) return;
      begun = true;
      void begin(msg);
    });
  });
}
