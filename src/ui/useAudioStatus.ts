import { AUDIO_STATUS, type AudioStatus } from '../audio/protocol';
import { useSessionValue } from './useSessionValue';

// The tab's audio being captured or kept (background/audio-host), for the toolbar popup's Audio line and
// its review page. None: nothing is.
export const useAudioStatus = () => useSessionValue<AudioStatus>(AUDIO_STATUS);
