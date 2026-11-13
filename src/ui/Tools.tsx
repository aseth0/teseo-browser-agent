// Tool catalog (owned by the background) with per-tool "offer to the model" toggles.
import { Icon } from './chat-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../core/errors';
import { LIST_TOOLS, TOOLS_CHANGED, type ToolInfo } from '../core/protocol';
import { onRuntime, sendRuntime } from '../core/runtime';
import { toolGroup } from '../core/tool-groups';
import type { Settings } from '../storage/settings';
import { customToolStore } from '../tools/custom/store';
import { DevtoolsBadge } from './DevtoolsBadge';
import { EYE_ICON, EYE_OFF_ICON, IconButton } from './icons';
import { openOptions } from './open-options';
import { Popover } from './Popover';
import type { SettingsPatch } from './useSettings';
import { withMember } from './edits';

// The tool catalog; with a tabId, plus the tools that page offers (WebMCP). `refresh` (e.g. the
// tab's URL and the MCP servers) only triggers a new one when it changes.
export const useToolCatalog = (tabId?: number, refresh?: string): ToolInfo[] => useToolCatalogState(tabId, refresh).tools;

// The same, with why it could not be read: the last one read stays (none at first).
export function useToolCatalogState(tabId?: number, refresh?: string): { tools: ToolInfo[]; error?: string } {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true;
    let asked = 0; // only the latest read applies: an older one may come after it
    const load = () => {
      const n = ++asked;
      const latest = () => current && n === asked;
      return sendRuntime({ type: LIST_TOOLS, tabId }).then(
        (reply) => {
          if (!latest()) return;
          if (reply && 'error' in reply) return setError(reply.error);
          setTools(reply?.tools ?? []);
          setError(undefined);
        },
        (e: unknown) => {
          console.warn('[tool-catalog]', e);
          if (latest()) setError(errorText(e));
        },
      );
    };
    // Again when an MCP server that was still connecting is in, and when the custom tools change
    // (saved in Settings, synced from a source).
    void load();
    const offChanged = onRuntime(TOOLS_CHANGED, () => void load());
    const offStored = customToolStore.onChanged(() => void load());
    return () => {
      current = false;
      offChanged();
      offStored();
    };
  }, [tabId, refresh]);
  return { tools, error };
}


// A group of a website's or a server's tools ("webmcp:<host>", "mcp:<server>"): remembered once seen.
export const isOfferedGroup = (group: string) => /^(webmcp|mcp):/.test(group);

const GROUP_LABELS: Record<string, string> = {
  browser: 'Browser',
  user: 'User (questions, picking, plan)',
  history: 'History (saved conversations)',
  memory: 'Memory',
  bookmarks: 'Bookmarks',
  web: 'Web (search and read)',
  custom: 'Custom tools (yours)',
  agents: 'Agents',
  speech: 'Speech (read aloud)',
  skills: 'Skills',
  'site-templates': 'Site templates',
  webmcp: 'WebMCP (offered by the page)',
  mcp: 'MCP servers',
  site: 'Site adapters',
};

export function toolGroupLabel(group: string): string {
  const [kind, name] = group.split(/:(.*)/);
  if (name && kind === 'webmcp') return `WebMCP · ${name}`;
  if (name && kind === 'mcp') return `MCP · ${name}`;
  if (name && kind === 'custom') return name;
  return GROUP_LABELS[group] ?? group;
}

interface Props {
  tools: ToolInfo[];
  settings: Settings;
  onChange: SettingsPatch;
  onDemand?: string[]; // offered once the model loads them (tools/load)
}

// Shown or not on the chat's tools menu (🔧): an eye, saying so on hover. Hiding only takes it off
// the menu; whether the model gets the tools is the checkbox's.
export function MenuToggle({ shown, what, onToggle }: { shown: boolean; what: string; onToggle: (shown: boolean) => void }) {
  return (
    // Not toggling the card it sits in.
    <span className="menu-toggle" onClick={(e) => e.stopPropagation()}>
      <IconButton
        label={`${what}: ${shown ? 'shown on the chat menu (click to hide it there; it is still offered)' : 'hidden from the chat menu (click to show it)'}`}
        icon={shown ? EYE_ICON : EYE_OFF_ICON}
        onClick={() => onToggle(!shown)}
      />
    </span>
  );
}

// How the tool lists show their groups (the chat's menu, Settings → Tools): folded, each opened or
// folded by its name; its read / write / interact filter shows only those of its tools (and opens it).
export function useToolGroups() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Record<string, ToolInfo['effect'] | undefined>>({});
  const isOpen = (id: string) => open.has(id);
  const toggle = (id: string, to = !isOpen(id)) => setOpen((o) => withMember(o, id, to));
  const setFilter = (id: string, effect: ToolInfo['effect']) => {
    const off = filters[id] === effect;
    setFilters((f) => ({ ...f, [id]: off ? undefined : effect }));
    if (!off) toggle(id, true);
  };
  const listed = <T extends Pick<ToolInfo, 'effect'>>(id: string, group: T[]) => (filters[id] ? group.filter((t) => t.effect === filters[id]) : group);
  return { isOpen, toggle, filterOf: (id: string) => filters[id], setFilter, listed };
}

// A group's line: its checkbox offers every tool of it (or those the filter shows), the name folds
// or opens it, then how many are offered and the effect filter when it mixes effects.
export function ToolGroupHead(props: {
  id: string;
  group: Pick<ToolInfo, 'name' | 'effect'>[];
  view: ReturnType<typeof useToolGroups>;
  disabled: Set<string>;
  onEnable: (names: string[], enabled: boolean) => void;
  children?: ReactNode; // after the filter (e.g. the eye of Settings → Tools)
}) {
  const { id, group, view, disabled } = props;
  const label = toolGroupLabel(id);
  const filter = view.filterOf(id);
  const names = view.listed(id, group).map((t) => t.name);
  const on = names.filter((n) => !disabled.has(n)).length;
  const effects = [...new Set(group.map((t) => t.effect))];
  return (
    <div className="tools-group-title">
      <input
        type="checkbox"
        aria-label={`Offer ${filter ? `the ${filter} tools` : 'every tool'} of ${label}`}
        checked={on === names.length}
        ref={(el) => {
          if (el) el.indeterminate = on > 0 && on < names.length; // some tools of the group offered
        }}
        onChange={(e) => props.onEnable(names, e.target.checked)}
      />
      <button className="tools-group-toggle" aria-expanded={view.isOpen(id)} onClick={() => view.toggle(id)}>
        {view.isOpen(id) ? '▾' : '▸'} {label}
      </button>
      <span className="tools-group-count">{on}/{names.length}</span>
      {effects.length > 1 && (
        <span className="tools-group-filter" role="group" aria-label={`Show only some tools of ${label}`}>
          {effects.map((effect) => (
            <button key={effect} className={`badge ${effect}`} aria-pressed={filter === effect} title={`Only its ${effect} tools`} onClick={() => view.setFilter(id, effect)}>
              {effect}
            </button>
          ))}
        </span>
      )}
      {props.children}
    </div>
  );
}

// The tools switched off once `names` are switched on or off, sorted (as the settings keep them).
export function withEnabled(disabled: Iterable<string>, names: string[], enabled: boolean): string[] {
  const next = new Set(disabled);
  for (const n of names) enabled ? next.delete(n) : next.add(n);
  return [...next].sort();
}

// `disabled`: the tools switched off; `hidden`: what the menu leaves out (Settings → Tools, the eye);
// those tools stay as they are. Groups come folded, one alone too (an MCP server's, on its button).
export function ToolsList({ tools, disabled: off, onDisabled, hidden, onDemand = [] }: {
  tools: ToolInfo[];
  disabled: string[];
  onDisabled: (disabled: string[]) => void;
  hidden?: { groups: string[]; tools: string[] };
  onDemand?: string[];
}) {
  const disabled = new Set(off);
  const setEnabled = (names: string[], enabled: boolean) => onDisabled(withEnabled(disabled, names, enabled));
  const shown = tools.filter((t) => !hidden?.tools.includes(t.name));
  const groups = (Object.entries(Object.groupBy(shown, toolGroup)) as [string, ToolInfo[]][]).filter(([group]) => !hidden?.groups.includes(group));
  const view = useToolGroups();

  if (!tools.length) return <p className="hint">No tools available.</p>;
  return (
    <div className="tools-list">
      {groups.map(([groupId, group]) => (
        <div key={groupId} className="tools-group">
          <ToolGroupHead id={groupId} group={group} view={view} disabled={disabled} onEnable={setEnabled} />
          {view.isOpen(groupId) &&
            view.listed(groupId, group).map((t) => (
              <label key={t.name} className="tool-row" title={t.description}>
                <input type="checkbox" checked={!disabled.has(t.name)} onChange={(e) => setEnabled([t.name], e.target.checked)} />
                <span className="tool-name">{t.name}</span>
                {/* The row is a grid of four cells: its tags share one. */}
                <span className="row-tags">
                  <span className={`badge ${t.effect}`}>{t.effect}</span>
                  {t.via === 'devtools' && <DevtoolsBadge />}
                  {onDemand.includes(t.name) && <span className="on-demand-tag" title="Offered once the model loads them (tools.load)">on demand</span>}
                </span>
                <span className="tool-desc">{t.description}</span>
              </label>
            ))}
        </div>
      ))}
    </div>
  );
}

// Compact button with the enabled/total count; opens the list above the composer, without what is
// hidden from it in Settings → Tools (those tools are still offered as they are). The MCP servers'
// tools have their own button (McpButton).
export function ToolsButton(props: Props) {
  return <CatalogButton {...props} tools={props.tools.filter((t) => t.source !== 'mcp')} icon={<Icon name="tool" />} what="Tools" />;
}

// One button for the enabled MCP servers, each one's tools a group (folded, as the tools menu's);
// named after the server when there is only one. A server that offers none was not reached.
export function McpButton(props: Props) {
  const servers = (props.settings.mcpServers ?? []).filter((s) => s.enabled);
  if (!servers.length) return null;
  const tools = props.tools.filter((t) => t.source === 'mcp');
  const unreached = servers.filter((s) => !tools.some((t) => toolGroup(t) === `mcp:${s.name}`)).map((s) => s.name);
  const name = servers.length === 1 ? servers[0]!.name : 'MCP';
  return (
    <CatalogButton {...props} tools={tools} icon={<Icon name="mcp" />} what={servers.length === 1 ? `MCP · ${name}: tools` : 'MCP servers\' tools'} name={name} warn={unreached.length > 0}>
      {unreached.length > 0 && (
        <p className="hint">
          <Icon name="error" size={12} /> No tools from {unreached.join(', ')}: not reached, or waiting for you to sign in. See {unreached.length === 1 ? 'its' : 'their'} logs in{' '}
          <a href="#" onClick={(e) => {
            e.preventDefault();
            void openOptions('mcp');
          }}>Settings → MCP servers</a>.
        </p>
      )}
    </CatalogButton>
  );
}

// `name`: shown on the button (the MCP servers'); `warn`: some of them offer nothing.
function CatalogButton(props: Props & { icon: ReactNode; what: string; name?: string; warn?: boolean; children?: ReactNode }) {
  const enabled = props.tools.filter((t) => !(props.settings.disabledTools ?? []).includes(t.name)).length;
  const view = props.settings.chatView ?? {};
  const hidden = { groups: view.hiddenToolGroups ?? [], tools: view.hiddenTools ?? [] };
  const hiddenHere = props.tools.filter((t) => hidden.groups.includes(toolGroup(t)) || hidden.tools.includes(t.name)).length;
  const note = hiddenHere ? ` · ${hiddenHere} hidden from this menu` : '';
  return (
    <Popover title={`${props.what} offered to the model${note}`} className="tools-count" label={<>{props.icon}{props.name ? ` ${props.name}` : ''} {props.tools.length ? <>{enabled}/{props.tools.length}{props.warn && <> <Icon name="error" size={12} /></>}</> : <Icon name="error" size={12} />}</>}>
      {() => (
        <>
          <ToolsList tools={props.tools} disabled={props.settings.disabledTools ?? []} onDisabled={(d) => props.onChange({ disabledTools: d })}
            hidden={hidden} onDemand={props.onDemand} />
          {hiddenHere > 0 && (
            <p className="hint">
              {hiddenHere} {hiddenHere === 1 ? 'tool is' : 'tools are'} hidden from this menu (still offered as they are): shown again in Settings → Tools.
            </p>
          )}
          {props.children}
        </>
      )}
    </Popover>
  );
}
