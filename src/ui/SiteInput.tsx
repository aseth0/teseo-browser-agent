// A site to add, typed in a field (Enter or its button adds it), and why it was not added.
import { useState } from 'react';
import { isEnter } from './enter';

// `add` adds the site typed, or says why not (also once a permission it asks for is answered).
export function useSiteInput(add: (draft: string) => string | undefined | Promise<string | undefined>) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const submit = () => {
    setError('');
    const done = (problem: string | undefined) => (problem ? setError(problem) : setDraft(''));
    const added = add(draft); // at once, inside the click: a permission is asked only then
    return added instanceof Promise ? added.then(done) : done(added);
  };
  return { draft, setDraft, error, submit };
}

export function SiteInput({ site, placeholder, label }: { site: ReturnType<typeof useSiteInput>; placeholder: string; label?: string }) {
  const { draft, setDraft, error, submit } = site;
  return (
    <div className="row">
      <input value={draft} placeholder={placeholder} aria-label={label}
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => isEnter(e) && draft.trim() && void submit()} />
      <button onClick={() => void submit()} disabled={!draft.trim()}>Add site</button>
      {error && <span className="status">{error}</span>}
    </div>
  );
}
