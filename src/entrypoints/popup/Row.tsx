// A line of the popup's "Into the chat" block (Screenshot, Tab's audio, Requests): its icon, its name
// (and its key, and a line or a choice under it), and its buttons on the right.
import type { ReactNode } from 'react';
import { Icon, type ChatIconName } from '../../ui/chat-icons';

export function PopupRow({ label, icon, name, shortcut, live, off, children, actions }: {
  label: string; // of the group, as tests and screen readers find it
  icon: ChatIconName;
  name: ReactNode;
  shortcut?: string;
  live?: boolean; // running: its name in the accent, with a dot that blinks
  off?: boolean; // a line this build lacks (core/build): greyed, its reason under its name
  children?: ReactNode; // under its name
  actions: ReactNode;
}) {
  return (
    <div className={`popup-row${live ? ' live' : ''}${off ? ' off' : ''}`} role="group" aria-label={label} aria-disabled={off || undefined}>
      <Icon name={icon} size={16} />
      <div className="popup-row-main">
        <span className="popup-row-name">
          {live && <span className="popup-live-dot" aria-hidden="true" />}
          {name}
          {shortcut && <kbd>{shortcut}</kbd>}
        </span>
        {children}
      </div>
      <div className="popup-row-acts">{actions}</div>
    </div>
  );
}

// A button that starts something: a red dot and "Start", its full name for screen readers.
export const StartButton = ({ name, title, disabled, onClick }: { name: string; title: string; disabled?: boolean; onClick: () => void }) => (
  <button className="popup-start" role="menuitem" aria-label={name} title={title} disabled={disabled} onClick={onClick}>
    <span className="popup-rec-dot" aria-hidden="true" /> Start
  </button>
);

// Stop, filled with the accent, while it runs.
export const StopButton = ({ name, title, onClick }: { name: string; title: string; onClick: () => void }) => (
  <button className="popup-stop" role="menuitem" aria-label={name} title={title} onClick={onClick}>
    <Icon name="stop" size={12} /> Stop
  </button>
);
