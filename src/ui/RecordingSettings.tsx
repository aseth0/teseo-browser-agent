// Settings → Recording: the presets a recording of a page's requests keeps calls by (recording/presets,
// recording/filter), the one it starts with, and each one's filters. A shipped preset edited can be
// reset; the user's own can be deleted, asked first inside the page.
import { useState, type ReactNode } from 'react';
import { CALL_TYPES, DEFAULT_PRESET_ID, MAX_MINUTES, MIN_BODY, copyOfPreset, presetFor, presetsOf, withoutPreset, withPreset, type CallType, type RecordingPreset } from '../recording/presets';
import { MAX_BODY } from '../recording/recording';
import type { PatchSectionProps as Props } from './useSettings';
import { SectionTop } from './SectionTop';
import { Switch } from './Collection';
import { SectionHead, SectionTabs, StatStrip } from './SectionParts';
import { InlineConfirm } from './InlineConfirm';
import { NumberField } from './NumberField';
import { Segmented } from './Segmented';

const TYPE_LABELS: Record<CallType, string> = { fetch: 'fetch and XHR', document: 'Documents and form posts', script: 'Scripts', socket: 'WebSockets and beacons' };
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

export function RecordingSection({ settings, onChange }: Props) {
  const all = presetsOf(settings);
  const [editing, setEditing] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [noTypes, setNoTypes] = useState<string>(); // the preset whose last kind of call was unticked: refused
  const byDefault = presetFor(settings);
  const shown = all.find((p) => p.id === editing) ?? all.find((p) => p.id === byDefault.id)!;
  const { builtIn, edited, ...preset } = shown;
  const save = (change: Partial<RecordingPreset>) => onChange({ recordingPresets: withPreset(settings, { ...preset, ...change }) });
  const remove = () => {
    setAsking(false);
    setEditing(undefined);
    onChange({ recordingPresets: withoutPreset(settings, preset.id), recordingPreset: settings.recordingPreset === preset.id ? undefined : settings.recordingPreset });
  };
  const add = () => {
    const copy = copyOfPreset(preset, all.map((p) => p.id));
    onChange({ recordingPresets: withPreset(settings, copy) });
    setEditing(copy.id);
  };
  const pick = (id: string) => {
    setEditing(id);
    setAsking(false);
  };
  const presets = (
    <div className="tools-layout recording-layout">
      <nav className="tool-groups" aria-label="Presets">
        {all.map((p) => (
          <button key={p.id} type="button" className={`tool-group-item${p.id === preset.id ? ' on' : ''}`} aria-current={p.id === preset.id ? 'true' : undefined} onClick={() => pick(p.id)}>
            <span>{p.name}</span>
            <span className="tool-group-count">{p.id === byDefault.id ? 'default' : p.builtIn ? (p.edited ? 'edited' : 'built-in') : 'yours'}</span>
          </button>
        ))}
        <button type="button" className="recording-new" onClick={add} title="A copy of the preset shown">＋ New preset</button>
      </nav>
      <div className="tool-pane recording-pane">
        <div className="tool-pane-head">
          <input aria-label="Name" className="recording-name" value={preset.name} onChange={(e) => save({ name: e.target.value })} />
          {preset.id === byDefault.id
            ? <span className="badge">default</span>
            : <button onClick={() => onChange({ recordingPreset: preset.id === DEFAULT_PRESET_ID ? undefined : preset.id })}>Use by default</button>}
          {!builtIn && <button className="danger" onClick={() => setAsking(true)}>Delete</button>}
          {builtIn && edited && (
            <InlineConfirm question="Discard your changes?" action="Reset" label={`Confirm: reset ${preset.name} to how it ships`} onConfirm={() => onChange({ recordingPresets: withoutPreset(settings, preset.id) })}>
              {(ask) => <button onClick={ask} title="Back to how it ships">Reset</button>}
            </InlineConfirm>
          )}
        </div>
        {asking && (
          <div className="row recording-ask" role="alert">
            <span>Delete &quot;{preset.name}&quot;?</span>
            <button className="danger" onClick={remove}>Delete preset</button>
            <button onClick={() => setAsking(false)}>Cancel</button>
          </div>
        )}
        <ul className="switch-rows recording-rows" aria-label={`${preset.name}: what it keeps`}>
          <li className="stack">
            <div><strong>Kinds of calls</strong><span className="hint">Images, fonts, style sheets and media are never kept</span></div>
            <div className="recording-types" role="group" aria-label="Kinds of calls">
              {CALL_TYPES.map((t) => (
                <label key={t} className="check">
                  <input type="checkbox" checked={preset.types.includes(t)}
                    onChange={(e) => {
                      const types = e.target.checked ? CALL_TYPES.filter((x) => x === t || preset.types.includes(x)) : preset.types.filter((x) => x !== t);
                      setNoTypes(types.length ? undefined : preset.id);
                      if (types.length) save({ types });
                    }} />
                  {TYPE_LABELS[t]}
                </label>
              ))}
              {noTypes === preset.id && <p className="hint" role="alert">Keep at least one kind of call: a preset without any records nothing.</p>}
            </div>
          </li>
          <li>
            <div><strong>Sites</strong><span className="hint">The calls to other sites are only counted</span></div>
            <Segmented label="Sites" className="compact" value={preset.sites} onChange={(sites) => save({ sites })}
              options={[{ value: 'all', label: 'Every site' }, { value: 'this-site', label: 'This site and its subdomains' }]} />
          </li>
          <li className="stack">
            <div><strong>Only these addresses</strong><span className="hint">One per line; none: every address</span></div>
            <Draft key={`${preset.id}-include`} saved={preset.include.join('\n')} onSave={(text) => save({ include: lines(text) })}>
              {(field) => <textarea className="mono" rows={2} aria-label="Only these addresses" placeholder="*://*.example.com/api/*" {...field} />}
            </Draft>
          </li>
          <li className="stack">
            <div>
              <strong>Leave out these addresses</strong>
              <span className="hint">
                One per line. With a scheme, an address is a match pattern (<code>*://*.example.com/api/*</code>); without one, <code>*</code> stands for
                anything in the host, path and query (<code>*analytics*</code>, <code>*/collect</code>)
              </span>
            </div>
            <Draft key={`${preset.id}-exclude`} saved={preset.exclude.join('\n')} onSave={(text) => save({ exclude: lines(text) })}>
              {(field) => <textarea className="mono" rows={4} aria-label="Leave out these addresses" placeholder="*analytics*" {...field} />}
            </Draft>
          </li>
          <li>
            <div><strong>Methods</strong><span className="hint">Separated by commas; none: every method</span></div>
            <Draft key={`${preset.id}-methods`} saved={preset.methods.join(', ')} onSave={(text) => save({ methods: text.split(',').map((m) => m.trim().toUpperCase()).filter(Boolean) })}>
              {(field) => <input aria-label="Methods" className="recording-short" placeholder="GET, POST" {...field} />}
            </Draft>
          </li>
          <li>
            <div><strong>Status</strong></div>
            <Segmented label="Status" className="compact" value={preset.status} onChange={(status) => save({ status })}
              options={[{ value: 'all', label: 'All' }, { value: 'errors', label: 'Errors (4xx, 5xx, failed)' }, { value: 'success', label: 'Success' }]} />
          </li>
          <li>
            <div><strong>Answers</strong></div>
            <Segmented label="Answers" className="compact" value={preset.answers} onChange={(answers) => save({ answers })}
              options={[{ value: 'all', label: 'All' }, { value: 'text', label: 'JSON and text only' }]} />
          </li>
          <li>
            <div><strong>Same call repeated</strong><span className="hint">Keep the first</span></div>
            <Switch checked={preset.dedupe} label="Same call repeated: keep the first" onChange={(dedupe) => save({ dedupe })} />
          </li>
          <li>
            <div><strong>Body kept up to</strong><span className="hint">Characters, {MIN_BODY.toLocaleString('en-US')} to {MAX_BODY.toLocaleString('en-US')}</span></div>
            <label className="recording-number"><NumberField key={`${preset.id}-body`} label="Body kept up to, in characters" value={preset.maxBody} min={MIN_BODY} max={MAX_BODY} step={1000} onSave={(maxBody) => maxBody !== undefined && save({ maxBody })} /></label>
          </li>
          <li>
            <div><strong>Stop after</strong><span className="hint">Minutes, 1 to {MAX_MINUTES}</span></div>
            <label className="recording-number"><NumberField key={`${preset.id}-minutes`} label="Stop after, in minutes" value={preset.maxMinutes} min={1} max={MAX_MINUTES} onSave={(maxMinutes) => maxMinutes !== undefined && save({ maxMinutes })} /></label>
          </li>
        </ul>
      </div>
    </div>
  );
  return (
    <section className="recording-settings">
      <SectionHead title="Recording" about={<>
        What a recording of a page&apos;s requests (Record in the toolbar popup) keeps. Calls a preset leaves out are only counted. Header values,
        cookies and secret-looking values are never kept, whatever the preset, and you review every recording before it is sent.
      </>} />
      <StatStrip stats={[
        { label: 'Presets', value: all.length, sub: `${all.filter((p) => p.builtIn).length} built-in · ${all.filter((p) => !p.builtIn).length} yours` },
        { label: 'By default', value: <span className="stat-text">{byDefault.name}</span>, sub: 'What Record starts with' },
        { label: 'Never kept', value: <span className="stat-text">Secrets</span>, sub: 'Header values, cookies, secret-looking values' },
      ]} />
      <SectionTabs label="Recording" tabs={[
        { id: 'presets', label: 'Presets', render: () => presets },
        { id: 'top', label: 'Shortcut and limits', render: () => <SectionTop page="recording" /> },
      ]} />
    </section>
  );
}

// A field saved as typed, shown as typed (a new line, a comma) until it is left, then as saved.
function Draft({ saved, onSave, children }: { saved: string; onSave: (text: string) => void; children: (field: { value: string; onChange: (e: { target: { value: string } }) => void; onBlur: () => void }) => ReactNode }) {
  const [draft, setDraft] = useState<string>();
  return children({
    value: draft ?? saved,
    onChange: (e) => {
      setDraft(e.target.value);
      onSave(e.target.value);
    },
    onBlur: () => setDraft(undefined),
  });
}
