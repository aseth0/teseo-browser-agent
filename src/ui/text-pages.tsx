// Where each text sent to the model is set (its settings page), and how a page's things look:
// its color (the bars of Prompt preview and of each page's texts), its icon, and a link to it.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { SHARED_REPLIES, TEXT_DEFS, WEBMCP_TEXTS, type TextDef, type TextId } from '../core/model-texts';
import { toWireName } from '../core/tool-registry';
import {
  Bell, Bookmark, Bot, Sparkles, Brain, CircleDot, Clock, Eye, FoldVertical, Gauge, Globe, Hammer, Keyboard, Layers, LayoutTemplate, Logs, Mic, Volume2, MousePointerClick, Network, Palette, Plug, Search, Server,
  ArrowLeftRight, Info, ShieldCheck, ShieldQuestionMark, SquareTerminal, UserRound, Wrench, Zap,
} from 'lucide';
import { LucideIcon } from './LucideIcon';

// The settings page a text belongs to, by its id's prefix (a few by the id itself); a tool's texts,
// that tool's card in Tools. None for the core texts (system, page, user message, tool results).
const PAGE_OF_PREFIX: Record<string, [string, string]> = {
  skill: ['skills', 'Skills'], template: ['site-templates', 'Site templates'], memory: ['memory', 'Memory'], history: ['history', 'History'], bookmark: ['bookmarks', 'Bookmarks'],
  compaction: ['compaction', 'Compaction'], mcp: ['mcp', 'MCP servers'], agent: ['agents', 'Agents'], widget: ['actions', 'Actions'], tool: ['tools', 'Tools'],
};
const PAGE_OF_ID: Record<string, [string, string]> = {
  'refusal.read_only': ['site-policies', 'Site policies'], 'refusal.agent_site': ['agents', 'Agents'], 'context.no_page_agent': ['agents', 'Agents'],
  'run.left_out': ['compaction', 'Compaction'], 'run.left_out_kept': ['compaction', 'Compaction'], 'context.unchanged': ['compaction', 'Compaction'], 'context.already_attached': ['compaction', 'Compaction'],
};
// The system prompt's parts, by the page whose settings they carry (system.<part>).
const PAGE_OF_SYSTEM: [RegExp, string][] = [
  [/^(skills_|site_skills)/, 'skill'], [/^mcp$/, 'mcp'], [/^history$/, 'history'], [/^memory/, 'memory'], [/^compaction$/, 'compaction'],
  [/^widget$/, 'widget'], [/^agents?$/, 'agent'], [/^templates$/, 'template'],
];
// A settings page's title, by its hash (#<page>/…).
const PAGE_TITLES: Record<string, string> = Object.fromEntries([...Object.values(PAGE_OF_PREFIX), ...Object.values(PAGE_OF_ID)]);
export const pageTitle = (hash: string) => PAGE_TITLES[hash.split('/')[0]!] ?? hash;
const systemPage = (id: string) => (id.startsWith('system.') ? PAGE_OF_SYSTEM.find(([part]) => part.test(id.slice(7)))?.[1] : undefined);
export const GoTo = ({ hash, title }: { hash: string; title: string }) => <a className="page-link" href={`#${hash}`} title={`Open Settings → ${title}`}>{title} →</a>;
export const toolPage = (key: string) => <GoTo hash={`tools/${encodeURIComponent(key)}`} title="Tools" />;
// Where a text is set: the page (hash and title), and the name of what it belongs to there.
export function pageOf(id: TextId): { hash: string; title: string; name: string } | undefined {
  const def: TextDef = TEXT_DEFS[id];
  if (def.tool) return { hash: `tools/${encodeURIComponent(def.tool)}`, title: 'Tools', name: def.tool === WEBMCP_TEXTS || def.tool === SHARED_REPLIES ? 'Tools' : toWireName(def.tool) };
  const page = PAGE_OF_ID[id] ?? PAGE_OF_PREFIX[systemPage(id) ?? id.split('.')[0]!];
  return page && { hash: page[0], title: page[1], name: page[1] };
}
// The color of a text's bar: its page's (as in "As sent"), the page block's, the rest the system's.
export const textColor = (id: TextId) => (id.startsWith('page.') ? 'var(--c-page)' : pageColor(pageOf(id)?.hash));

export function pageLink(id: TextId): ReactNode {
  const page = pageOf(id);
  return page && <GoTo hash={page.hash} title={page.title} />;
}

// Each settings page's icon, a Lucide one (a single set in Settings): in its menu, before a group's
// name, on its parts "as sent".
const PAGE_ICONS: Record<string, ReactNode> = Object.fromEntries(
  Object.entries({
    skills: Zap, 'site-templates': LayoutTemplate, tools: Wrench, 'custom-tools': Hammer, mcp: Plug, history: Clock, memory: Brain, agents: Bot, bookmarks: Bookmark, 'auto-inject': Sparkles,
    prompt: Layers, // the chat's Layers: what each request sent
    appearance: Palette, // its themes
    display: Eye, // what the chat shows
    shortcuts: Keyboard,
    bubble: CircleDot, // the page widget's bubble
    voice: Mic, // as the message box's 🎤
    alerts: Bell,
    speak: Volume2, // as the speak buttons
    'about-you': UserRound,
    compaction: FoldVertical,
    limits: Gauge,
    'word-blacklist': ShieldCheck, // as the chat's blacklist chip
    devtools: SquareTerminal,
    actions: MousePointerClick, // the bubble's buttons on the page
    recording: Network, // a page's requests
    providers: Server,
    'web-search': Search,
    'web-access': Globe,
    'site-policies': ShieldQuestionMark, // Ask before acting
    logs: Logs,
    'export-import': ArrowLeftRight, // out to a file and back
    about: Info,
  }).map(([page, node]) => [page, <LucideIcon node={node} size={14} />]),
);
export const pageIcon = (hash: string) => PAGE_ICONS[hash.split('/')[0]!];

// Margin colors by settings page, in the palette's (ui/tokens.css --c-*); the core texts, the system's.
const PAGE_COLORS: Record<string, string> = {
  skills: 'var(--c-known)', 'site-templates': 'var(--c-known)', memory: 'var(--c-known)', history: 'var(--c-known)',
  tools: 'var(--c-tool)', mcp: 'var(--c-tool)', agents: 'var(--c-model)', actions: 'var(--c-page)', compaction: 'var(--c-system)',
};
export const pageColor = (hash?: string) => (hash && PAGE_COLORS[hash.split('/')[0]!]) || 'var(--c-system)';

// A block about one page's things (an agent's tools, skills…): its icon in the page's color, its
// name and how many; with a summary, what it has in a line and Edit to show the list that changes it.
export function PageSection({ page, title, count, summary, children }: { page: string; title: ReactNode; count?: number; summary?: ReactNode; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="page-section" style={{ '--group': pageColor(page) } as CSSProperties}>
      <div className="page-section-head">
        {pageIcon(page) && <span className="text-group-icon" aria-hidden="true">{pageIcon(page)}</span>}
        <strong>{title}</strong>
        {count !== undefined && <span className="badge">{count}</span>}
        <span className="spacer" />
        {summary !== undefined && <button type="button" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>}
      </div>
      {summary !== undefined && !editing ? <div className="page-section-summary muted">{summary}</div> : <div className="page-section-body">{children}</div>}
    </section>
  );
}
