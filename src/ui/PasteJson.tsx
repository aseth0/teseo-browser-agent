import { useState } from 'react';

// The box to paste JSON to import (custom tools, agents): closed once everything in it came in.
export function PasteJson({ label, placeholder, onImport, onClose }: { label: string; placeholder: string; onImport: (json: string) => Promise<boolean>; onClose: () => void }) {
  const [json, setJson] = useState('');
  return (
    <div className="card paste-json">
      <label>{label}
        <textarea rows={6} className="mono" value={json} placeholder={placeholder} onChange={(e) => setJson(e.target.value)} />
      </label>
      <div className="row">
        <button onClick={() => void onImport(json).then((all) => all && onClose())} disabled={!json.trim()}>Import</button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
