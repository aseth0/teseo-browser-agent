import { SPEAK_STATUS, type SpeakStatus } from '../speech/protocol';
import { useSessionValue } from './useSessionValue';

// The reading aloud in progress (background/speech-host), for the popup's line, the side panel's speak
// buttons and Settings → Speak's Test. None: nothing is read.
export const useSpeakStatus = () => useSessionValue<SpeakStatus>(SPEAK_STATUS);
