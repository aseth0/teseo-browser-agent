// The context a user message gets before it goes to the model, in order: the site skills of the page,
// the memory items for its site, the sites mentioned (::site/view), the skills (/skill), the saved conversations (#title), the
// bookmarks (b::title), the saved conversations attached on their own, the tools mentioned ($tool), then the page (its skills' values, its
// templates' output, the page itself) when asked for.
import type { ContextItem } from '../core/messages';
import type { BackgroundToPanel } from '../core/protocol';
import type { AccessRequest, Message } from '../core/types';
import { hostOf } from '../core/util';
import { autoAttachItems } from '../history/auto';
import { historyMentionItems } from '../history/mention';
import { bookmarkMentionItems } from '../bookmarks/mention';
import { bookmarkAutoItems } from '../bookmarks/auto';
import { siteSkillValueItems, skillVariables, valueTextOf } from '../skills/prompt';
import type { Skill } from '../skills/types';
import type { Settings } from '../storage/settings';
import { parseMentions } from '../templates/mentions';
import { templateItems } from '../templates/render';
import type { PageTemplate } from '../templates/types';
import { parseInline, skillMentionItems, toolMentionItem, toolNamed } from './inline-mentions';
import { readMentions } from './mentions';
import { NO_PAGE_SOURCE, PAGE_SOURCE, USER_ELSEWHERE_SOURCE } from './sources';
import { markPageData, text } from '../core/model-texts';
import { autoInjectOn, type AutoInjectKind } from './auto-inject';
import type { MemoryPromptOptions } from '../memory/prompt';
import type { MemoryItem } from '../memory/store';
import { meaningOffFor } from './meaning-off';
import { MEANING_FAILED_NOTICE, meaningCandidates, queryMeaning } from '../memory/query-meaning';
import { siteContextItems } from './site-context';
import { buildPageContext, readPageValues } from './pipeline';
import { runPageTemplates } from '../templates/run';
import { seenWhole } from './compaction';
import { historyOn, mentionsOn, type MentionKind } from '../storage/settings-select';
import { noPhases, type PhaseRecorder } from '../core/phases';

interface TurnInput {
  history: Message[]; // ending with the user's message
  tabId?: number; // the panel's tab
  url?: string; // its page
  includePage: boolean;
  noSelection?: boolean; // the page without its selected text
  noPage?: string; // without the page: why, told to the model (context.no_page)
  userTab?: { tabId: number; title?: string; url?: string }; // the tab the user is on, another than tabId (context.user_elsewhere)
  conversationId?: string;
  skip?: AutoInjectKind[]; // left out of this conversation (the chat's menu; context/auto-inject)
  turn?: object; // this turn, as an object: the message's vector is asked once for it, for memory and the tool groups (memory/query-meaning embedQuery)
}

interface TurnDeps {
  settings: Settings;
  skills: Skill[];
  templates: PageTemplate[];
  memory?: MemoryItem[]; // the items for the agent (memory/store memoryFor)
  memoryOpts?: MemoryPromptOptions; // what it may do with them
  toolNames: string[]; // the tools that can be mentioned
  requestAccess: (access: AccessRequest) => Promise<boolean>;
  send: (event: Extract<BackgroundToPanel, { type: 'status' | 'auto-attach' | 'notice' }>) => void; // to the panel
  phases?: PhaseRecorder; // each source that attached something, timed (core/phases)
}

// A source's phase detail: how many it attached; none, and it is left out.
const attached = (n: number) => (n ? `${n} attached` : undefined);

// The items, and the tools mentioned: offered even if off, and asked for.
export async function turnContext(input: TurnInput, deps: TurnDeps): Promise<{ items: ContextItem[]; mentionedTools: string[] }> {
  const { history, tabId, url, conversationId } = input;
  const { settings, skills, templates } = deps;
  const phases = deps.phases ?? noPhases;
  const step = <T,>(label: string, fn: () => Promise<T> | T, detail: (r: T) => string | undefined) => phases.time({ kind: 'context', label }, fn, detail);
  const counted = (label: string, fn: () => Promise<ContextItem[]> | ContextItem[]) => step(label, fn, (r) => attached(r.length));
  const mentions = (kind: MentionKind) => mentionsOn(settings, kind);
  const on = (kind: AutoInjectKind) => autoInjectOn(settings, kind, input.skip);
  // What you wrote (not what goes with it).
  const typed = (history.at(-1)?.parts ?? []).map((p) => (p.type === 'text' && !p.context ? p.text : '')).join('\n');
  // What goes once per conversation goes again once compaction trimmed or summarized it: judged on
  // what the model still sees whole, worked out once for the turn.
  const seen = seenWhole(history);
  // The site skills, the memory for the site and what your message matches, even without page reading.
  // How close in meaning the items are (Settings → Memory → Semantic search), unless this conversation
  // left it out: asked here, as the choice may not have reached the panel yet (context/meaning-off).
  const memory = deps.memory ?? [];
  const asks = on('memoryMeaning') && !(await meaningOffFor(conversationId));
  const { meaning, failed } = asks ? await step('Memory by meaning', () => queryMeaning(settings, typed, meaningCandidates(memory, hostOf(url), on, !!deps.memoryOpts?.reads), input.turn), (r) => (r.failed ? 'could not be asked' : 'asked')) : {};
  if (failed) deps.send({ type: 'notice', text: MEANING_FAILED_NOTICE });
  const site = await step('Site skills and memory', () => siteContextItems({ settings, skills, templates, memory, memoryOpts: deps.memoryOpts, url, typed, history: seen, skip: input.skip, meaning }), (r) => attached(r.items.length));
  const active = site.skills;
  const items: ContextItem[] = site.items;
  // The sites mentioned in the message (::site/view), wherever they are open, even without "Page".
  const mentioned = await step('Sites mentioned', () => readMentions(mentions('templates') ? parseMentions(typed, templates) : [], {
    activeTabId: tabId,
    web: settings.webSearch,
    requestAccess: deps.requestAccess,
    onStatus: (status) => deps.send({ type: 'status', text: status }),
  }), (r) => attached(r.items.length));
  items.push(...mentioned.items);
  // The skills (/skill) and tools ($tool) mentioned in it.
  if (mentions('skills')) items.push(...(await counted('Skills mentioned', () => skillMentionItems(typed, skills, new Set(active.map((s) => s.name))))));
  // The saved conversations (#title) mentioned in it.
  if (mentions('history') && historyOn(settings)) items.push(...(await counted('Saved conversations mentioned', () => historyMentionItems(typed, conversationId))));
  // The bookmarks (b::title) mentioned in it, and those it matches, on their own (Settings → Bookmarks → Auto-attach).
  if (mentions('bookmarks')) items.push(...(await counted('Bookmarks mentioned', () => bookmarkMentionItems(typed, settings))));
  if (on('bookmarkAuto')) items.push(...(await counted('Bookmarks matched', () => bookmarkAutoItems(typed, seen, settings))));
  // And those your message matches well enough, on their own (Settings → History → Auto-attach).
  const auto = on('historyAuto') ? await step('Saved conversations matched', () => autoAttachItems(typed, seen, settings.history?.autoAttach ?? {}, conversationId), (r) => attached(r.items.length)) : { items: [] };
  items.push(...auto.items);
  if (auto.check) deps.send({ type: 'auto-attach', check: auto.check });
  let mentionedTools: string[] = [];
  if (mentions('tools')) {
    mentionedTools = parseInline(typed, 'tool', toolNamed(deps.toolNames)).map((m) => m.name);
    const note = toolMentionItem(mentionedTools);
    if (note) items.push(note);
  }
  if (input.includePage && tabId !== undefined) {
    // The values its site skills ask for, the output of its site templates (except those just read
    // from this tab as mentions), then the page itself.
    const pageTemplates = site.templates.filter((t) => !mentioned.fromActiveTab.has(t.id));
    const variables = skillVariables(active);
    const [values, results] = await step('Site skill values and templates', () => Promise.all([readPageValues(tabId, variables), runPageTemplates(tabId, pageTemplates, url)]),
      () => (variables.length || pageTemplates.length ? [variables.length && `${variables.length} values`, pageTemplates.length && `${pageTemplates.length} templates`].filter(Boolean).join(', ') : undefined));
    const fromTemplates = templateItems(pageTemplates, results);
    // Unread, not missing: so the model does not take it that the page has none of them.
    const valueOf = values.error === undefined ? valueTextOf(values.values) : () => `the page could not be read (${values.error})`;
    items.push(...siteSkillValueItems(active, valueOf), ...fromTemplates.items);
    const page = await step('Reading the page', () => buildPageContext(tabId, { replacedBy: mentioned.replacedBy ?? fromTemplates.replacedBy, noSelection: input.noSelection }), (t) => `about ${Math.round(t.length / 4).toLocaleString('en-US')} tokens`);
    items.push({ kind: 'page', text: page, source: PAGE_SOURCE });
  } else if (input.noPage) {
    // Said, so the model does not imagine one.
    items.push({ kind: 'page', text: text('context.no_page', { reason: input.noPage }), source: NO_PAGE_SOURCE });
  }
  // The user looks at another tab: the model is told, so "this page" is not taken for the chat's.
  const elsewhere = input.userTab;
  if (elsewhere) {
    items.push({ kind: 'page', text: text('context.user_elsewhere', { tab_id: String(elsewhere.tabId), title: markPageData(elsewhere.title ?? ''), url: elsewhere.url ?? '' }), source: USER_ELSEWHERE_SOURCE });
  }
  return { items, mentionedTools };
}
