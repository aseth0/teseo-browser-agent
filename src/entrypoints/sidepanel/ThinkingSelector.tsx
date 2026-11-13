// How much the current model reasons before answering, remembered per provider and model.
// "Default" sends nothing and leaves it to the server.
import { resolveThinkingParam, thinkingLevels, type ThinkingLevel } from '../../providers/thinking';
import type { ProviderConfig } from '../../storage/settings';
import { thinkingLevel, withThinkingLevel } from '../../storage/settings-select';
import { THINKING_ICON } from '../../ui/icons';
import { Popover } from '../../ui/Popover';
import { useSettingsContext } from '../../ui/settings-context';

const LABELS: Record<ThinkingLevel, string> = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };

interface Props {
  provider: ProviderConfig;
  model: string;
}

export function ThinkingSelector({ provider, model }: Props) {
  const { settings, update: onChange } = useSettingsContext();
  const param = resolveThinkingParam(provider.thinkingParam, provider.baseURL);
  const levels = thinkingLevels(param);
  const level = thinkingLevel(settings, provider.id, model);
  // On/off parameters show "On" for the level they send.
  const label = (l: ThinkingLevel) => (param === 'enable_thinking' && l !== 'off' ? 'On' : LABELS[l]);
  const select = (l: ThinkingLevel | undefined) => onChange((s) => withThinkingLevel(s, provider.id, model, l));

  const current = level ? label(level) : 'Default';

  if (!levels.length) return null; // the provider is set not to send a thinking setting
  return (
    <Popover title={`Thinking: ${current} (${model})`} label={<>{THINKING_ICON}<span className="thinking-level">{current}</span></>} className={level ? 'active' : undefined}>
      {(close) => (
        <div className="menu" role="menu" aria-label={`Thinking for ${model}`}>
          {([undefined, ...levels] as (ThinkingLevel | undefined)[]).map((l) => (
            <button key={l ?? 'default'} role="menuitemradio" aria-checked={l === level} className="menu-option"
              onClick={() => { select(l); close(); }}>
              {l ? label(l) : 'Default (the server decides)'}
            </button>
          ))}
          <p className="hint">Saved for {model}. How it is sent: Settings → Providers.</p>
        </div>
      )}
    </Popover>
  );
}
