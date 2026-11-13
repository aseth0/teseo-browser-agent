// Settings → Custom tools → Sources: URLs whose JSON (as exported here) brings custom tools, say a
// file in a team's repository, each read with its headers and the browser's session as a request;
// synced on a click, and once when this section opens (tools/custom/sources).
import { useEffect, useRef, useState } from 'react';
import { useAttempt } from './useAttempt';
import { useStableCallback } from './useStableCallback';
import type { ToolInfo } from '../core/protocol';
import { hostOf } from '../core/util';
import { originPattern } from '../page/permissions';
import type { CustomTool } from '../tools/custom/types';
import { customToolStore } from '../tools/custom/store';
import { customToolSourceStore, runSync, unsourced, type CustomToolSource, type SourceSync } from '../tools/custom/sources';
import { AccessEditor, Part } from './AccessEditor';
import { useCollectionState } from './useCollection';
import { askOrigins } from './ask-permission';
import { withMember } from './edits';

const when = (at: number) => new Date(at).toLocaleString();

// What a sync did, as the user reads it.
function report(source: CustomToolSource, sync: SourceSync): string {
  const host = hostOf(source.url);
  const lines = [`${host}: ${sync.save.length} tools.`];
  if (sync.added.length) lines.push(`New, off until you switch them on: ${sync.added.join(', ')}.`);
  if (sync.changed.length) lines.push(`Changed what they do, off until you check them: ${sync.changed.join(', ')}.`);
  if (sync.remove.length) lines.push(`No longer in it, removed: ${sync.remove.map((t) => t.name).join(', ')}.`);
  lines.push(...sync.needSession.map((n) => `${n} takes a cookie in a header: tick "Send the browser's session for this site" in it.`));
  lines.push(...sync.skipped.map((s) => `Left out ${s}`));
  return lines.join('\n');
}

export function CustomToolSources({ customs, catalog }: { customs: CustomTool[]; catalog: ToolInfo[] }) {
  const { items: sources, loaded } = useCollectionState(customToolSourceStore);
  const [editing, setEditing] = useState<CustomToolSource | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const { failed, attempt } = useAttempt();
  const sync = useStableCallback(async (source: CustomToolSource) => {
    setSyncing((s) => withMember(s, source.id, true));
    try {
      const result = await runSync(source, catalog);
      setMessages((m) => ({ ...m, [source.id]: report(source, result) }));
    } catch {
      setMessages((m) => ({ ...m, [source.id]: '' })); // its error is kept with it, shown in its row
    } finally {
      setSyncing((s) => withMember(s, source.id, false));
    }
  });

  // From a click: its site is asked for first (only a click may ask).
  const syncNow = async (source: CustomToolSource) => {
    if (!(await askOrigins(originPattern(source.url)))) {
      return setMessages((m) => ({ ...m, [source.id]: `Access to ${originPattern(source.url)} was not granted.` }));
    }
    await sync(source);
  };

  // Once, when this section opens with its sources and the catalog (to check the tools) loaded.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !loaded || !catalog.length) return;
    opened.current = true;
    for (const s of sources) void sync(s);
  }, [loaded, sources, catalog, sync]);

  const remove = async (source: CustomToolSource) => {
    await customToolStore.saveMany(unsourced(customs, source.id));
    await customToolSourceStore.remove(source.id);
    setMessages((m) => ({ ...m, [source.id]: '' }));
  };

  const saved = (source: CustomToolSource) => {
    opened.current = true; // synced here, not again as the list comes back
    void sync(source);
  };

  if (editing) return <SourceEditor source={editing} isNew={!sources.some((s) => s.id === editing.id)} onClose={() => setEditing(null)} onSaved={saved} />;
  return (
    <section className="custom-sources">
      <p className="hint">
        A URL whose JSON is as exported here (<code>{'{ "customTools": [ … ] }'}</code>), say a file in your team's repository, read
        with the headers and the session you set for it. Synced now and each time this page opens: its new tools come off, one
        that changes its request or code is switched off until you check it, and those no longer in it go. Your header values,
        session and read-only choices stay.
      </p>
      {sources.map((s) => {
        const count = customs.filter((c) => c.source?.id === s.id).length;
        return (
          <div key={s.id} className="source-row">
            <div className="source-head">
              <code className="source-url" title={s.url}>{s.url}</code>
              <span className="spacer" />
              <button onClick={() => attempt(syncNow(s))} disabled={syncing.has(s.id)}>{syncing.has(s.id) ? 'Syncing…' : 'Sync'}</button>
              <button onClick={() => setEditing(s)}>Edit</button>
              <button className="danger" title="Its tools stay, as yours" onClick={() => attempt(remove(s))}>Remove</button>
            </div>
            <div className={s.error ? 'error-text' : 'muted'}>
              {s.error ? `Not synced: ${s.error}` : s.syncedAt ? `${count} tools · synced ${when(s.syncedAt)}` : 'Not synced yet'}
            </div>
            {messages[s.id] && <p className="muted pre-line">{messages[s.id]}</p>}
          </div>
        );
      })}
      {failed && <p className="error-text" role="alert">{failed}</p>}
      <button onClick={() => setEditing({ id: crypto.randomUUID(), enabled: true, url: '' })}>＋ Add a source</button>
    </section>
  );
}

function SourceEditor({ source, isNew, onClose, onSaved }: { source: CustomToolSource; isNew: boolean; onClose: () => void; onSaved: (s: CustomToolSource) => void }) {
  const [draft, setDraft] = useState(source);
  const { failed, attempt } = useAttempt();
  const valid = /^https?:\/\/[^/]+/i.test(draft.url.trim());
  const save = async () => {
    const saved = { ...draft, url: draft.url.trim() };
    // Its site is asked for now, while this is the click (later it no longer is).
    await askOrigins(originPattern(saved.url));
    await customToolSourceStore.save(saved);
    onClose();
    onSaved(saved); // synced at once
  };
  return (
    <section className="editor">
      <h3>{isNew ? 'New source of custom tools' : `Edit ${hostOf(source.url)}`}</h3>
      <Part title="Its URL">
        <label>The JSON's URL (a raw file, not its page in the repository's web)
          <input aria-label="Source URL" className="mono" value={draft.url} placeholder="https://git.example.com/team/tools/raw/main/custom-tools.json"
            onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
        </label>
      </Part>
      <AccessEditor http={{ method: 'GET', url: draft.url, headers: draft.headers, session: draft.session }}
        set={(change) => setDraft({ ...draft, ...('headers' in change && { headers: change.headers }), ...('session' in change && { session: change.session }) })} />
      {!valid && draft.url && <ul className="problems"><li>Its URL starts with https:// and a host.</li></ul>}
      <div className="row">
        <button className="primary" disabled={!valid} onClick={() => attempt(save())}>Save and sync</button>
        <button onClick={onClose}>Cancel</button>
      </div>
      {failed && <p className="error-text" role="alert">{failed}</p>}
    </section>
  );
}
