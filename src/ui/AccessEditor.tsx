// What a request goes with (a custom tool's, a script's, a source of custom tools'): its headers, the
// browser's session, and whether it only reads; in a framed part of an editor.
import { useState } from 'react';
import { cookiesIn, type HttpRequest } from '../tools/http';
import { keyOf, patchAt } from './keys';
import { withMember } from './edits';

// What its requests go with: the headers (yours only: the model never sees their values), the
// browser's session, and whether it only reads (`readsLabel`, when it may: then it is not confirmed).
// `bare`: without its own frame, inside another part (a script's site).
export function AccessEditor({ http, set, readsLabel, bare }: { http: HttpRequest; set: (change: Partial<HttpRequest>) => void; readsLabel?: string; bare?: boolean }) {
  const headers = http.headers ?? [];
  const setHeader = (i: number, change: Partial<{ name: string; value: string }>) => set({ headers: patchAt(headers, i, change) });
  const [shown, setShown] = useState<Set<string>>(new Set()); // the headers (keyOf) whose values show as they are
  // A value made from cookies ({{cookie:NAME}}) holds no key of yours: shown; any other, hidden until asked.
  const plain = (value: string) => !value || cookiesIn(value).length > 0;
  return (
    <Frame bare={bare} title="What it sends: headers and your session">
      <div className="field-label">Headers (yours only: the model never sees them; put API keys here)</div>
      {headers.map((h, i) => {
        const key = keyOf(h);
        const visible = shown.has(key) || plain(h.value);
        const label = h.name || 'the header';
        return (
          <div key={key} className="custom-param-head">
            <input aria-label="Header name" className="mono narrow-input" value={h.name} placeholder="Authorization" onChange={(e) => setHeader(i, { name: e.target.value })} />
            <input aria-label={`Value of ${label}`} className="mono http-url" type={visible ? 'text' : 'password'} value={h.value} placeholder="Bearer …" onChange={(e) => setHeader(i, { value: e.target.value })} />
            {plain(h.value) ? (
              <span className="icon-button placeholder" aria-hidden="true">👁</span> // keeps the rows aligned
            ) : (
              <button className="icon-button" title={visible ? 'Hide the value' : 'Show the value'} aria-label={`${visible ? 'Hide' : 'Show'} the value of ${label}`}
                onClick={() => setShown((s) => withMember(s, key))}>{visible ? '🙈' : '👁'}</button>
            )}
            <button className="icon-button warn" title="Remove" aria-label={`Remove ${label}`} onClick={() => set({ headers: headers.filter((_, j) => j !== i) })}>✕</button>
          </div>
        );
      })}
      <button className="custom-add" onClick={() => set({ headers: [...headers, { name: '', value: '' }] })}>＋ Add a header</button>
      <label className="check">
        <input type="checkbox" checked={!!http.session} onChange={(e) => set({ session: e.target.checked || undefined })} /> Send the browser's session for this site
      </label>
      {readsLabel && (
        <label className="check" title="Then it is not confirmed, as a read; and the page widget may run it on page load">
          <input type="checkbox" checked={!!http.readOnly} onChange={(e) => set({ readOnly: e.target.checked || undefined })} /> {readsLabel}: it runs without asking,
          and actions on page load may use it
        </label>
      )}
      <details className="settings-fold">
        <summary>Signed in as you, without a key</summary>
        <p className="hint">
        Instead of a key: the request goes with your cookies for the API's site, signed in as you, while you are signed in
        there in this browser (the site need not be open). Only you can turn it on. Some APIs want a header too
        (Mattermost: <code>X-Requested-With: XMLHttpRequest</code>), and on a POST the CSRF token from one of the site's
        cookies, written <code>{'{{cookie:NAME}}'}</code> in a header's value (Mattermost: <code>X-CSRF-Token: {'{{cookie:MMCSRF}}'}</code>).
        </p>
      </details>
    </Frame>
  );
}

const Frame = ({ bare, title, children }: { bare?: boolean; title: string; children: React.ReactNode }) =>
  bare ? <div className="access-bare">{children}</div> : <Part title={title}>{children}</Part>;

// A framed part of the editor, with its title.
export function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="editor-part">
      <h4 className="editor-part-title">{title}</h4>
      {children}
    </section>
  );
}
