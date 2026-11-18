// Settings → Tools: what the model can call, by group (offered or not, shown on the chat's tools menu or
// not), each tool edited in a side panel (its description, the replies it sends back, its parameters);
// the tools made on demand, mentions, the texts several tools share, and the limits and shortcuts.
// Deep links: options.html#tools/<tool name>, #tools/shared, #tools/webmcp, #tools/tools.load.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CREATE_TOOLS } from '../core/builder-ids';
import { CHARS_PER_TOKEN } from '../context/budget';
import { SHARED_REPLIES, textIds, toolDescription, toolTextKey, WEBMCP_TEXTS, type TextDef } from '../core/model-texts';
import type { ToolInfo } from '../core/protocol';
import { toolGroup } from '../core/tool-groups';
import { toWireName } from '../core/tool-registry';
import { toOpenAITools } from '../providers/wire';
import type { Settings } from '../storage/settings';
import type { ChatView } from '../storage/settings-types';
import { LOAD_TOOL, offeredOnDemand, onDemandGroups } from '../tools/load';
import { createOnDemand } from '../storage/settings-select';
import { FilterBox, Switch, useFilter } from './Collection';
import { DevtoolsBadge } from './DevtoolsBadge';
import { missingTools } from '../tools/build-tools';
import { FeatureRow } from './FeatureNotice';
import { EditableText, ModelTextEditor, textOverrides } from './EditableText';
import { JsonTree } from './JsonTree';
import { LimitCard, limitChange } from './LimitsSettings';
import { ModelTextsFold } from './PageModelTexts';
import { toSpec } from './request-parts';
import { FilterChips, SectionHead, SectionTabs, StatStrip, type ChipFilter } from './SectionParts';
import { Shortcuts } from './SectionTop';
import { SECTION_TOPS } from './section-tops';
import { GoTo, pageColor } from './text-pages';
import { MenuToggle, toolGroupLabel, useToolCatalogState, withEnabled } from './Tools';
import { useHashTarget } from './useHashTarget';
import { ToolMatchTab } from './ToolMatchTab';
import type { SettingsPatch } from './useSettings';

const toolCardId = (key: string) => `tool-${key}`;
const fmt = (n: number) => n.toLocaleString('en-US');
// What the definitions of these tools take in a request, in tokens (rounded to hundreds).
const toolTokens = (tools: ToolInfo[]) => Math.round(JSON.stringify(toOpenAITools(tools.map(toSpec))).length / CHARS_PER_TOKEN / 100) * 100;

// tools.load's texts: it is in no tool's list (it is made for each run, tools/load).
const LOAD_TEXTS = ['tools.load_description', 'tools.load_group', 'tools.load_create', 'tools.load_builtin', 'tools.load_skills', 'tools.load_first', 'tools.load_mcp_one', 'tools.load_mcp_many', 'tools.load_more', 'result.tools_loaded'] as const;

type Tab = 'tools' | 'matching' | 'demand' | 'mentions' | 'texts' | 'limits';
// The tab a deep link opens.
const tabOf = (target: string): Tab => (target === LOAD_TOOL ? 'demand' : target === SHARED_REPLIES || target === WEBMCP_TEXTS ? 'texts' : 'tools');


const toggle = (list: string[], item: string, shown: boolean) => (shown ? list.filter((x) => x !== item) : [...list, item]);

export function ToolSettings({ settings, onChange }: { settings: Settings; onChange: SettingsPatch }) {
  const { tools, error: unread } = useToolCatalogState();
  const target = useHashTarget('tools');
  const [tab, setTab] = useState<Tab>(() => tabOf(target));
  useEffect(() => setTab(tabOf(target)), [target]);
  const { overrides } = textOverrides(settings, onChange);
  const disabled = new Set(settings.disabledTools ?? []);
  const view = settings.chatView ?? {};
  const onDemand = createOnDemand(settings);

  const offered = tools.filter((t) => !disabled.has(t.name));
  const groupCount = new Set(tools.map(toolGroup)).size;
  const hidden = (view.hiddenTools ?? []).length + (view.hiddenToolGroups ?? []).length;
  const modified = tools.filter((t) => isModified(t.name, overrides));
  // What the group create holds back (tools/load): its tools, and templates.run's drafts.
  const tokens = useMemo(() => {
    if (!tools.length) return undefined;
    const held = offeredOnDemand(offered, [], onDemandGroups({ ...settings, tools: { ...settings.tools, createOnDemand: true }, mcpServers: [] }, offered, { create: true })) as ToolInfo[];
    const create = toolTokens(offered) - toolTokens(held);
    return { every: onDemand ? toolTokens(offered) - create : toolTokens(offered), create };
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worked out again when what is offered changes
    [tools, settings.disabledTools, onDemand]);

  return (
    <section className="tool-settings">
      <SectionHead title="Tools" about={<>
        What the model can call. A tool switched off is not offered; the eye shows or hides it on the chat's tools menu (the wrench)
        without changing that.
      </>} />
      {unread && <p className="error-text" role="alert">The tools could not be listed: {unread}</p>}
      <StatStrip stats={[
        { label: 'Offered', value: <>{offered.length} <span className="stat-of">/ {tools.length}</span></>, sub: `in ${groupCount} groups${hidden ? ` · ${hidden} hidden from the menu` : ''}` },
        { label: 'In every request', value: tokens ? <>~{fmt(tokens.every)} <span className="stat-of">tokens</span></> : '…', sub: 'The definitions of the tools offered' },
        { label: 'On demand', value: <span className="stat-text">{onDemand ? 'On' : 'Off'}</span>, sub: tokens ? `~${fmt(tokens.create)} tokens ${onDemand ? 'less' : 'more'}: the tools that create things` : 'The tools that create things' },
        { label: 'Texts changed', value: modified.length, sub: modified.length ? modified.slice(0, 2).map((t) => toWireName(t.name)).join(', ') + (modified.length > 2 ? '…' : '') : 'As they come' },
      ]} />
      <SectionTabs label="Tools" open={tab} onOpen={(t) => setTab(t as Tab)} tabs={[
        { id: 'tools', label: 'Tools', render: () => <ToolsTab tools={tools} settings={settings} onChange={onChange} target={target} /> },
        { id: 'matching', label: 'Matching', render: () => <ToolMatchTab tools={tools} settings={settings} onChange={onChange} /> },
        { id: 'demand', label: 'On demand', render: () => <OnDemandTab settings={settings} onChange={onChange} tokens={tokens?.create} /> },
        { id: 'mentions', label: 'Mentions', render: () => <MentionsTab settings={settings} onChange={onChange} /> },
        { id: 'texts', label: 'Shared texts', render: () => <SharedTextsTab target={target} /> },
        { id: 'limits', label: 'Limits and shortcuts', render: () => <LimitsTab settings={settings} onChange={onChange} /> },
      ]} />
    </section>
  );
}

// Whether the description of a tool, or a text it replies with, was changed.
const isModified = (name: string, overrides: Record<string, string>) =>
  overrides[toolTextKey(name)] !== undefined || textIds((d: TextDef) => d.tool === name).some((id) => overrides[id] !== undefined);

type Shown = ToolInfo['effect'] | 'hidden' | 'modified' | 'off';
const ALL = '*'; // the group "All tools"

// Settings → Tools → Tools: the groups on the left (as the chat's tools menu groups them; one seen
// before, a website's or a server's, is listed even when its tools are not here, so that it can be
// hidden from the menu beforehand), a group's tools on the right, and the tool opened in a side panel.
// The filter and the chips look in every group.
function ToolsTab({ tools, settings, onChange, target }: { tools: ToolInfo[]; settings: Settings; onChange: SettingsPatch; target: string }) {
  const { overrides } = textOverrides(settings, onChange);
  const disabled = new Set(settings.disabledTools ?? []);
  const view = settings.chatView ?? {};
  const setView = (change: Partial<ChatView>) => onChange({ chatView: { ...view, ...change } });
  const hiddenTools = view.hiddenTools ?? [];
  const hiddenGroups = view.hiddenToolGroups ?? [];
  const setEnabled = (names: string[], enabled: boolean) => onChange({ disabledTools: withEnabled(disabled, names, enabled) });

  const byGroup = Object.groupBy(tools, toolGroup);
  const groupIds = [...new Set([...Object.keys(byGroup), ...(view.seenToolGroups ?? []), ...missingTools().map((t) => t.group)])];
  const linked = tools.find((t) => t.name === target);
  const [group, setGroup] = useState(() => (linked ? toolGroup(linked) : groupIds[0] ?? ALL));
  const [open, setOpen] = useState<string | undefined>(linked?.name);
  const { filter, setFilter, matches } = useFilter();
  const [shown, setShown] = useState<Shown | 'all'>('all');

  // A link to a tool: its group, its row in view, and its side panel open (once the catalog is there).
  useEffect(() => {
    if (!linked) return;
    setGroup(toolGroup(linked));
    setOpen(linked.name);
    requestAnimationFrame(() => document.getElementById(toolCardId(linked.name))?.scrollIntoView({ block: 'center' }));
  }, [linked?.name]); // eslint-disable-line react-hooks/exhaustive-deps -- when the link changes only

  const passes = (t: ToolInfo) =>
    (shown === 'all' || t.effect === shown || (shown === 'hidden' && hiddenTools.includes(t.name)) || (shown === 'modified' && isModified(t.name, overrides)) || (shown === 'off' && disabled.has(t.name))) &&
    matches([toWireName(t.name), toolDescription(t.name, t.description)]);
  const filtering = !!filter || shown !== 'all';
  // The tools this build lacks (tools/build-tools), by group: listed greyed, never offered. Not while
  // filtering: they are no tool of this build.
  const lacked = Object.groupBy(filtering ? [] : missingTools(), (t) => t.group);
  const lackedIn = (group: string) => lacked[group] ?? [];
  const count = (f: (t: ToolInfo) => boolean) => tools.filter(f).length;
  const chips: ChipFilter<Shown>[] = [
    { id: 'read', label: 'Read', tone: 'site', count: count((t) => t.effect === 'read') },
    { id: 'write', label: 'Write', tone: 'match', count: count((t) => t.effect === 'write') },
    { id: 'interact', label: 'Interact', tone: 'title', count: count((t) => t.effect === 'interact') },
    { id: 'off', label: 'Off', tone: 'plain', count: count((t) => disabled.has(t.name)) },
    { id: 'hidden', label: 'Hidden from menu', tone: 'plain', count: count((t) => hiddenTools.includes(t.name)) },
    { id: 'modified', label: 'Modified', tone: 'always', count: count((t) => isModified(t.name, overrides)) },
  ];

  // What the right side lists: the matches in every group while filtering, else the chosen group (or all).
  const sets: [string, ToolInfo[]][] = filtering
    ? groupIds.map((g): [string, ToolInfo[]] => [g, (byGroup[g] ?? []).filter(passes)]).filter(([, list]) => list.length)
    : group === ALL ? groupIds.map((g) => [g, byGroup[g] ?? []]) : [[group, byGroup[group] ?? []]];
  const listed = sets.flatMap(([, list]) => list);
  const on = listed.filter((t) => !disabled.has(t.name)).length;
  const one = !filtering && group !== ALL ? group : undefined;
  const openTool = tools.find((t) => t.name === open);

  const groupItem = (id: string, list: ToolInfo[], label: string) => {
    const offered = list.filter((t) => !disabled.has(t.name)).length;
    const hits = list.filter(passes).length;
    return (
      <button key={id} type="button" className={`tool-group-item${!filtering && group === id ? ' on' : ''}${filtering && !hits ? ' none' : ''}`} aria-current={!filtering && group === id ? 'true' : undefined}
        onClick={() => { setGroup(id); setFilter(''); setShown('all'); }}>
        <span>{label}</span>
        <span className="tool-group-count">{filtering ? `${hits} found` : list.length ? `${offered}/${list.length}` : '–'}</span>
        <span className="tool-group-bar" aria-hidden="true"><i style={{ width: `${list.length ? (offered / list.length) * 100 : 0}%` }} /></span>
      </button>
    );
  };

  return (
    <>
      <div className="row tools-toolbar">
        <FilterBox label="Filter tools by name or description" value={filter} onChange={setFilter} />
        <FilterChips<Shown> label="Show" value={shown} onChange={setShown} total={tools.length} filters={chips} />
      </div>
      <div className="tools-layout">
        <nav className="tool-groups" aria-label="Tool groups">
          {groupItem(ALL, tools, 'All tools')}
          {groupIds.map((g) => groupItem(g, byGroup[g] ?? [], toolGroupLabel(g)))}
        </nav>
        <div className="tool-pane">
          <div className="tool-pane-head">
            <h4>{filtering ? `${listed.length} found` : one ? toolGroupLabel(one) : 'All tools'}</h4>
            <span className="hint">{on}/{listed.length} offered</span>
            {listed.length > 0 && <Switch checked={on > 0} label={`Offer every tool of ${one ? toolGroupLabel(one) : 'this list'}`} onChange={(to) => setEnabled(listed.map((t) => t.name), to)} />}
            {one && <MenuToggle shown={!hiddenGroups.includes(one)} what={toolGroupLabel(one)} onToggle={(to) => setView({ hiddenToolGroups: toggle(hiddenGroups, one, to) })} />}
          </div>
          {one && !listed.length && !lackedIn(one).length && <p className="hint tool-pane-empty">Its tools are listed while you are on that website (or the server is connected).</p>}
          {filtering && !listed.length && <p className="hint tool-pane-empty">No tool matches.</p>}
          {sets.map(([g, list]) => (
            <div key={g}>
              {sets.length > 1 && (list.length > 0 || lackedIn(g).length > 0) && <div className="tool-pane-group">{toolGroupLabel(g)}</div>}
              {list.map((t) => (
                <div key={t.name} id={toolCardId(t.name)} className={`tool-line${disabled.has(t.name) ? ' off' : ''}${open === t.name ? ' open' : ''}`}
                  role="button" tabIndex={0} aria-label={`${toWireName(t.name)}: edit`} onClick={() => setOpen(t.name)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(t.name); } }}>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Switch checked={!disabled.has(t.name)} label={`${toWireName(t.name)}: offered`} onChange={(to) => setEnabled([t.name], to)} />
                  </span>
                  <span className="tool-line-main">
                    <span className="item-name tool-name">{toWireName(t.name)}</span>
                    <span className="tool-line-desc">{toolDescription(t.name, t.description)}</span>
                  </span>
                  <span className="row-tags">
                    {isModified(t.name, overrides) && <span className="badge accent">modified</span>}
                    <span className={`badge ${t.effect}`}>{t.effect}</span>
                    {t.via === 'devtools' && <DevtoolsBadge />}
                  </span>
                  <MenuToggle shown={!hiddenTools.includes(t.name)} what={toWireName(t.name)} onToggle={(to) => setView({ hiddenTools: toggle(hiddenTools, t.name, to) })} />
                  <span className="tool-line-open" aria-hidden="true">›</span>
                </div>
              ))}
              {lackedIn(g).map((t) => (
                <FeatureRow key={t.name} as="div" className="tool-line off" id={t.feature} name={<span className="item-name tool-name">{toWireName(t.name)}</span>} about={t.about} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {openTool && (
        <ToolPanel tool={openTool} settings={settings} onChange={onChange} onClose={() => setOpen(undefined)}
          offered={!disabled.has(openTool.name)} onOffer={(to) => setEnabled([openTool.name], to)}
          inMenu={!hiddenTools.includes(openTool.name)} onMenu={(to) => setView({ hiddenTools: toggle(hiddenTools, openTool.name, to) })} />
      )}
    </>
  );
}

// A field being typed in: Escape there leaves the field, its text kept, and does not close the panel.
const typingIn = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement =>
  (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type))) && !!el.value;

// A tool in the side panel: offered or not, on the menu or not, its description, the texts it replies
// with and its parameters. Escape or × closes it; an Escape in a field with text only leaves the
// field. The focus goes into it when it opens and back to the tool's row when it closes.
export function ToolPanel({ tool: t, settings, onChange, onClose, offered, onOffer, inMenu, onMenu }: {
  tool: ToolInfo;
  settings: Settings;
  onChange: SettingsPatch;
  onClose: () => void;
  offered: boolean;
  onOffer: (on: boolean) => void;
  inMenu: boolean;
  onMenu: (on: boolean) => void;
}) {
  const { overrides, setOverride } = textOverrides(settings, onChange);
  const name = toWireName(t.name);
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (typingIn(e.target) && drawer.current?.contains(e.target)) return drawer.current.focus();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    drawer.current?.focus();
    return () => document.getElementById(toolCardId(t.name))?.focus();
  }, [t.name]);
  const replies = textIds((d: TextDef) => d.tool === t.name);
  return (
    <aside className="tool-drawer" role="dialog" aria-label={name} tabIndex={-1} ref={drawer}>
      <header className="tool-drawer-head">
        <div>
          <h4 className="item-name">{name}</h4>
          <span className="row-tags"><span className={`badge ${t.effect}`}>{t.effect}</span>{t.via === 'devtools' && <DevtoolsBadge />}</span>
        </div>
        <button className="icon-button" title="Close" aria-label={`Close ${name}`} onClick={onClose}>✕</button>
      </header>
      <ul className="switch-rows" aria-label={`${name}: offered and shown`}>
        <li><div><strong>Offered to the model</strong></div><Switch checked={offered} label={`${name}: offered to the model`} onChange={onOffer} /></li>
        <li><div><strong>Shown on the chat's tools menu</strong><span className="hint">Still offered when hidden</span></div><Switch checked={inMenu} label={`${name}: shown on the chat's tools menu`} onChange={onMenu} /></li>
      </ul>
      <EditableText label="Description" when={null} note="What the model reads to decide when to call it." defaultText={t.description}
        value={overrides[toolTextKey(t.name)]} onSave={(v) => setOverride(toolTextKey(t.name), v)} color={pageColor('tools')} />
      {replies.map((id) => <ModelTextEditor key={id} id={id} />)}
      {replies.some((id) => id.startsWith('action.')) && (
        <p className="hint">Its reply also uses the <a href={`#tools/${SHARED_REPLIES}`}>replies shared by every page action</a>.</p>
      )}
      <details className="text-block">
        <summary>Parameters (not editable: the tool's contract)</summary>
        <JsonTree value={t.inputSchema} />
      </details>
    </aside>
  );
}

// Settings → Tools → On demand: the tools that create things given only once the model asks for them
// (tools.load), what that saves, and tools.load's texts.
function OnDemandTab({ settings, onChange, tokens }: { settings: Settings; onChange: SettingsPatch; tokens?: number }) {
  const on = createOnDemand(settings);
  return (
    <>
      <ul className="switch-rows" aria-label="On demand">
        <li>
          <div>
            <strong>Tools that create things on demand</strong>
            <span className="hint">The model gets them only once it asks for them (tools.load){tokens ? `: about ${fmt(tokens)} tokens less in every request` : ''}. Off: always offered.</span>
          </div>
          <Switch checked={on} label="Tools that create things on demand" onChange={(createOnDemand) => onChange({ tools: { ...settings.tools, createOnDemand } })} />
        </li>
      </ul>
      <div className="section-subhead"><h4>The tools that create things</h4><span className="hint">{CREATE_TOOLS.length} tools</span></div>
      <p className="tool-names">{CREATE_TOOLS.map((n) => <code key={n}>{toWireName(n)}</code>)}</p>
      {on && (
        <ModelTextsFold ids={LOAD_TEXTS} id={toolCardId(LOAD_TOOL)} open when="tools.load's description and reply, each when its tag says"
          hint="What the model reads about tools.load and gets back from it. They are edited only here: tools.load is made for each run, so Prompt preview does not list them." />
      )}
    </>
  );
}

// Settings → Tools → Mentions: $tool.name in a message, and forcing the model to call it.
function MentionsTab({ settings, onChange }: { settings: Settings; onChange: SettingsPatch }) {
  return (
    <>
      <p className="hint">
        Mention a tool in a message with <code>$tool.name</code> to ask the model to use it; a tool that is off is offered for that message
        (switch mentions off in <a href="#auto-inject">Auto-inject → Mentions</a>).
      </p>
      <ul className="switch-rows" aria-label="Mentions">
        <li>
          <div>
            <strong>Force the mentioned tool</strong>
            <span className="hint">The model's first call must be it (any of them, when several). Some servers or models refuse this: it is then only asked for</span>
          </div>
          <Switch checked={settings.mentions?.forceTool ?? false} label="Force the mentioned tool" onChange={(forceTool) => onChange({ mentions: { ...settings.mentions, forceTool } })} />
        </li>
      </ul>
      <ModelTextEditor id="tool.mention" />
    </>
  );
}

// Settings → Tools → Shared texts: the replies every page action shares, and what wraps the tools
// websites offer (WebMCP).
function SharedTextsTab({ target }: { target: string }) {
  const texts = (owner: string): ReactNode => textIds((d: TextDef) => d.tool === owner).map((id) => <ModelTextEditor key={id} id={id} />);
  return (
    <>
      <p className="hint">Texts several tools send back to the model.</p>
      <details id={toolCardId(SHARED_REPLIES)} className="tool-card" open={target === SHARED_REPLIES || undefined}>
        <summary><strong>Replies shared by every page action</strong></summary>
        <div className="tool-card-body">{texts(SHARED_REPLIES)}</div>
      </details>
      <details id={toolCardId(WEBMCP_TEXTS)} className="tool-card" open={target === WEBMCP_TEXTS || undefined}>
        <summary><strong>Tools offered by websites (WebMCP)</strong></summary>
        <div className="tool-card-body">
          <p className="hint">Websites register these tools themselves; these texts wrap what the website writes.</p>
          {texts(WEBMCP_TEXTS)}
        </div>
      </details>
    </>
  );
}

// Settings → Tools → Limits and shortcuts: the capture shortcuts, the tools' main limits as cards (as
// in Settings → Limits), and how many more there are.
function LimitsTab({ settings, onChange }: { settings: Settings; onChange: SettingsPatch }) {
  const { shortcuts = [], limits = [], more = [] } = SECTION_TOPS.tools!;
  const set = settings.limits ?? {};
  const change = limitChange(settings, onChange);
  return (
    <>
      <div className="section-subhead"><h4>Shortcuts</h4><GoTo hash="shortcuts" title="Shortcuts" /></div>
      <div className="section-top tool-shortcuts"><Shortcuts names={shortcuts} /></div>
      <div className="section-subhead"><h4>✂ Limits</h4><GoTo hash="limits" title="Limits" /></div>
      <div className="limit-cards">{limits.map((id) => <LimitCard key={id} id={id} set={set} change={change} from="tools" />)}</div>
      <p className="hint">And {more.length} more of the browser tools and WebMCP: in <a href="#limits">Limits → What the model reads</a>.</p>
    </>
  );
}
