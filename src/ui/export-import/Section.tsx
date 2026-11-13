// Settings → Export and import: one file with the parts the user picks (storage/export-file), and its
// import: what the file holds, each part on or off and its items picked, with what each would do (new,
// replacing yours, left out), before anything is stored.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { agentStore } from '../../agents/profiles';
import { errorText } from '../../core/errors';
import { plural } from '../../core/util';
import { exportAll, listConversations } from '../../history/store';
import { memoryStore } from '../../memory/store';
import { skillStore } from '../../skills/store';
import { buildExportFile, exportFileName, LEFT_OUT, PARTS, partInfo, readExportFile, type PartKind, type ReadFile } from '../../storage/export-file';
import type { ImportRow, ImportStatus } from '../../storage/import';
import { settingSummary, type SettingChange } from '../../storage/settings-transfer';
import { templateStore } from '../../templates/store';
import { customToolStore } from '../../tools/custom/store';
import { actionStore } from '../../widget/store';
import { loadBlacklistEntries } from '../../word-blacklist/store';
import { Switch } from '../Collection';
import { downloadText } from '../download';
import { InlineConfirm } from '../InlineConfirm';
import { writeClip } from '../icons';
import { PasteJson } from '../PasteJson';
import { SectionHead, SectionTabs } from '../SectionParts';
import { useSettingsContext } from '../settings-context';
import { useToolCatalog } from '../Tools';
import { StatusBadge, TICKED } from '../collection/ImportPreview';
import { UrlImport } from '../collection/UrlImport';
import { applyImport, retentionDeletes, type Done, type Picked } from './apply';
import { countOf, exportPart, readPart, type Current, type PartRead, type Stored } from './parts';

const GROUPS = [...new Set(PARTS.map((p) => p.group))];

// Everything here now: the stored lists read afresh (on opening, after an import), the settings and
// the tools as the page has them.
function useCurrent(): [Current | undefined, () => Promise<Stored>] {
  const { settings } = useSettingsContext();
  const catalog = useToolCatalog();
  const [stored, setStored] = useState<Stored>();
  const reload = useCallback(async () => {
    const [agents, skills, templates, memory, blacklist, customTools, actions, conversations] = await Promise.all([
      agentStore.load(), skillStore.load(), templateStore.load(), memoryStore.load(), loadBlacklistEntries(), customToolStore.load(), actionStore.load(), listConversations(),
    ]);
    const read = { agents, skills, templates, memory, blacklist, customTools, actions, conversations };
    setStored(read);
    return read;
  }, []);
  useEffect(() => void reload().catch((e: unknown) => console.error('[export]', e)), [reload]);
  return [stored && { ...stored, settings, catalog }, reload];
}

export function ExportImportSection() {
  const [cur, reload] = useCurrent();
  return (
    <section className="export-import">
      <SectionHead title="Export and import" about="Move your setup to another browser, or keep a copy: one file with the parts you choose." />
      {!cur ? <p className="muted">Reading…</p> : (
        <SectionTabs label="Export and import" tabs={[
          { id: 'export', label: 'Export', render: () => <ExportTab cur={cur} /> },
          { id: 'import', label: 'Import', render: () => <ImportTab cur={cur} reload={reload} /> },
        ]} />
      )}
    </section>
  );
}

// The parts in their groups, a row each: on or off, its name, what it holds, and `side` at the end.
function PartList({ kinds, row }: { kinds: PartKind[]; row: (kind: PartKind) => ReactNode }) {
  return (
    <>
      {GROUPS.map((g) => {
        const inGroup = PARTS.filter((p) => p.group === g && kinds.includes(p.kind));
        if (!inGroup.length) return null;
        return (
          <div key={g}>
            <div className="part-group">{g}</div>
            <ul className="part-list">{inGroup.map((p) => <li key={p.kind}>{row(p.kind)}</li>)}</ul>
          </div>
        );
      })}
    </>
  );
}

const SecretNote = () => (
  <p className="part-secrets">🔒 <span><strong>Never in the file:</strong> {LEFT_OUT.join(', ')}.</span></p>
);

function ExportTab({ cur }: { cur: Current }) {
  const counts = Object.fromEntries(PARTS.map((p) => [p.kind, countOf(p.kind, cur)])) as Record<PartKind, number>;
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(PARTS.map((p) => [p.kind, !p.off && counts[p.kind] > 0])));
  const [message, setMessage] = useState('');
  const chosen = PARTS.filter((p) => on[p.kind] && counts[p.kind] > 0);
  const items = chosen.reduce((n, p) => n + counts[p.kind], 0);
  const setAll = (value: boolean) => setOn(Object.fromEntries(PARTS.map((p) => [p.kind, value && counts[p.kind] > 0])));

  const build = async () => {
    const parts: Partial<Record<PartKind, string>> = {};
    for (const { kind } of chosen) parts[kind] = kind === 'conversations' ? await exportAll() : exportPart(kind, cur);
    return buildExportFile(parts, { version: browser.runtime.getManifest().version });
  };
  const run = (then: (json: string) => Promise<void> | void, said: string) =>
    void build().then(then).then(() => setMessage(said), (e: unknown) => setMessage(`Error: ${errorText(e)}`));

  return (
    <>
      <div className="row io-row">
        <span className="hint">Choose what goes in the file.</span>
        <span className="spacer" />
        <button onClick={() => setAll(true)}>All</button>
        <button onClick={() => setAll(false)}>None</button>
      </div>
      <PartList kinds={PARTS.map((p) => p.kind)} row={(kind) => {
        const p = partInfo(kind);
        const none = !counts[kind];
        return (
          <label className={`part-row${on[kind] && !none ? '' : ' off'}`}>
            <Switch checked={!!on[kind] && !none} disabled={none} label={`Export ${p.label}`} title={none ? 'None yet.' : undefined} onChange={(v) => setOn({ ...on, [kind]: v })} />
            <span>
              <span className="part-name">{p.label}</span>
              {p.about && <span className="part-about">{p.about}</span>}
            </span>
            <span className="part-count">{none ? 'none' : kind === 'settings' ? plural(counts[kind], 'setting') : counts[kind]}</span>
          </label>
        );
      }} />
      <SecretNote />
      <div className="row part-footer">
        <strong>{plural(chosen.length, 'part')} · {plural(items, 'item')}</strong>
        <span className="spacer" />
        <button disabled={!chosen.length} onClick={() => run(writeClip, `Copied ${plural(chosen.length, 'part')} as JSON.`)}>Copy JSON</button>
        <button className="primary" disabled={!chosen.length} onClick={() => run((json) => downloadText(exportFileName(), json), `Saved ${exportFileName()}.`)}>Download</button>
      </div>
      {message && <p className={message.startsWith('Error') ? 'error-text' : 'muted'} role="status">{message}</p>}
    </>
  );
}

// A part of the file as read: what importing it would do (or why it cannot be read), whether it is
// on, and the rows ticked.
interface PartState {
  kind: PartKind;
  json: string;
  read?: PartRead;
  error?: string;
  on: boolean;
  ticked: Set<number>;
}

function readParts(file: ReadFile, cur: Current): PartState[] {
  return file.parts.map(({ kind, json }) => {
    try {
      const read = readPart(kind, json, cur);
      const ticked = new Set(read.rows.flatMap((r, i) => (TICKED.has(r.status) ? [i] : [])));
      return { kind, json, read, on: ticked.size > 0, ticked };
    } catch (e) {
      return { kind, json, error: errorText(e), on: false, ticked: new Set<number>() };
    }
  });
}

type Source = { kind: 'paste' } | { kind: 'url' } | null;

function ImportTab({ cur, reload }: { cur: Current; reload: () => Promise<Stored> }) {
  const { save } = useSettingsContext();
  const [source, setSource] = useState<Source>(null);
  const [preview, setPreview] = useState<{ from: string; file: ReadFile; parts: PartState[] } | null>(null);
  const [done, setDone] = useState<Done[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletes, setDeletes] = useState(0); // saved conversations the imported History retention would delete
  const fileInput = useRef<HTMLInputElement>(null);
  const picks: Picked[] = (preview?.parts ?? []).filter((p) => p.on && p.ticked.size).map((p) => ({ kind: p.kind, json: p.json, rows: [...p.ticked].sort((a, b) => a - b) }));
  const settingsPick = JSON.stringify(picks.find((p) => p.kind === 'settings') ?? null);
  useEffect(() => {
    let current = true;
    const settingsPart = JSON.parse(settingsPick) as Picked | null;
    void retentionDeletes(settingsPart ? [settingsPart] : [], cur).then((n) => current && setDeletes(n), () => current && setDeletes(0));
    return () => {
      current = false;
    };
  }, [settingsPick, cur]);

  const open = (text: string, from: string) => {
    setMessage('');
    setDone(null);
    try {
      const file = readExportFile(text);
      setPreview({ from, file, parts: readParts(file, cur) });
      setSource(null);
    } catch (e) {
      setMessage(`Error: ${errorText(e)}`);
    }
  };
  const openFile = (f: File | undefined) => void f?.text().then((t) => open(t, f.name));
  const setPart = (kind: PartKind, change: Partial<PartState>) =>
    setPreview((p) => p && { ...p, parts: p.parts.map((s) => (s.kind === kind ? { ...s, ...change } : s)) });

  if (done) return <ImportDone done={done} onAgain={() => setDone(null)} />;

  if (!preview) {
    return (
      <>
        <div className="part-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFile(e.dataTransfer.files[0]); }}>
          <p>Drop a Teseo export here, or</p>
          <div className="row">
            <button className="primary" onClick={() => fileInput.current?.click()}>From file…</button>
            <button onClick={() => setSource({ kind: 'paste' })}>Paste JSON…</button>
            <button onClick={() => setSource({ kind: 'url' })}>From URL…</button>
          </div>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="Export file"
            onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <p className="hint">Nothing changes until you choose the parts and press Import. A file of one section (skills, a theme…) works too: it shows as that one part.</p>
        {source?.kind === 'paste' && (
          <PasteJson label="Export JSON" placeholder='{ "type": "teseo-export", "version": 1, "parts": { … } }' onClose={() => setSource(null)}
            onImport={async (json) => { open(json, 'the pasted JSON'); return false; }} />
        )}
        {source?.kind === 'url' && <UrlImport placeholder="https://raw.githubusercontent.com/example/repo/main/teseo-export.json" onRead={(json, host) => open(json, host)} onClose={() => setSource(null)} />}
        {message && <p className="error-text" role="status">{message}</p>}
      </>
    );
  }

  const { file, parts } = preview;
  const picked = parts.filter((p) => p.on && p.ticked.size);
  const items = picked.reduce((n, p) => n + p.ticked.size, 0);
  const missing = PARTS.filter((p) => !parts.some((s) => s.kind === p.kind)).map((p) => p.label);
  const exported = file.meta.exportedAt ? new Date(file.meta.exportedAt) : undefined;
  const setAll = (value: boolean) => setPreview({ ...preview, parts: parts.map((p) => ({ ...p, on: value && p.ticked.size > 0 })) });
  const doImport = async () => {
    setBusy(true);
    try {
      setDone(await applyImport(picks, cur, { save, reload }));
      setPreview(null);
      await reload();
    } catch (e) {
      setMessage(`Error: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card part-file">
        <div className="row"><strong>{preview.from}</strong><span className="spacer" /><button onClick={() => setPreview(null)}>Choose another file</button></div>
        <dl className="part-meta">
          {file.single ? <><dt>Holds</dt><dd>One section’s file: {partInfo(parts[0]!.kind).label}</dd></> : (
            <>
              {(exported || file.meta.app) && <><dt>Exported</dt><dd>{[exported && !Number.isNaN(exported.getTime()) ? exported.toLocaleString() : undefined, file.meta.app && [file.meta.app.name, file.meta.app.version].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</dd></>}
              <dt>Holds</dt><dd>{plural(parts.length, 'part')}</dd>
              {missing.length > 0 && <><dt>Not in it</dt><dd>{missing.join(', ')}</dd></>}
              {file.unknown.length > 0 && <><dt>Not read</dt><dd>{file.unknown.join(', ')}: from a newer Teseo, left out.</dd></>}
            </>
          )}
        </dl>
      </div>
      <div className="row io-row">
        <span className="hint">Choose what comes in. Open a part to pick its items.</span>
        <span className="spacer" />
        <button onClick={() => setAll(true)}>All</button>
        <button onClick={() => setAll(false)}>None</button>
      </div>
      <PartList kinds={parts.map((p) => p.kind)} row={(kind) => {
        const part = parts.find((p) => p.kind === kind)!;
        return <ImportPart part={part} onChange={(change) => setPart(kind, change)} />;
      }} />
      <p className="hint">Imported skills, site templates, custom tools, actions, agents and MCP servers come in off: review them, then switch them on. A name already here is replaced (yours keeps its id); nothing is deleted.</p>
      <div className="row part-footer">
        <strong>Import {plural(picked.length, 'part')} · {plural(items, 'item')}</strong>
        <span className="spacer" />
        <button onClick={() => setPreview(null)}>Cancel</button>
        {deletes > 0 && items > 0 && !busy ? (
          // Its History setting would delete saved conversations: asked first, as Settings → History asks.
          <InlineConfirm question={`Its History setting deletes ${plural(deletes, 'saved conversation')} at the next save (pinned ones are kept).`}
            action="Import" label="Confirm: import and delete conversations" onConfirm={doImport}>
            {(ask) => <button className="primary" onClick={ask}>Import</button>}
          </InlineConfirm>
        ) : (
          <button className="primary" disabled={!items || busy} onClick={() => void doImport()}>{busy ? 'Importing…' : 'Import'}</button>
        )}
      </div>
      {message && <p className="error-text" role="status">{message}</p>}
    </>
  );
}

// A part's count of each: one and many.
const STATUS_WORDS: Record<ImportStatus, [string, string]> = { new: ['new', 'new'], replaces: ['replaces yours', 'replace yours'], 'leaves-source': ['leaves its source', 'leave their source'], 'left-out': ['left out', 'left out'] };

function ImportPart({ part, onChange }: { part: PartState; onChange: (change: Partial<PartState>) => void }) {
  const info = partInfo(part.kind);
  const rows = part.read?.rows ?? [];
  const usable = rows.filter((r) => r.status !== 'left-out').length;
  const counts = (['new', 'replaces', 'leaves-source', 'left-out'] as ImportStatus[]).flatMap((s) => {
    const n = rows.filter((r) => r.status === s).length;
    return n ? [{ s, n }] : [];
  });
  const tick = (i: number, on: boolean) => {
    const ticked = new Set(part.ticked);
    if (on) ticked.add(i);
    else ticked.delete(i);
    onChange({ ticked, on: ticked.size > 0 });
  };
  const canImport = part.ticked.size > 0 || usable > 0;
  return (
    <>
      <label className={`part-row${part.on && part.ticked.size ? '' : ' off'}`}>
        <Switch checked={part.on && part.ticked.size > 0} disabled={!canImport} label={`Import ${info.label}`}
          onChange={(v) => onChange(v && !part.ticked.size ? { on: true, ticked: new Set(rows.flatMap((r, i) => (TICKED.has(r.status) ? [i] : []))) } : { on: v })} />
        <span>
          <span className="part-name">{info.label}</span>{' '}
          {counts.map(({ s, n }) => (
            <span key={s} className={`badge${s === 'left-out' ? ' warn' : s === 'new' ? '' : ' accent'}`}>{n} {part.kind === 'settings' && s === 'replaces' ? (n === 1 ? 'differs from yours' : 'differ from yours') : STATUS_WORDS[s][n === 1 ? 0 : 1]}</span>
          ))}
          {part.error && <span className="error-text part-about">{part.error}</span>}
          {!part.error && !rows.length && <span className="part-about">Nothing new: all of it is already here.</span>}
          {part.read?.notes.map((n) => <span key={n} className="part-about">{n}</span>)}
        </span>
        <span className="part-count">{rows.length || ''}</span>
      </label>
      {rows.length > 0 && (
        <details className="part-items">
          <summary>Choose which ({part.ticked.size} of {rows.length})</summary>
          {part.kind === 'settings' ? <SettingRows rows={rows as ImportRow<SettingChange>[]} ticked={part.ticked} onTick={tick} /> : (
            <ul className="import-rows">
              {rows.map((r, i) => (
                <li key={i} className={r.status === 'left-out' ? 'muted' : undefined}>
                  <label className="check">
                    <input type="checkbox" aria-label={`Import ${r.name}`} disabled={r.status === 'left-out'} checked={part.ticked.has(i)} onChange={(e) => tick(i, e.target.checked)} />
                    {r.name}
                  </label>
                  <StatusBadge row={r} />
                  {r.status === 'left-out' && r.why && <span className="hint">{r.why}</span>}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </>
  );
}

// The settings that differ: yours and the file's, side by side.
function SettingRows({ rows, ticked, onTick }: { rows: ImportRow<SettingChange>[]; ticked: Set<number>; onTick: (i: number, on: boolean) => void }) {
  return (
    <table className="part-diff">
      <thead><tr><th /><th>Setting</th><th>Yours</th><th>The file’s</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.status === 'left-out' ? 'muted' : undefined}>
            <td><input type="checkbox" aria-label={`Import ${r.name}`} disabled={r.status === 'left-out'} checked={ticked.has(i)} onChange={(e) => onTick(i, e.target.checked)} /></td>
            <td>{r.name}</td>
            {r.item ? <><td className="part-old">{settingSummary(r.item.yours)}</td><td>{settingSummary(r.item.value)}</td></> : <td colSpan={2} className="hint">{r.why}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// What came in, part by part, and where to go next.
const NEXT: Partial<Record<PartKind, [string, string]>> = {
  providers: ['providers', 'Add keys in Providers'],
  mcpServers: ['mcp', 'Test and sign in to MCP servers'],
  skills: ['skills', 'Review skills'],
  agents: ['agents', 'Review agents'],
  customTools: ['custom-tools', 'Review custom tools'],
  actions: ['actions', 'Review actions'],
  theme: ['appearance', 'Pick a theme in Appearance'],
};

function ImportDone({ done, onAgain }: { done: Done[]; onAgain: () => void }) {
  return (
    <div className="card import-done" role="status">
      <strong>Imported</strong>
      <ul className="import-rows">
        {done.map((d) => (
          <li key={d.kind}>
            <span><strong>{partInfo(d.kind).label}</strong>: {d.names.length ? plural(d.names.length, 'item') : 'nothing'}{d.leftOut.length ? `; left out ${d.leftOut.join('; ')}` : ''}</span>
            {NEXT[d.kind] && d.names.length > 0 && <a href={`#${NEXT[d.kind]![0]}`}>{NEXT[d.kind]![1]} →</a>}
          </li>
        ))}
      </ul>
      <div className="row"><button onClick={onAgain}>Import another file</button></div>
    </div>
  );
}
