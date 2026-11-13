// Fields the Settings editors share (agents, actions, custom tools): a provider and model, an icon
// and name, the head of a tool parameter's row, and access the browser has not given yet.
import { onPermissionsChanged } from './permissions-changed';
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import type { ProviderConfig, Settings } from '../storage/settings';
import { useDismiss } from './MenuButton';
import { askOrigins } from './ask-permission';
import { pickerModels } from '../providers/registered-models';

// A provider of those set up (none: `none`, whose model it then uses) and, with one, its model (empty:
// the provider's default). `children`: more fields in the row.
export function ProviderModel(props: { providers: Settings['providers']; providerId?: string; model?: string; none: string; onChange: (change: { providerId?: string; model?: string }) => void; children?: ReactNode }) {
  const { providers, providerId, model, onChange } = props;
  const provider = providers.find((p) => p.id === providerId);
  return (
    <div className="row">
      <label>Provider
        <select value={providerId ?? ''} onChange={(e) => onChange({ providerId: e.target.value || undefined, ...(!e.target.value && { model: undefined }) })}>
          <option value="">{props.none}</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {providerId && (
        <label>Model
          <ModelIdInput provider={provider} className="mono" value={model ?? ''} placeholder={provider?.defaultModel || 'model id'}
            onChange={(e) => onChange({ model: e.target.value || undefined })} />
        </label>
      )}
      {props.children}
    </div>
  );
}

// A model id field suggesting `provider`'s default and registered models (Settings → Providers → Models
// in the picker), without asking its server: any other id can still be typed.
export function ModelIdInput({ provider, ...input }: { provider: ProviderConfig | undefined } & InputHTMLAttributes<HTMLInputElement>) {
  const models = provider ? pickerModels(provider) : [];
  const id = useId();
  return (
    <>
      <input {...input} list={models.length ? id : undefined} />
      {models.length > 0 && <datalist id={id}>{models.map((m) => <option key={m} value={m} />)}</datalist>}
    </>
  );
}

// An emoji for it (`iconFallback`: the one it shows without one; none: a block) and its name.
export function IconName(props: { icon?: string; name: string; nameLabel: string; namePlaceholder: string; iconFallback?: string; onChange: (change: { icon?: string; name?: string }) => void; children?: ReactNode }) {
  return (
    <div className="row">
      <div className="icon-field">
        <span>Icon</span>
        <IconPicker icon={props.icon} fallback={props.iconFallback} onChange={(icon) => props.onChange({ icon })} />
      </div>
      <label>{props.nameLabel}
        <input value={props.name} placeholder={props.namePlaceholder} onChange={(e) => props.onChange({ name: e.target.value })} />
      </label>
      {props.children /* more fields on the same line (an agent's provider and model) */}
    </div>
  );
}

// Icons to pick from; any other emoji can be typed or pasted.
const ICONS = ['🤖', '🛠️', '🔍', '📋', '📝', '📊', '📈', '🧭', '🌐', '🛒', '💬', '📧', '📅', '🗂️', '📁', '🎫', '🐞', '🧪', '🔧', '⚙️',
  '🔒', '🔑', '💡', '📚', '🧠', '⚡', '🚀', '🎯', '🧩', '🗺️', '🏷️', '💼', '🏦', '🧾', '📦', '🛰️', '🎨', '🎵', '🍳', '✈️'];

// The icon as a button (a block when there is none) that opens a grid of icons, a field for any
// other emoji, and "None".
export function IconPicker({ icon, fallback, onChange }: { icon?: string; fallback?: string; onChange: (icon: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const pick = (value: string | undefined) => {
    onChange(value);
    setOpen(false);
  };
  return (
    <div className="icon-picker" ref={ref}>
      <button type="button" className="icon-picker-button" title={icon ? 'Change the icon' : 'Choose an icon'} aria-label="Icon" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon || <span className="icon-picker-none" aria-hidden="true">{fallback || '▢'}</span>}
      </button>
      {open && (
        <div className="icon-picker-panel" role="dialog" aria-label="Choose an icon">
          <div className="icon-picker-grid">
            {ICONS.map((i) => (
              <button key={i} type="button" className={i === icon ? 'chosen' : undefined} aria-label={i} onClick={() => pick(i)}>{i}</button>
            ))}
          </div>
          <div className="row">
            <input className="narrow-input" placeholder="Other emoji" aria-label="Another emoji" value={icon && !ICONS.includes(icon) ? icon : ''}
              onChange={(e) => onChange(e.target.value.trim() || undefined)} />
            <button type="button" onClick={() => pick(undefined)}>None</button>
          </div>
        </div>
      )}
    </div>
  );
}

// A tool parameter's name and type, then what goes with them (how it is filled, its description).
export function ParamHead({ name, type, children }: { name: string; type?: string; children?: ReactNode }) {
  return (
    <div className="custom-param-head">
      <code>{name}</code>
      <span className="badge">{type ?? 'any'}</span>
      {children}
    </div>
  );
}

// The origins the browser does not let the extension reach yet, with Allow to ask for them (from the
// click, as permissions.request needs); nothing once it may reach them all. `say`: what not reaching
// them means, beside the button; without it the button says so when pointed at (`name`: what they are
// called there).
export function MissingAccess({ origins, say, name }: { origins: string[]; say?: (missing: string[]) => ReactNode; name?: string }) {
  const [missing, setMissing] = useState<string[]>([]);
  const key = origins.join('\n');
  // By the origins' content: the list is a new array on every render.
  // Again once access is given or taken away, here or in another page; a look begun before another
  // (or after this one is gone) is not shown.
  useEffect(() => {
    let latest = 0;
    let live = true;
    const check = async () => {
      const mine = ++latest;
      const out: string[] = [];
      for (const o of key.split('\n').filter(Boolean)) if (!(await browser.permissions.contains({ origins: [o] }).catch(() => false))) out.push(o);
      if (live && mine === latest) setMissing(out);
    };
    void check();
    const off = onPermissionsChanged(() => void check());
    return () => {
      live = false;
      off();
    };
  }, [key]);
  if (!missing.length) return null;
  const allow = () => askOrigins(...missing); // given: the permissions' change looks again
  const button = <button title={say ? undefined : `The browser does not let the extension reach ${name ?? missing.join(', ')} yet`} onClick={() => void allow()}>Allow</button>;
  if (!say) return button;
  return (
    <div className="row">
      <span className="status">{say(missing)}</span>
      {button}
    </div>
  );
}
