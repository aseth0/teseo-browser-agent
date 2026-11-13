// A recording of the page's requests attached to the next message, as a chip with its size as the model
// gets it: reviewed again from it, or left out. Recordings start from the toolbar popup or a shortcut
// (background/recording-host).
import { useMemo } from 'react';
import { recordedCalls, type Recording } from '../../recording/recording';
import { recordingPreview } from '../../recording/block';
import { shortChars } from '../../recording/review';
import { Icon } from '../../ui/chat-icons';
import { Chip } from '../../ui/Chip';
import { plural } from '../../core/util';

export function RecordingChip({ recording, onReview, onRemove }: { recording: Recording; onReview: () => void; onRemove: () => void }) {
  const calls = recordedCalls(recording).length;
  const size = useMemo(() => recordingPreview(recording).size, [recording]);
  return (
    <div className="attachments">
      <Chip remove={{ label: 'Do not send the recording', title: 'Do not send it', onClick: onRemove }}>
        <button className="link-button" title="Review it again" onClick={onReview}>
          <Icon name="record" /> Recording · {plural(calls, 'call')} · {recording.site} · {shortChars(size)} chars
        </button>
      </Chip>
    </div>
  );
}
