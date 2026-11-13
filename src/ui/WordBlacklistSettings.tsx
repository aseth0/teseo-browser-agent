// Settings → Word blacklist: the terms swapped for placeholders before anything reaches the model, and
// when that applies (word-blacklist/core). Saved as it is edited, kept apart from the settings
// (word-blacklist/store): the terms only while no error says otherwise. Many terms stay in a box of
// their own, with a filter; they go to and come from a file (word-blacklist/io).
import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../storage/settings';
import { blocksSaving, compileBlacklist, entryIssues, usableEntries, type BlacklistConfig, type BlacklistEntry, type BlacklistTarget, type EntryIssue } from '../word-blacklist/core';
import { loadBlacklistConfig, loadBlacklistEntries, onBlacklistChanged, saveBlacklistConfig, saveBlacklistEntries } from '../word-blacklist/store';
import { exportBlacklist, mergeEntries, parseBlacklistFile } from '../word-blacklist/io';
import { FilterBox, Switch, useFilter } from './Collection';
import { SectionHead, SectionTabs, StatStrip, ToneChip } from './SectionParts';
import { downloadText } from './download';
import { keyOf, patchAt } from './keys';
import { escapeRegExp, plural } from '../core/util';

const ISSUE_TEXTS: Record<EntryIssue, string> = {
  'same-replacement': 'Two terms use the same replacement.',
  'contains-term': "A replacement can't contain another term.",
  'ordinary-word': 'This looks like an ordinary word; it may be replaced by mistake.',
};

const report = (e: unknown) => console.error('[word blacklist]', e);
const NOT_A_FILE = 'Not a word blacklist file.';

export function WordBlacklistSection({ settings }: { settings: Settings }) {
  const [config, setConfig] = useState<BlacklistConfig>();
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const saved = useRef('[]'); // the terms as last saved or read: another page's change replaces the draft only then
  const { filter, setFilter, matches } = useFilter();
  const [imported, setImported] = useState<string>(); // what the last import did

  useEffect(() => {
    const read = async () => {
      const [c, stored] = await Promise.all([loadBlacklistConfig(), loadBlacklistEntries()]);
      setConfig(c);
      const json = JSON.stringify(stored);
      if (json !== saved.current) {
        saved.current = json;
        setEntries(stored);
      }
    };
    void read().catch(report);
    return onBlacklistChanged(() => void read().catch(report));
  }, []);

  if (!config) return null;
  const set = (change: Partial<BlacklistConfig>) => {
    const next = { ...config, ...change };
    setConfig(next);
    void saveBlacklistConfig(next).catch(report);
  };
  const issues = entryIssues(entries);
  const edit = (next: BlacklistEntry[]) => {
    setEntries(next);
    if (blocksSaving(entryIssues(next))) return;
    const usable = usableEntries(next);
    saved.current = JSON.stringify(usable);
    void saveBlacklistEntries(usable).catch(report);
  };

  // The rows the filter shows, by their place in the list; one just added (empty) always.
  const shown = entries.map((e, i) => ({ e, i })).filter(({ e }) => !e.term.trim() || matches([e.term, e.replacement]));
  const importFile = async (file: File) => {
    const read = parseBlacklistFile(await file.text());
    if (!read) return setImported(NOT_A_FILE);
    const { entries: next, updated } = mergeEntries(entries, read);
    edit(next);
    setImported(`Imported ${plural(read.length, 'term')}${updated ? ` (${updated} updated)` : ''}.`);
  };

  const usable = usableEntries(entries);
  const toCheck = [...issues.values()].filter((list) => list.length).length;
  const targets = config.targets ?? [];
  const providers = settings.providers.filter((p) => targets.some((t) => t.providerId === p.id));
  const models = targets.filter((t) => t.model).length;
  const providerNames = providers.map((p) => p.name).join(', ');
  const pages = config.pages ?? [];

  return (
    <section className="word-blacklist-settings">
      <SectionHead title="Word blacklist" about="Sensitive terms go to the model as placeholders, and come back as themselves in its replies and tool calls."
        toggle={{ label: 'Use the blacklist', on: !!config.enabled, onChange: (enabled) => set({ enabled }) }} />
      <StatStrip stats={[
        { label: 'Terms', value: usable.length, sub: `${toCheck ? `${toCheck} to check · ` : ''}kept apart from the settings` },
        { label: 'With', value: <span className="stat-text">{providers.length ? plural(providers.length, 'provider') : 'Every provider'}</span>, sub: providers.length ? `${providerNames} · ${models ? plural(models, 'model') : 'any model'}` : 'None ticked' },
        { label: 'On', value: <span className="stat-text">{pages.length ? plural(pages.length, 'page pattern') : 'Every page'}</span>, sub: pages.length ? pages.slice(0, 2).join(', ') + (pages.length > 2 ? '…' : '') : 'No pages listed' },
        { label: 'Images', value: <span className="stat-text">{config.hideImages ? 'Hidden' : 'Sent'}</span>, sub: 'While it is on' },
      ]} />
      <SectionTabs label="Word blacklist" tabs={[
        {
          id: 'terms', label: 'Terms', render: () => <>
            <div className="row wbl-toolbar">
              <FilterBox label="Filter terms" value={filter} onChange={setFilter} />
              <button className="primary" onClick={() => edit([{ term: '', replacement: '' }, ...entries])}>＋ Add term</button>
              <label className="button-like">
                Import…
                <input type="file" accept="application/json,.json,text/csv,.csv,.tsv,.txt" hidden onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  if (file) void importFile(file).catch(report);
                  ev.target.value = ''; // the same file can be chosen again
                }} />
              </label>
              <button onClick={() => downloadText('word-blacklist.json', exportBlacklist(entries))} disabled={!usable.length}>Export</button>
            </div>
            {imported && <p className={imported === NOT_A_FILE ? 'error-text' : 'muted'} role="status">{imported}</p>}
            <div className="wbl-terms">
              <div className="wbl-row wbl-head" aria-hidden="true">
                <span>Real term</span><span /><span>Sent as</span>
                <span className="wbl-count">{shown.length === entries.length ? plural(entries.length, 'term') : `${shown.length} of ${plural(entries.length, 'term')}`}</span>
              </div>
              <div className="wbl-list">
                {shown.map(({ e, i }) => {
                  const found = issues.get(i) ?? [];
                  const ordinary = found.includes('ordinary-word');
                  return (
                    <div key={keyOf(e)} className="wbl-entry">
                      <div className="wbl-row">
                        <input aria-label="Real term" value={e.term} onChange={(ev) => edit(patchAt(entries, i, { term: ev.target.value }))} />
                        <span className="wbl-arrow" aria-hidden="true">→</span>
                        <input aria-label="Sent as" className="mono" placeholder="e.g. CLIENT_A" value={e.replacement} onChange={(ev) => edit(patchAt(entries, i, { replacement: ev.target.value }))} />
                        {ordinary ? <span className="wbl-warning" role="img" aria-label={ISSUE_TEXTS['ordinary-word']} title={ISSUE_TEXTS['ordinary-word']}>⚠</span> : <span />}
                        <button className="icon-button warn" title="Remove" aria-label={`Remove ${e.term || 'the term'}`} onClick={() => edit(entries.filter((_, j) => j !== i))}>✕</button>
                      </div>
                      {found.filter((issue) => issue !== 'ordinary-word').map((issue) => <p key={issue} className="error-text" role="alert">{ISSUE_TEXTS[issue]}</p>)}
                    </div>
                  );
                })}
                {!entries.length && <p className="hint wbl-empty">No terms yet: <strong>＋ Add term</strong>, or import a file.</p>}
              </div>
            </div>
            <p className="hint">
              The terms are kept apart from the other settings, and an export holds them in plain text: keep the file somewhere safe.
              Import reads that JSON file, or two columns (term, replacement) as CSV, TSV or TXT.
            </p>
          </>,
        },
        { id: 'where', label: 'Where it applies', render: () => <WhereTab providers={settings.providers} config={config} set={set} /> },
        { id: 'try', label: 'Try it', render: () => <BlacklistTry entries={usable} where={providers.length ? `with ${providerNames}` : 'with every provider'} pages={pages.length ? `on ${plural(pages.length, 'page pattern')}` : 'on every page'} on={!!config.enabled} /> },
      ]} />
    </section>
  );
}

// Settings → Word blacklist → Where it applies: the providers and models, the pages, and what else goes
// while it is on.
function WhereTab({ providers, config, set }: { providers: Settings['providers']; config: BlacklistConfig; set: (change: Partial<BlacklistConfig>) => void }) {
  const targets = config.targets ?? [];
  const pages = config.pages ?? [];
  return (
    <>
      <p className="hint">With no provider ticked and no pages listed, it always applies. Once it applies in a chat, it stays on until the chat ends.</p>
      <div className="section-subhead"><h4>Providers and models</h4></div>
      {providers.length ? (
        <ul className="switch-rows" aria-label="Providers and models">
          {providers.map((p) => <ProviderTarget key={p.id} provider={p} targets={targets} onChange={(next) => set({ targets: next })} />)}
        </ul>
      ) : <p className="hint">No providers yet: add one in <a href="#providers">Providers</a>.</p>}
      <div className="section-subhead"><h4>Pages</h4><span className="hint">One URL pattern per line, e.g. *.example.com</span></div>
      <textarea rows={3} className="mono wbl-pages" aria-label="Apply on these pages" placeholder={'*.example.com\nexample.com/docs/*'} defaultValue={pages.join('\n')}
        onChange={(e) => set({ pages: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })} />
      <div className="section-subhead"><h4>While it is on</h4></div>
      <ul className="switch-rows" aria-label="While it is on">
        <li>
          <div><strong>Hide images from the model</strong><span className="hint">Screenshots and attached images go as a short note</span></div>
          <Switch checked={!!config.hideImages} label="Hide images from the model" onChange={(hideImages) => set({ hideImages })} />
        </li>
      </ul>
    </>
  );
}

// A text as the model would get it: masked with the terms (the same as a request), its placeholders
// marked, and which terms went. Nothing is sent.
function BlacklistTry({ entries, where, pages, on }: { entries: BlacklistEntry[]; where: string; pages: string; on: boolean }) {
  const [text, setText] = useState('');
  const blacklist = compileBlacklist(entries);
  const masked = blacklist.mask(text);
  const used = blacklist.replaced(text);
  const marks = used.length ? new RegExp(`(${used.map((e) => escapeRegExp(e.replacement)).join('|')})`) : undefined;
  return (
    <>
      <p className="hint">A text as the model would get it. Nothing is sent.</p>
      <textarea className="wbl-try-in" rows={3} aria-label="Text to try" placeholder="Write or paste a text with some of the terms" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="hint wbl-applies">
        <span className={`wbl-dot${on ? ' on' : ''}`} aria-hidden="true" />
        {on ? `On: it applies ${where}, ${pages}.` : 'Off: switch it on above to use it.'}
      </p>
      {text && (
        <>
          <div className="wbl-try-out" aria-label="As the model gets it">
            {marks ? masked.split(marks).map((part, i) => (i % 2 ? <mark key={i} className="wbl-placeholder">{part}</mark> : part)) : masked}
          </div>
          <div className="wbl-used">
            {used.length ? used.map((e) => <ToneChip key={e.term} tone="match">{e.term} → {e.replacement}</ToneChip>) : <span className="hint">No term found.</span>}
          </div>
        </>
      )}
    </>
  );
}

// A provider's row: its switch, and its models, separated by commas (empty: any of them).
function ProviderTarget({ provider, targets, onChange }: { provider: Settings['providers'][number]; targets: BlacklistTarget[]; onChange: (targets: BlacklistTarget[]) => void }) {
  const own = targets.filter((t) => t.providerId === provider.id);
  const others = targets.filter((t) => t.providerId !== provider.id);
  const models = own.flatMap((t) => (t.model ? [t.model] : [])).join(', ');
  const withModels = (text: string) => {
    const list = text.split(',').map((m) => m.trim()).filter(Boolean);
    return [...others, ...(list.length ? list.map((model) => ({ providerId: provider.id, model })) : [{ providerId: provider.id }])];
  };
  const on = own.length > 0;
  return (
    <li className={on ? undefined : 'off'}>
      <div><strong>{provider.name}</strong><span className="hint">{provider.baseURL || 'No address yet'} · models separated by commas; empty: any</span></div>
      <span className="wbl-target">
        <input className="mono" aria-label={`${provider.name} models`} placeholder="Any model" disabled={!on} defaultValue={models} onChange={(e) => onChange(withModels(e.target.value))} />
        <Switch checked={on} label={provider.name} onChange={(checked) => onChange(checked ? withModels('') : others)} />
      </span>
    </li>
  );
}
