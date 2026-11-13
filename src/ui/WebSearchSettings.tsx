// Settings → Web search: the search engine web.search uses (the browser's, or a search URL), how
// many results it returns and whether every search is confirmed first.
import { useState } from 'react';
import { TAB_GROUP_DEFAULTS } from '../page/background-tab';
import { TAB_GROUP_COLORS, type TabGroupSettings, type WebSearchSettings } from '../storage/settings-types';
import { DEFAULT_RESULTS, MAX_RESULTS } from '../web/results';
import type { PatchSectionProps as Props } from './useSettings';
import { NumberField } from './NumberField';
import { SectionTop } from './SectionTop';
import { Switch } from './Collection';
import { SectionHead, SectionTabs, StatStrip } from './SectionParts';

// Engines with a site template that reads their results (templates/*-search).
const ENGINES = [
  { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { label: 'DuckDuckGo (HTML version, without JavaScript)', url: 'https://html.duckduckgo.com/html/?q=%s' },
  { label: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { label: 'Google', url: 'https://www.google.com/search?q=%s' },
];
const BROWSER = '';
const CUSTOM = 'custom';

export function WebSearchSection({ settings, onChange }: Props) {
  const web = settings.webSearch ?? {};
  const set = (change: Partial<WebSearchSettings>) => onChange({ webSearch: { ...web, ...change } });
  const group = { ...TAB_GROUP_DEFAULTS, ...web.tabGroup };
  const setGroup = (change: Partial<TabGroupSettings>) => set({ tabGroup: { ...web.tabGroup, ...change } });
  const known = ENGINES.find((e) => e.url === web.engineUrl);
  const [custom, setCustom] = useState(!!web.engineUrl && !known);
  const choice = custom ? CUSTOM : (known?.url ?? BROWSER);

  const engineName = custom ? 'Your search URL' : known?.label.replace(/ \(.*\)$/, '') ?? "The browser's";
  const search = (
    <ul className="switch-rows web-rows" aria-label="Search">
      <li className="stack">
        <div>
          <strong>Search engine</strong>
          <span className="hint">
            Its results are read with its site template (DuckDuckGo, Bing and Google come with one, in Site templates); with any other, the model gets
            the text of the results page. Searches are kept in the browser&apos;s history like yours
          </span>
        </div>
        <select aria-label="Search engine" value={choice}
          onChange={(e) => {
            setCustom(e.target.value === CUSTOM);
            if (e.target.value !== CUSTOM) set({ engineUrl: e.target.value || undefined });
          }}>
          <option value={BROWSER}>The browser&apos;s search engine (its default)</option>
          {ENGINES.map((e) => <option key={e.url} value={e.url}>{e.label}</option>)}
          <option value={CUSTOM}>Another search URL…</option>
        </select>
        {custom && (
          <input aria-label="Search URL, with %s for the query" className="mono" type="url" placeholder="https://search.example.com/?q=%s" defaultValue={web.engineUrl ?? ''}
            onChange={(e) => set({ engineUrl: e.target.value.includes('%s') ? e.target.value.trim() : undefined })} />
        )}
      </li>
      <li>
        <div><strong>Results per search</strong><span className="hint">1 to {MAX_RESULTS}</span></div>
        <NumberField label="Results per search" className="narrow-input" min={1} max={MAX_RESULTS} value={web.results ?? DEFAULT_RESULTS}
          onSave={(results) => set({ results })} />
      </li>
      <li>
        <div><strong>Ask before each search</strong><span className="hint">The query is sent to the search engine</span></div>
        <Switch checked={web.ask ?? false} label="Ask before each search" onChange={(ask) => set({ ask })} />
      </li>
    </ul>
  );
  const tabs = (
    <>
      <p className="hint">Where web__search and web__read, site mentions and template previews open their pages.</p>
      <ul className="switch-rows web-rows" aria-label="Background tabs">
        <li>
          <div><strong>Muted</strong><span className="hint">A video page does not play aloud while it is read</span></div>
          <Switch checked={web.muteTabs ?? true} label="Muted" onChange={(muteTabs) => set({ muteTabs })} />
        </li>
        <li>
          <div><strong>In a tab group, folded</strong><span className="hint">Vivaldi does not show the tab groups extensions make: there the tabs open next to yours, for a few seconds</span></div>
          <Switch checked={group.enabled} label="In a tab group, folded" onChange={(enabled) => setGroup({ enabled })} />
        </li>
        {group.enabled && (
          <li>
            <div><strong>The group</strong><span className="hint">Its title and color</span></div>
            <span className="row web-group">
              <input aria-label="Group title" className="narrow-input" value={group.title} onChange={(e) => setGroup({ title: e.target.value || undefined })} />
              <select aria-label="Group color" value={group.color} onChange={(e) => setGroup({ color: e.target.value as TabGroupSettings['color'] })}>
                {TAB_GROUP_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </span>
          </li>
        )}
      </ul>
    </>
  );
  return (
    <section className="web-search-settings">
      <SectionHead title="Web search" about={<>
        The model searches with web__search and reads pages with web__read, in a background tab that is closed afterwards: your tabs are not
        touched. The first time it reads a website, you are asked to allow it.
      </>} />
      <StatStrip stats={[
        { label: 'Search engine', value: <span className="stat-text">{engineName}</span>, sub: custom || known ? 'Read with its site template' : 'Its default one' },
        { label: 'Results', value: <>{web.results ?? DEFAULT_RESULTS} <span className="stat-of">per search</span></>, sub: web.ask ? 'Each search asked first' : 'Searched without asking' },
        { label: 'Background tabs', value: <span className="stat-text">{web.muteTabs ?? true ? 'Muted' : 'With sound'}</span>, sub: group.enabled ? `In the group "${group.title}"` : 'Next to yours' },
      ]} />
      <SectionTabs label="Web search" tabs={[
        { id: 'search', label: 'Search', render: () => search },
        { id: 'tabs', label: 'Background tabs', render: () => tabs },
        { id: 'top', label: 'Limits', render: () => <SectionTop page="web-search" /> },
      ]} />
    </section>
  );
}
