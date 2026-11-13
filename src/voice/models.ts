// Settings → Voice's model list: the ones whose names look like speech-to-text first.
const AUDIO_LOOKING = /whisper|transcri|audio|speech|stt/i;

export const rankAudioModels = (ids: string[]): string[] => [...ids.filter((id) => AUDIO_LOOKING.test(id)), ...ids.filter((id) => !AUDIO_LOOKING.test(id))];
