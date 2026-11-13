// The toolbar popup's Requests line (its group still "Record"): a recording of the tab's requests
// with a preset, in this tab or, on the DevTools engine, several tabs or tabs and mouse
// (background/recording-host). While it records: its count, its time and Stop; once stopped and no chat
// took it: Discard and Review. Stop and Review open the chat for the recorded tab inside the click.
import { useState } from 'react';
import type { Browser } from 'wxt/browser';
import { sendRuntime } from '../../core/runtime';
import { isRestrictedUrl } from '../../page/permissions';
import type { CaptureMode } from '../../recording/devtools';
import { DEFAULT_PRESET_ID, presetFor, presetsOf } from '../../recording/presets';
import { RECORDING_DISCARD, RECORDING_REVIEW, RECORDING_START, RECORDING_STOP } from '../../recording/protocol';
import { RECORDING_COMMAND } from '../../recording/recorder-protocol';
import { devtoolsOn } from '../../storage/settings-select';
import type { Settings } from '../../storage/settings-types';
import { Icon, type ChatIconName } from '../../ui/chat-icons';
import { elapsed } from '../../ui/elapsed';
import { plural } from '../../core/util';
import { shortcutOf, withShortcut, type Shortcut } from '../../ui/shortcuts';
import { useRecordingStatus } from '../../ui/useRecordingStatus';
import { report, started, useTicking, type Failed, type LineEnds } from './line';
import { PopupRow, StartButton, StopButton } from './Row';

const MODES: { mode: CaptureMode; icon: ChatIconName; name: string }[] = [
  { mode: 'tab', icon: 'recordTab', name: 'This tab' },
  { mode: 'tabs', icon: 'recordTabs', name: 'Several tabs' },
  { mode: 'tabs-mouse', icon: 'recordMouse', name: 'Tabs and mouse' },
];

interface Props extends LineEnds {
  hidden?: boolean; // Settings → Appearance → Popup: only shown while busy
  tab?: Browser.tabs.Tab;
  settings?: Settings;
  shortcuts: Shortcut[];
}

export function RecordLine({ hidden, tab, settings, shortcuts, onDone, onError }: Props) {
  const status = useRecordingStatus();
  const [preset, setPreset] = useState<string>();
  useTicking(status?.state === 'recording');
  // The one waiting, in the chat for this tab.
  const review = () => (tab?.id === undefined ? Promise.resolve() : sendRuntime({ type: RECORDING_REVIEW, tabId: tab.id, windowId: tab.windowId }));

  if (status?.state === 'recording') {
    return (
      <PopupRow label="Record" icon="requests" name="Recording requests" live
        actions={<StopButton name="Stop recording" title="Stop recording and review what it caught" onClick={() => onDone(sendRuntime({ type: RECORDING_STOP }))} />}>
        <span className="popup-row-sub">{plural(status.calls, 'call')} · {elapsed(status.startedAt)}</span>
      </PopupRow>
    );
  }
  if (status?.state === 'stopped') {
    return (
      <PopupRow label="Record" icon="requests" name="Requests recorded" actions={<>
        <button role="menuitem" aria-label="Discard the recording" onClick={() => void sendRuntime({ type: RECORDING_DISCARD }).catch(report)}>Discard</button>
        <button className="primary" role="menuitem" aria-label="Review the recording" onClick={() => onDone(review())}>Review</button>
      </>}>
        <span className="popup-row-sub">{plural(status.calls, 'call')}{status.leftOut ? ` · ${status.leftOut} left out` : ''}</span>
      </PopupRow>
    );
  }

  if (hidden) return null;
  const all = settings ? presetsOf(settings) : [];
  const chosen = preset ?? (settings ? presetFor(settings).id : DEFAULT_PRESET_ID);
  const off = tab?.id === undefined || isRestrictedUrl(tab.url);
  const start = async (mode: CaptureMode): Promise<Failed | undefined> => {
    if (tab?.id === undefined) return;
    const reply = await sendRuntime({ type: RECORDING_START, tabId: tab.id, windowId: tab.windowId, mode, presetId: chosen });
    if (reply && 'waiting' in reply) return void (await review());
    return reply && 'error' in reply ? reply : undefined;
  };
  const modes = settings && devtoolsOn(settings) ? MODES : MODES.slice(0, 1);
  const titleOf = (mode: CaptureMode, name: string) => (off ? 'Pages like this one cannot be recorded' : mode === 'tab' ? withShortcut(name, shortcutOf(shortcuts, RECORDING_COMMAND)) : name);
  return (
    <PopupRow label="Record" icon="requests" name="Requests" shortcut={shortcutOf(shortcuts, RECORDING_COMMAND)} actions={<>
      {/* On the DevTools engine, also several tabs, and tabs and mouse, as icons before Start (this tab). */}
      {modes.slice(1).map(({ mode, icon, name }) => (
        <button key={mode} className="icon-button" role="menuitem" aria-label={name} title={titleOf(mode, name)} disabled={off} onClick={() => started(start(mode), { onDone, onError })}>
          <Icon name={icon} size={16} />
        </button>
      ))}
      <StartButton name={withShortcut('This tab', shortcutOf(shortcuts, RECORDING_COMMAND))} title={titleOf('tab', 'Record this tab')} disabled={off} onClick={() => started(start('tab'), { onDone, onError })} />
    </>}>
      {all.length > 0 && (
        <select className="popup-preset" aria-label="Preset" title="What the recording keeps (Settings → Recording)" value={chosen} onChange={(e) => setPreset(e.target.value)}>
          {all.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
    </PopupRow>
  );
}
