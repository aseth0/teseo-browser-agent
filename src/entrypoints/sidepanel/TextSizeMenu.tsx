// The top bar's text size: four sizes for the messages and the message box, the same setting as
// Settings → Appearance → Chat (which has more).
import { Icon } from '../../ui/chat-icons';
import { Popover } from '../../ui/Popover';
import type { Settings } from '../../storage/settings';
import type { SettingsUpdate } from '../../ui/useSettings';

const SIZES: [percent: number, name: string][] = [[90, 'Small'], [100, 'Normal'], [125, 'Large'], [150, 'Extra large']];

export function TextSizeMenu({ settings, onChange }: { settings: Settings; onChange: SettingsUpdate }) {
  const size = settings.chatView?.textSize ?? 100;
  const name = SIZES.find(([p]) => p === size)?.[1] ?? `${size}%`;
  const set = (textSize: number) => onChange((s) => ({ ...s, chatView: { ...s.chatView, textSize } }));
  return (
    <Popover title={`Text size: ${name}`} label={<Icon name="textSize" size={16} />}>
      {(close) => (
        <div className="menu" role="menu" aria-label="Text size">
          {SIZES.map(([percent, label]) => (
            <button key={percent} role="menuitemradio" aria-checked={percent === size} className="menu-option" onClick={() => { set(percent); close(); }}>
              <span className="text-size-sample" style={{ fontSize: `${(13 * percent) / 100}px` }}>Aa</span> {label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
