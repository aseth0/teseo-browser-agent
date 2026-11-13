// The recording this chat reviews: the background records a tab's requests (background/recording-host,
// started and stopped from the toolbar popup, the page's pill or a shortcut) and, once it stops, hands
// it to this chat (useHandoff), which reviews it and attaches it to the next message.
import { useState } from 'react';
import { RECORDING_HANDOFF, RECORDING_WAIT_MS, isRecordingPayload } from '../../recording/recorder-protocol';
import type { Recording } from '../../recording/recording';
import { useRecordingStatus } from '../../ui/useRecordingStatus';
import { useHandoff } from './useHandoff';

export function useRecording() {
  const status = useRecordingStatus();
  const [recording, setRecording] = useState<Recording>(); // the one this chat reviews
  // One stopped while this chat reviews another waits, and the review says so; it comes once that ends.
  // It waits RECORDING_WAIT_MS, longer than a screenshot does.
  useHandoff(RECORDING_HANDOFF, isRecordingPayload, { waitMs: RECORDING_WAIT_MS, hold: !!recording, tag: 'recording-handoff' }, (h) => setRecording(h.payload.recording));
  const anotherWaits = !!recording && status?.state === 'stopped' && status.startedAt !== recording.startedAt;

  // Reviewed (kept for the next message by the caller) or thrown away: it leaves the review.
  const discard = () => setRecording(undefined);
  const review = (r: Recording) => setRecording(r);

  return { recording, anotherWaits, setRecording, discard, review };
}
