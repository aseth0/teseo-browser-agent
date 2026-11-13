// Settings → Shortcuts: every command of the extension with its browser shortcut (global; only the
// browser's shortcuts page sets it: ui/shortcuts) and its key set here (shortcuts/keys), recorded from
// the keys pressed and checked, which the extension's own listeners run in the pages it may read and in
// its own pages (shortcuts/listen).
import { useState, type KeyboardEvent } from 'react';
import { useAttempt } from './useAttempt';
import { captureKindOf } from '../capture/protocol';
import { comboOf, comboProblem, formatCombo, parseBrowserShortcut, type KeyCombo, type ShortcutRow } from '../shortcuts/keys';
import { plural } from '../core/util';
import { isMac, openShortcutsPage, useEverySite, usePageKeys, useShortcuts } from './shortcuts';
import { GoTo, pageIcon } from './text-pages';

// The toolbar button's own command, which the manifest does not describe, and only the browser runs.
const TOOLBAR = '_execute_action';
export const labelOf = (c: { name: string; description: string }) => (c.name === TOOLBAR ? "Open the toolbar button's menu" : c.description || c.name);

// Every command with its browser shortcut, the keys set here, and setting one: here and at the top of
// the sections a command belongs to (SectionTop), the same keys.
export function useShortcutTable() {
  const shortcuts = useShortcuts();
  const [keys, setKey] = usePageKeys();
  const everySite = useEverySite();
  const mac = isMac();
  const rows: ShortcutRow[] = shortcuts.map((c) => ({ name: c.name, label: labelOf(c), browser: parseBrowserShortcut(c.shortcut), page: keys[c.name] }));
  return { shortcuts, keys, setKey, everySite, mac, rows };
}
export type ShortcutTable = ReturnType<typeof useShortcutTable>;

export function ShortcutsSection() {
  const table = useShortcutTable();
  const { shortcuts } = table;
  const unset = shortcuts.filter((c) => !c.shortcut).length;
  return (
    <section>
      <h3 className="title-with-icon"><span className="options-nav-icon" aria-hidden="true">{pageIcon('shortcuts')}</span>Shortcuts</h3>
      <p className="hint">
        Browser shortcuts work everywhere, and only the browser can change them. Keys set here work in the websites the extension can read
        and in its own pages, but not on the browser's pages or in its address bar.
      </p>
      <table className="sites-table shortcuts-table">
        <thead>
          <tr><th>Action</th><th>Browser · everywhere</th><th>In pages · set here</th></tr>
        </thead>
        <tbody>
          {shortcuts.map((c) => (
            <tr key={c.name}>
              <td>{labelOf(c)}</td>
              <td>{c.shortcut ? <kbd>{c.shortcut}</kbd> : <span className="hint">Not set</span>}</td>
              <td>
                {c.name === TOOLBAR ? <span className="hint" title="Only the browser opens the toolbar button's menu">—</span> : <PageKey name={c.name} table={table} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button onClick={() => void openShortcutsPage().catch((e: unknown) => console.error('[shortcuts]', e))}>Open the browser's shortcuts page</button>
        {unset > 0 && <span className="hint">{plural(unset, 'action has', 'actions have')} no browser shortcut</span>}
      </div>
    </section>
  );
}

// A command's key set here, and what it needs to work.
export function PageKey({ name, table: { keys, setKey, everySite, mac, rows } }: { name: string; table: ShortcutTable }) {
  const { failed, attempt } = useAttempt();
  return (
    <>
      <KeyField combo={keys[name]} mac={mac} problemOf={(combo) => comboProblem(combo, name, rows, mac)} onSet={(combo) => attempt(setKey(name, combo))} />
      {failed && <p className="error-text" role="alert">{failed}</p>}
      {keys[name] && captureKindOf(name) && !everySite && (
        <p className="hint">Needs access to every site: <GoTo hash="web-access" title="Website access" /></p>
      )}
    </>
  );
}

// A key set here: a click records the next key pressed with Ctrl, Alt or ⌘ (Esc cancels, leaving it
// does too); one it cannot have says why and is not kept. ✕ clears it.
function KeyField({ combo, mac, problemOf, onSet }: { combo?: KeyCombo; mac: boolean; problemOf: (c: KeyCombo) => string | undefined; onSet: (c: KeyCombo | undefined) => void }) {
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string>();
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) return setRecording(false);
    const pressed = comboOf(e);
    if (!pressed) return; // a modifier alone: still choosing
    setRecording(false);
    const why = problemOf(pressed);
    setProblem(why);
    if (!why) onSet(pressed);
  };
  return (
    <>
      <div className="row key-field">
        <button
          type="button"
          className={`key-recorder${recording ? ' recording' : ''}`}
          data-key-recorder=""
          onClick={() => {
            setProblem(undefined);
            setRecording(!recording);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
        >
          {recording ? 'Press keys · Esc cancels' : combo ? <kbd>{formatCombo(combo, mac)}</kbd> : <span className="hint">Click to set</span>}
        </button>
        {combo && !recording && (
          <button type="button" className="icon-button" aria-label="Clear the key" title="Clear the key" onClick={() => onSet(undefined)}>✕</button>
        )}
      </div>
      {problem && <p className="hint key-problem" role="alert">{problem}</p>}
    </>
  );
}
