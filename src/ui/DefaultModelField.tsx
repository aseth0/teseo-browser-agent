// Settings → Providers' default model: one of the models its server lists (and the one chosen, listed
// or not), or another id typed; a text field while the list loads or when the server gives none.
import { useEffect, useRef, useState } from 'react';
import type { ProviderConfig } from '../storage/settings';
import type { ListedModels } from './useListedModels';

const ANOTHER = '\u0000another'; // the option that turns the list into a text field

// `listed`: the models its server lists (ui/useListedModels), asked by the provider's section.
export function DefaultModelField({ provider, listed, onChange }: { provider: ProviderConfig; listed: ListedModels; onChange: (model: string) => void }) {
  const ids = listed.status === 'ok' ? listed.ids : undefined;
  const [models, setModels] = useState(ids);
  const [typing, setTyping] = useState(false);
  // The list kept while the field has the focus (it would turn from a text field into a list, or
  // back, under the keys), shown when it leaves. While it is asked again, the one shown stays.
  const focused = useRef(false);
  const held = useRef<{ models?: string[] }>(undefined);
  useEffect(() => {
    if (listed.status === 'loading') return;
    if (focused.current) held.current = { models: ids };
    else setModels(ids);
  }, [listed.status, ids]);
  const focus = {
    onFocus: () => void (focused.current = true),
    onBlur: () => {
      focused.current = false;
      if (held.current) setModels(held.current.models);
      held.current = undefined;
    },
  };
  const value = provider.defaultModel;
  if (typing || !models?.length) return <input className="mono" value={value} placeholder="model id" autoFocus={typing} {...focus} onChange={(e) => onChange(e.target.value)} />;
  return (
    <select className="mono" value={value} {...focus} onChange={(e) => (e.target.value === ANOTHER ? setTyping(true) : onChange(e.target.value))}>
      {!value && <option value="" />}
      {[...new Set([...(value ? [value] : []), ...models])].map((m) => <option key={m} value={m}>{m}</option>)}
      <option value={ANOTHER}>Another model id…</option>
    </select>
  );
}
