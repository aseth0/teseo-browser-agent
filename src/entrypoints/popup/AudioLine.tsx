// The toolbar popup's Audio line (as the Screenshot and Record lines): the tab's audio captured
// (background/audio-host), the tab still heard, and where it goes once stopped (remembered): the review
// page, the chat, or the file only (not transcribed). While it captures: its time and Stop; once
// stopped: its length, how far its transcript is, Review, Save (its size in the title), which downloads
// it as a .webm file (the browser's downloads folder), and Discard. It goes on with the popup closed.
import type { Browser } from 'wxt/browser';
import { AUDIO_COMMAND, AUDIO_DISCARD, AUDIO_FILE, AUDIO_REVIEW, AUDIO_START, AUDIO_STOP, audioToOf, type AudioStatus, type AudioTo } from '../../audio/protocol';
import { sendRuntime } from '../../core/runtime';
import { isRestrictedUrl } from '../../page/permissions';
import type { Settings } from '../../storage/settings-types';
import { Icon } from '../../ui/chat-icons';
import { elapsed } from '../../ui/elapsed';
import { shortcutOf, withShortcut, type Shortcut } from '../../ui/shortcuts';
import { useAudioStatus } from '../../ui/useAudioStatus';
import type { SettingsUpdate } from '../../ui/useSettings';
import { report, started, useTicking, type Failed, type LineEnds } from './line';
import { PopupRow, StartButton, StopButton } from './Row';

const sizeText = (bytes: number) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`);

const DESTINATIONS: { to: AudioTo; name: string }[] = [
  { to: 'review', name: 'Then review' },
  { to: 'chat', name: 'Then to the chat' },
  { to: 'file', name: 'Audio only' },
];
const TO_TITLE: Record<AudioTo, string> = {
  review: 'Once stopped, review the audio and its transcript in a tab',
  chat: 'Once stopped, its transcript into the chat for this tab',
  file: 'Only the audio, kept to be saved: not transcribed',
};
// How far its transcript is, beside its length.
function progressText(s: AudioStatus): string {
  const p = s.progress;
  if (!p) return '';
  if (p.sending || !p.done) return 'transcribing…';
  if (p.failed) return `${p.failed} failed`;
  return s.sent ? 'in the chat' : '';
}

interface Props extends LineEnds {
  hidden?: boolean; // Settings → Appearance → Popup: only shown while busy
  tab?: Browser.tabs.Tab;
  settings?: Settings;
  update?: SettingsUpdate;
  shortcuts: Shortcut[];
}

export function AudioLine({ hidden, tab, settings, update, shortcuts, onDone, onError }: Props) {
  const status = useAudioStatus();
  useTicking(status?.state === 'capturing');

  if (status?.state === 'capturing') {
    return (
      <PopupRow label="Audio" icon="audio" name="Capturing the tab's audio" live
        actions={<StopButton name="Stop capturing the tab's audio" title="Stop capturing the tab's audio" onClick={() => void sendRuntime({ type: AUDIO_STOP }).catch(report)} />}>
        <span className="popup-row-sub">{elapsed(status.startedAt)}</span>
      </PopupRow>
    );
  }
  if (status?.state === 'stopped') {
    const state = progressText(status);
    const save = async () => {
      const file = await sendRuntime({ type: AUDIO_FILE });
      if (!file || 'error' in file) return onError(file?.error ?? 'The audio is not kept any more.');
      const a = document.createElement('a');
      a.href = file.url;
      a.download = file.name;
      a.click();
    };
    const saveTitle = `Save it as a .webm file${status.size ? ` (${sizeText(status.size)})` : ''}, in the browser's downloads`;
    const discard = () => void sendRuntime({ type: AUDIO_DISCARD }).catch(report);
    return (
      <PopupRow label="Audio" icon="audio" name="Tab's audio" actions={status.progress ? (
          <>
            <button className="icon-button" role="menuitem" aria-label="Discard the audio" title="Discard the audio and its transcript" onClick={discard}><Icon name="close" size={16} /></button>
            <button className="icon-button" role="menuitem" aria-label="Save the audio" title={saveTitle} onClick={() => void save().catch(report)}><Icon name="save" size={16} /></button>
            <button className="primary" role="menuitem" aria-label="Review the audio" title="The audio and its transcript, in a tab"
              onClick={() => onDone(sendRuntime({ type: AUDIO_REVIEW }))}>Review</button>
          </>
        ) : (
          <>
            <button role="menuitem" aria-label="Discard the audio" onClick={discard}>Discard</button>
            <button className="primary" role="menuitem" aria-label="Save the audio" title={saveTitle} onClick={() => void save().catch(report)}>
              <Icon name="save" size={14} /> Save
            </button>
          </>
        )}>
        <span className="popup-row-sub">{elapsed(status.startedAt, status.endedAt)}{state ? ` · ${state}` : ''}</span>
      </PopupRow>
    );
  }

  if (hidden) return null;
  const off = tab?.id === undefined || isRestrictedUrl(tab.url);
  const to = audioToOf(settings?.audioTo);
  const name = withShortcut("Capture the tab's audio", shortcutOf(shortcuts, AUDIO_COMMAND));
  const start = async (): Promise<Failed | undefined> => {
    if (tab?.id === undefined) return;
    const reply = await sendRuntime({ type: AUDIO_START, tabId: tab.id, windowId: tab.windowId, to });
    if (!reply) return { error: 'The extension did not answer.' };
    return 'error' in reply ? reply : undefined;
  };
  return (
    <PopupRow label="Audio" icon="audio" name="Tab's audio" shortcut={shortcutOf(shortcuts, AUDIO_COMMAND)}
      actions={<StartButton name={name} title={off ? 'The audio of pages like this one cannot be captured' : name} disabled={off} onClick={() => started(start(), { onDone, onError })} />}>
      <select className="popup-preset" aria-label="Where the audio goes" title={TO_TITLE[to]} value={to} disabled={!update} onChange={(e) => update?.({ audioTo: audioToOf(e.target.value) })}>
        {DESTINATIONS.map((d) => <option key={d.to} value={d.to}>{d.name}</option>)}
      </select>
    </PopupRow>
  );
}
