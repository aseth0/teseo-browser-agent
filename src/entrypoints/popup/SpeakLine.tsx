// The toolbar popup's line while something is read aloud (background/speech-host): how far it is
// ("Reading 2 of 5") and Stop. Nothing while nothing is read: a reading starts from the side panel, the
// button beside a selection or the shortcut.
import { sendRuntime } from '../../core/runtime';
import { SPEAK_COMMAND, SPEAK_STOP, speakText } from '../../speech/protocol';
import { shortcutOf, type Shortcut } from '../../ui/shortcuts';
import { useSpeakStatus } from '../../ui/useSpeakStatus';
import { report } from './line';
import { PopupRow, StopButton } from './Row';

export function SpeakLine({ shortcuts }: { shortcuts: Shortcut[] }) {
  const status = useSpeakStatus();
  if (!status) return null;
  return (
    <PopupRow label="Read aloud" icon="audio" name="Reading aloud" live shortcut={shortcutOf(shortcuts, SPEAK_COMMAND)}
      actions={<StopButton name="Stop reading aloud" title="Stop reading aloud" onClick={() => void sendRuntime({ type: SPEAK_STOP }).catch(report)} />}>
      <span className="popup-row-sub">{speakText(status)}</span>
    </PopupRow>
  );
}
