// Import ▾ (from a file, from pasted JSON) and Export ▾ (to a file, copied as JSON) for what Settings
// keeps outside its lists of stored items (themes, MCP servers; those lists: ui/collection), with what
// the import did below.
import { writeClip } from './icons';
import { useRef, useState, type ReactNode } from 'react';
import { downloadText } from './download';
import { MenuButton, type MenuItem } from './MenuButton';
import { PasteJson } from './PasteJson';
import { errorText } from '../core/errors';
import { readImportFile } from './import-file';

// What an import of named items did, for importJson: those in (by name), they start off, what else
// to know about them (`notes`), and those left out, with why.
export const imported = (names: string[], skipped: string[], noun: string, then = 'review them and switch them on', notes: string[] = []) => ({
  said: [names.length ? `Imported ${names.join(', ')}: they start off, ${then}.` : `No ${noun} imported.`, ...notes, ...skipped.map((s) => `Left out ${s}`)].join('\n'),
  all: names.length > 0 && !skipped.length,
});

interface Props {
  noun: string; // "skills": what the messages call them
  label?: string; // what the file input and the JSON box are named after ("Skills"); default: the noun
  fileName: string; // of the export
  count: number; // how many there are to export (none: Export off, saying why)
  none?: string; // why there is nothing to export (default: there are none yet)
  exportJson: () => string;
  exportItems?: MenuItem[]; // more in the Export menu, after its own (e.g. a choice of what goes)
  // Imports them; says what it did, and whether everything in the JSON came in.
  importJson: (json: string) => Promise<{ said: string; all: boolean }>;
  placeholder: string; // of the box to paste JSON in
  children?: ReactNode; // buttons first in the row (e.g. "＋ New skill")
}

export function ImportExport({ noun, label = `${noun[0]!.toUpperCase()}${noun.slice(1)}`, fileName, count, none, exportJson, exportItems = [], importJson, placeholder, children }: Props) {
  const [pasting, setPasting] = useState(false);
  const [message, setMessage] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const run = async (json: string) => {
    try {
      const { said, all } = await importJson(json);
      setMessage(said);
      return all;
    } catch (e) {
      setMessage(`Error: ${errorText(e)}`);
      return false;
    }
  };
  return (
    <>
      <div className="row io-row">
        {children}
        <span className="spacer" />
        <MenuButton label="Import" items={[
          { label: 'From file…', onSelect: () => file.current?.click() },
          { label: 'From JSON…', onSelect: () => setPasting(true) },
        ]} />
        <input ref={file} type="file" accept="application/json,.json" hidden aria-label={`${label} file`}
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) void readImportFile(chosen).then(run, (err: unknown) => setMessage(`Error: ${errorText(err)}`));
            e.target.value = ''; // the same file can be chosen again
          }} />
        <MenuButton label="Export" disabled={!count} title={count ? undefined : (none ?? `No ${noun} to export yet.`)} items={[
          { label: 'To file…', onSelect: () => downloadText(fileName, exportJson()) },
          { label: 'To JSON (copy)', onSelect: () => void writeClip(exportJson()).then(() => setMessage(`Copied ${count} ${noun} as JSON.`), (e: unknown) => setMessage(`Error: ${errorText(e)}`)) },
          ...exportItems,
        ]} />
      </div>
      {pasting && <PasteJson label={`${label} JSON (as exported here)`} placeholder={placeholder} onImport={run} onClose={() => setPasting(false)} />}
      {message && <p className={message.startsWith('Error') ? 'error-text' : 'muted pre-line'}>{message}</p>}
    </>
  );
}
