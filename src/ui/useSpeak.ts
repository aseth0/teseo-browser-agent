// A button that reads a text aloud and, while that text is read, stops it (the side panel's, Settings →
// Speak's Test): the provider's site asked for inside the click when it is not granted yet, then the
// background asked to read it (background/speech-host). What went wrong, until the next click.
import { useCallback } from 'react';
import { sendRuntime } from '../core/runtime';
import { SPEAK_STOP, SPEAK_TEXT, type SpeakKey, type SpeechMessage } from '../speech/protocol';
import { allowSite } from './ask-permission';
import { useAttempt } from './useAttempt';
import { useSpeakStatus } from './useSpeakStatus';

export type SpeakAsk = Omit<Extract<SpeechMessage, { type: typeof SPEAK_TEXT }>, 'type' | 'key'>;

export function useSpeak() {
  const status = useSpeakStatus();
  const { failed, setFailed, attempt } = useAttempt();
  const speaking = useCallback((key: SpeakKey) => status?.key === key, [status]);
  // `providerUrl`: the base URL of the provider that will read it, asked for now if need be.
  const toggle = useCallback((key: SpeakKey, ask: SpeakAsk, providerUrl: string | undefined) => {
    if (speaking(key)) return attempt(sendRuntime({ type: SPEAK_STOP }));
    attempt(
      (async () => {
        if (providerUrl) await allowSite(providerUrl);
        const r = await sendRuntime({ type: SPEAK_TEXT, ...ask, key });
        if (!r) throw new Error('The extension did not answer.');
        if ('error' in r) throw new Error(r.error);
      })(),
    );
  }, [speaking, attempt]);
  return { status, speaking, toggle, failed, setFailed };
}
