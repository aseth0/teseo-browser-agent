import { useState } from 'react';
import { templateDiagnosis, templateMessage } from '../../templates/render';
import type { PageTemplate } from '../../templates/types';
import { RawText } from '../PromptSection';
import { useTemplatePreviewTab } from './useTemplatePreviewTab';

// A page opened in a background tab while the editor is open; the template is run on it again
// on every change (no reload), with the view for its URL or the one chosen, and the tab is closed
// when the editor closes.
export function TemplatePreview({ template }: { template: PageTemplate }) {
  const [forced, setForced] = useState(''); // a view name; '': the one for the URL
  const { url, setUrl, tabId, status, result, load, closePage } = useTemplatePreviewTab(template, forced);

  return (
    <div className="template-preview">
      <label>Preview on a page
        <div className="row">
          <input type="url" placeholder="https://video.example.com/results?q=…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button disabled={!url.trim()} onClick={load}>{tabId === undefined ? 'Load' : 'Reload'}</button>
          {tabId !== undefined && <button onClick={closePage}>Close page</button>}
        </div>
      </label>
      <label>View
        <select value={forced} onChange={(e) => setForced(e.target.value)}>
          <option value="">The one for the page's URL</option>
          {template.views.map((v, i) => <option key={`${i}:${v.name}`} value={v.name}>{v.name}</option>)}
        </select>
      </label>
      {status && <p className="hint">{status}</p>}
      {tabId === undefined ? (
        <p className="hint">Loading asks for permission to read the site and keeps it open in a background tab until you close the editor.</p>
      ) : (
        result && (
          <>
            <div className="text-block"><div className="text-block-head"><strong>Diagnosis</strong></div><RawText text={templateDiagnosis(result)} /></div>
            {/* Exactly what goes in the message: the note and the data block. */}
            {result.view && (
              <div className="text-block">
                <div className="text-block-head"><strong>What the model receives</strong></div>
                <RawText text={templateMessage(template.name, result.view.name, result.run)} />
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
