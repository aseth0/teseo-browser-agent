import { storageGet } from '../storage/area';
import { watchKey } from '../storage/watch';
import { useLive } from './useLive';

// A value in storage.session, read once and followed as the background changes it: a recording's
// status (useRecordingStatus), a tab's audio (useAudioStatus). None: nothing there.
export function useSessionValue<T>(key: string): T | undefined {
  return useLive<T | undefined>(
    () => storageGet<T>('session', key),
    (set) => watchKey('session', key, (c) => set(c.newValue as T | undefined)),
    undefined,
    `[${key}]`,
    key,
  );
}
