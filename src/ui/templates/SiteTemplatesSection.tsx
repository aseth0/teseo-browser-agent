// Site templates section of the options page: the sites in a table (on/off, edit), and the editor
// of a site's views with a live preview on a real page (kept open in a background tab while editing).
import { TEXT_DEFS, type TextId } from '../../core/model-texts';
import { ModelTextEditor } from '../EditableText';
import { MentionsFold } from '../MentionsFold';
import { templateStore } from '../../templates/store';
import { newTemplate, type PageTemplate } from '../../templates/types';
import { builtIn, ByModelBadge, CollectionTable, EmptyCollection, FilterBox, NoSuchItem, useFilter } from '../Collection';
import { useCollectionScreen } from '../useCollectionScreen';
import { CollectionIO } from '../collection/CollectionIO';
import { tableSelect, useSelection } from '../collection/selection';
import { exportTemplates, importTemplates } from '../../templates/io';
import { lowlight } from '../../markdown/tree';
import django from 'highlight.js/lib/languages/django';
import { PageModelTexts } from '../PageModelTexts';
import { SECTION } from './route';
import { TemplateEditor } from './TemplateEditor';
import { SectionTop } from '../SectionTop';
import { useState } from 'react';
import { FilterChips, SectionHead, SectionTabs, StatStrip, type ChipTone } from '../SectionParts';
import { autoInjectGlobal } from '../../context/auto-inject';
import { GoTo } from '../text-pages';
import type { SectionProps as Props } from '../useSettings';

// Liquid, colored as Django templates ({% tag %}, {{ value | filter }}): only here, not in the chat.
lowlight.register({ liquid: django });

type TemplateKind = 'mine' | 'builtin' | 'model';
const TEMPLATE_FILTERS: { id: TemplateKind; label: string; tone: ChipTone; is: (t: PageTemplate) => boolean }[] = [
  { id: 'mine', label: 'Yours', tone: 'always', is: (t) => !t.builtin },
  { id: 'builtin', label: 'Built-in', tone: 'plain', is: (t) => !!t.builtin },
  { id: 'model', label: 'By the model', tone: 'match', is: (t) => t.createdBy === 'model' },
];

// Settings → Site templates: every site in a table (on/off, edit), and the editor of one site
// at #site-templates/<id> (#site-templates/new for a new one).
export function SiteTemplatesSection({ settings }: Props) {
  const { items: templates, loaded, target, editing, missing, open, close } = useCollectionScreen(templateStore, { route: SECTION, fresh: newTemplate });
  const { filter, setFilter, matches } = useFilter();
  const [kind, setKind] = useState<TemplateKind | 'all'>('all');
  const selection = useSelection(templates.filter((t) => !t.builtin).map((t) => t.id));

  if (editing) return <TemplateEditor key={editing.id} template={editing} templates={templates} onClose={close} />;
  if (missing) return <NoSuchItem route={SECTION} noun="site template" target={target} />;
  if (target) return null; // still loading

  const searched = templates.filter((t) => matches([t.name, t.description, ...t.matches]));
  const shown = kind === 'all' ? searched : searched.filter(TEMPLATE_FILTERS.find((f) => f.id === kind)!.is);
  const on = templates.filter((t) => t.enabled);
  const sent = autoInjectGlobal(settings, 'templates');
  const list = (
    <>
      <CollectionIO noun={['site template', 'site templates']} label="Site templates" fileName="site-templates.json" items={templates} shown={shown} id={(t) => t.id}
        cannot={builtIn} exportJson={exportTemplates}
        none="Only your site templates are exported: the built-in ones come with the extension. You have none yet."
        placeholder={'{ "templates": [ { "name": "shop", "matches": ["*://shop.example.com/*"], "views": [ … ] } ] }'}
        read={(json) => importTemplates(json, templates)} save={(items) => templateStore.saveMany(items)} selection={selection}>
        <FilterBox label="Filter sites" value={filter} onChange={setFilter} />
        <button onClick={() => open('new')}>＋ New site</button>
      </CollectionIO>
      <FilterChips label="Show the site templates" value={kind} onChange={setKind} total={searched.length}
        filters={TEMPLATE_FILTERS.map((f) => ({ id: f.id, label: f.label, tone: f.tone, count: searched.filter(f.is).length }))} />
      <CollectionTable className="templates-table" rows={shown} rowKey={(t) => t.id} name={(t) => t.name} nameHead="Template" select={tableSelect(selection, builtIn)}
        onOpen={(t) => () => open(t.id)} linkTitle={(t) => (t.builtin ? 'View it (built in: read only)' : 'Edit it')}
        onTitle="On: its data goes with your messages on its websites" isOn={(t) => t.enabled} onToggle={(t, on) => templateStore.update(t.id, { enabled: on })}
        tags={(t) => <>
          {t.builtin && <span className="badge">built-in</span>}
          <ByModelBadge by={t.createdBy} />
          {t.webRead && <span className="badge" title="web.read gives what it extracts">web.read</span>}
        </>}
        columns={[
          { head: 'Websites', className: 'mono', cell: (t) => <span className="row-desc" title={t.matches.join('\n')}>{t.matches.join(', ')}</span> },
          { head: 'Views', cell: (t) => <span title={t.views.map((v) => `${v.name}: ${v.paths.join(', ') || 'block'}`).join('\n')}>{t.views.map((v) => v.name).join(', ')}</span> },
        ]}
        description={(t) => t.description} descriptionTitle={(t) => t.description} />
      <EmptyCollection shown={shown.length} total={templates.length} one="site" many="site templates" loaded={loaded} />
      <p className="hint">
        On a page, the first view whose paths match the URL reads data from the page (Liquid) and sends its output with each of your messages
        (when "Page" is on), with a note telling the model it comes from a template. The model can also test, create and fix them with its{' '}
        <code>templates__</code> tools; saving always asks you first.
      </p>
    </>
  );
  return (
    <section>
      <SectionHead title="Site templates" about="What to read from a website, in views: sent with your messages on its pages, or mentioned with ::site/view." />
      <StatStrip stats={[
        { label: 'Templates', value: templates.length, sub: `${on.length} on · ${templates.filter((t) => t.builtin).length} built-in` },
        { label: 'Website patterns', value: new Set(on.flatMap((t) => t.matches)).size, sub: 'Of the templates switched on' },
        { label: 'Sent on their own', value: <span className="stat-text">{sent ? 'On' : 'Off'}</span>, sub: <>Settings → Auto-inject <GoTo hash="auto-inject" title="Auto-inject" /></> },
      ]} />
      <SectionTabs label="Site templates" tabs={[
        { id: 'list', label: 'Templates', render: () => list },
        { id: 'texts', label: 'Limits and texts', render: () => <><SectionTop page="site-templates" /><MentionTexts /><PageModelTexts page="site-templates" skip={MENTION_TEXTS} /></> },
      ]} />
    </section>
  );
}

// What the model gets when you mention a site in a message (::site/view), editable.
const MENTION_TEXTS = (Object.keys(TEXT_DEFS) as TextId[]).filter((id) => id.startsWith('template.mention') || id === 'template.hidden_tab');

function MentionTexts() {
  return (
    <MentionsFold syntax="::site/view">
      <p className="hint">
        Mention a site in a message with <code>::site/view</code> (or <code>::site</code>: the view for its page). Its data is read from the active tab
        if it is of that site, else from an open tab of the site, else from the view's URL opened in a background tab and closed; and
        attached to the message with these texts.
      </p>
      {MENTION_TEXTS.map((id) => <ModelTextEditor key={id} id={id} />)}
    </MentionsFold>
  );
}
