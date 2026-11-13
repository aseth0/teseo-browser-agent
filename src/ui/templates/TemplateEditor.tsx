import { useMemo, useState } from 'react';
import { templateStore } from '../../templates/store';
import { newView, type PageTemplate, type TemplateView } from '../../templates/types';
import { templateProblems } from '../../templates/validate';
import { CodeArea } from '../CodeArea';
import { BackToList, EditorFooter } from '../Collection';
import { keyOf, patchAt, swapAt } from '../keys';
import { ModelLabel } from '../ToModel';
import { SECTION } from './route';
import { TemplatePreview } from './TemplatePreview';

// When the parts of a site template are sent.
const ON_ITS_PAGES = 'in the note before its data, with every message on its pages (or when you mention it)';
const ON_LOAD = 'only when the model loads the template (templates__load)';
const IN_CATALOG = 'in the system prompt, in the list of your site templates';

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

// A view while it is edited: its paths as typed.
type ViewDraft = Omit<TemplateView, 'paths'> & { pathsText: string };
const toDraft = (v: TemplateView): ViewDraft => ({ name: v.name, description: v.description ?? '', replacePage: v.replacePage, body: v.body, pathsText: v.paths.join('\n') });
const fromDraft = (v: ViewDraft): TemplateView => {
  const description = v.description?.trim();
  return { name: v.name.trim(), paths: lines(v.pathsText), ...(description && { description }), replacePage: v.replacePage, body: v.body };
};

export function TemplateEditor({ template, templates, onClose }: { template: PageTemplate; templates: PageTemplate[]; onClose: () => void }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [matchesText, setMatchesText] = useState(template.matches.join('\n'));
  const [views, setViews] = useState(() => template.views.map(toDraft));
  const [webRead, setWebRead] = useState(!!template.webRead);
  const readOnly = !!template.builtin;
  const isNew = !templates.some((t) => t.id === template.id);
  const { webRead: _was, ...rest } = template;
  const draft: PageTemplate = { ...rest, name: name.trim(), description: description.trim(), matches: lines(matchesText), views: views.map(fromDraft), ...(webRead && { webRead }) };
  // Parsing every view is not free: only when the template changes, not on every render.
  const key = JSON.stringify(draft);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content: draft is a new object on every render
  const problems = useMemo(() => templateProblems(draft, templates), [key, templates]);

  const patchView = (i: number, change: Partial<ViewDraft>) => setViews((vs) => patchAt(vs, i, change));
  const moveView = (i: number, by: number) => setViews((vs) => swapAt(vs, i, by));

  const save = async () => {
    await templateStore.save(draft);
    onClose();
  };

  return (
    <section className="editor">
      <BackToList route={SECTION} title="Site templates" />
      <h3>{readOnly ? template.name : isNew ? 'New site template' : `Edit ${template.name}`}</h3>
      {readOnly && <p className="hint">Built-in templates are read-only. You can enable or disable them from the list, and preview them below.</p>}
      <label><ModelLabel text="Name" when={ON_ITS_PAGES} /><input value={name} disabled={readOnly} placeholder="tasks" onChange={(e) => setName(e.target.value)} /></label>
      <label><ModelLabel text="Description: what it extracts and when it helps" when={IN_CATALOG} />
        <input value={description} disabled={readOnly} placeholder="Tickets of the tracker: key, title, status" onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label><ModelLabel text="Website: URL patterns (one per line)" when={ON_LOAD} />
        <textarea rows={2} className="mono" value={matchesText} disabled={readOnly} placeholder="*://tasks.example.com/*" onChange={(e) => setMatchesText(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={webRead} disabled={readOnly} onChange={(e) => setWebRead(e.target.checked)} />
        Also when the model reads one of its pages with web__read: it gets what this template extracts there instead of the page's
        text (the page as text when the template finds nothing)
      </label>

      <h4>Views</h4>
      <p className="hint">
        On a page, the first view whose paths match the URL is applied: put the most specific first. A view without paths is a block
        that other views insert with <code>{'{% render "name" %}'}</code>.
      </p>
      {views.map((v, i) => (
        <fieldset key={keyOf(v)} className="template-view" aria-label={`View ${v.name || i + 1}`}>
          <div className="row">
            <label className="grow"><ModelLabel text="View name" when={ON_ITS_PAGES} /><input value={v.name} disabled={readOnly} placeholder="project" onChange={(e) => patchView(i, { name: e.target.value })} /></label>
            {!readOnly && (
              <>
                <button disabled={i === 0} title="Move up" onClick={() => moveView(i, -1)}>↑</button>
                <button disabled={i === views.length - 1} title="Move down" onClick={() => moveView(i, 1)}>↓</button>
                <button disabled={views.length === 1} title="Remove this view" onClick={() => setViews((vs) => vs.filter((_, j) => j !== i))}>✕</button>
              </>
            )}
          </div>
          <label><ModelLabel text="Description: what this view extracts (optional)" when={IN_CATALOG} />
            <input value={v.description} disabled={readOnly} placeholder="The ticket: key, title, status, assignee" onChange={(e) => patchView(i, { description: e.target.value })} />
          </label>
          <label><ModelLabel text="Paths (one per line; * matches anything, query included; none: a block for render)" when={ON_LOAD} />
            <textarea rows={2} className="mono" value={v.pathsText} disabled={readOnly} placeholder="/app/project/*" onChange={(e) => patchView(i, { pathsText: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={v.replacePage} disabled={readOnly} onChange={(e) => patchView(i, { replacePage: e.target.checked })} />
            Replace page block: send this view's data instead of the page's visible elements (fewer tokens; the model reads the page
            with a tool when it needs to act). If it finds nothing, the page goes as usual.
          </label>
          <div className="template-body">
            <ModelLabel text="Template" when={`its output, with every message on its pages; the whole template ${ON_LOAD}`} limits={['templateOutput', 'renderDepth']} />
            <CodeArea label={`Template of the view ${v.name || i + 1}`} lang="liquid" rows={10} value={v.body} disabled={readOnly} onChange={(body) => patchView(i, { body })} />
          </div>
        </fieldset>
      ))}
      {!readOnly && <button onClick={() => setViews((vs) => [...vs, toDraft({ ...newView(`view-${vs.length + 1}`), paths: [] })])}>＋ Add view</button>}
      <p className="hint">
        <a href="https://liquidjs.com/tutorials/intro-to-liquid.html" target="_blank" rel="noreferrer">Liquid</a> (
        <code>{'{% for %}'}</code>, <code>{'{% if %}'}</code>, <code>{'{% assign %}'}</code>, <code>{'{{ value | filter }}'}</code>,{' '}
        <code>{'{% render "view" %}'}</code>) with filters that read the page: <code>{'page | select: "li.result"'}</code> (all
        matches; inside a loop, <code>{'r | select: "…"'}</code> searches within <code>r</code>), <code>{'r | one: "h3"'}</code> (the
        first match), <code>{'el | attr: "href"'}</code>, <code>{'page | meta: "og:title"'}</code>,{' '}
        <code>{'page | schema: "@Product:offers.price"'}</code>. Printing an element gives its text. Assign a list before looping over it.
      </p>

      <TemplatePreview template={{ ...draft, name: draft.name || 'draft' }} />

      <EditorFooter problems={problems} readOnly={readOnly} isNew={isNew} onSave={save} onDelete={() => templateStore.remove(template.id)} onClose={onClose} />
    </section>
  );
}
