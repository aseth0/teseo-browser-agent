// The box to import from a URL (say a raw file of a repository): its site asked for from the click
// (an optional host permission for that one site), then read without cookies (storage/transfer).
import { useState } from 'react';
import { errorText } from '../../core/errors';
import { hostOf } from '../../core/util';
import { originPattern } from '../../page/permissions';
import { fetchJsonText, rawUrl, urlProblem } from '../../storage/transfer';
import { askOrigins } from '../ask-permission';

export function UrlImport({ placeholder, onRead, onClose }: { placeholder: string; onRead: (json: string, host: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const read = async () => {
    const raw = rawUrl(url);
    const problem = urlProblem(raw);
    if (problem) return setError(problem);
    setError('');
    const origin = originPattern(raw);
    if (!(await askOrigins(origin))) return setError(`Access to ${origin} was not granted.`);
    setReading(true);
    try {
      onRead(await fetchJsonText(raw), hostOf(raw));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReading(false);
    }
  };
  return (
    <div className="card url-import">
      <label>JSON URL (a raw file, or a file's page on GitHub)
        <input className="mono" aria-label="JSON URL" value={url} placeholder={placeholder} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => void (e.key === 'Enter' && url.trim() && read())} />
      </label>
      <p className="hint">The browser asks once for access to that site only. Nothing is sent to it but the request.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row">
        <button disabled={!url.trim() || reading} onClick={() => void read()}>{reading ? 'Reading…' : 'Read it'}</button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
