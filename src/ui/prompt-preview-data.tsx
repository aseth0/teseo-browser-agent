// What the prompt preview shows (ui/PromptPreview): its sections, the templates of the messages and
// results the model gets, with placeholders, and the parts of each as sent.
import type { AgentProfile } from '../agents/profiles';
import { formatPageContext } from '../context/page-context';
import { systemPromptParts } from '../context/request';
import { appendContext } from '../core/messages';
import { SHARED_REPLIES, text, textIds, withMarkedValues, type TextGroup, type TextId } from '../core/model-texts';
import type { Message } from '../core/types';
import type { ToolInfo } from '../core/protocol';
import { pieceLabel } from '../context/pieces';
import { AsSentList, groupBy, SHARED_GROUP, type AsSentPart } from './AsSent';
import { GoTo, pageColor, pageIcon, pageOf, pageTitle, toolPage } from './text-pages';
import { toOpenAIMessages, toOpenAITools } from '../providers/wire';
import { loadedSkillText, siteSkillBlock } from '../skills/prompt';
import { NOT_RUN, templateMessage } from '../templates/render';
import type { Settings } from '../storage/settings';
import { toWireName } from '../core/tool-registry';
import type { WhenFilter } from './EditableText';
import { toSpec } from './request-parts';

import { toolGroup } from '../core/tool-groups';
import { useRequestAs } from './useRequestAs';

export const SECTIONS: { id: TextGroup; title: string; hint: string }[] = [
  { id: 'system', title: 'System message', hint: 'Sent first in every request, after your own system prompt.' },
  { id: 'user', title: 'Attached to each user message', hint: 'Added after what you type, hidden in the chat.' },
];

// The user message's parts, in order, as templates: each with its label and the page it is set in.
function userTemplateParts(): { label: string; hash?: string; kind: 'skill' | 'tool' | 'page'; text: string; id: TextId }[] {
  const page = formatPageContext({ url: '{url}', title: '{title}', lang: '{language}', viewport: '{viewport}', scroll: '{scroll}', selection: '{selected_text}', snapshot: '{visible_elements}' });
  const values = text('skill.values', { skill_name: '{skill_name}', skill_values: text('skill.value', { variable: '{variable}', value: '{value}' }) });
  const template = templateMessage('{template_name}', '{view_name}', { ...NOT_RUN, output: '{template_output}' });
  return [
    { label: 'Site skill', id: 'skill.site_block', hash: 'skills', kind: 'skill', text: siteSkillBlock('{skill_name}', '{skill_instructions}') },
    { label: 'Skill mention', id: 'skill.mention', hash: 'skills', kind: 'skill', text: text('skill.mention', { skill_name: '{skill_name}', skill_instructions: '{skill_instructions}' }) },
    { label: 'Tool mention', id: 'tool.mention', hash: 'tools', kind: 'tool', text: text('tool.mention', { tool_names: '{tool_names}' }) },
    { label: 'Saved conversation', id: 'history.mention_note', hash: 'history', kind: 'page', text: `${text('history.mention_note')}\n${text('result.history_read')}` },
    { label: 'Site skill values', id: 'skill.values', hash: 'skills', kind: 'page', text: values },
    { label: 'Site template', id: 'template.note', hash: 'site-templates', kind: 'page', text: template },
    { label: 'Page block', id: 'page.block', kind: 'page', text: page },
  ];
}

// The user message as it is sent: your text plus the hidden context parts, with placeholders.
export function userMessageTemplate(): Message[] {
  const typed: Message[] = [{ role: 'user', parts: [{ type: 'text', text: '{user_message}' }] }];
  return appendContext(typed, userTemplateParts().map(({ kind, text: t }) => ({ kind, text: t })));
}

// The same, as sent part by part: what you type first, then each block (the page block, in the page's color).
export const userTemplateAsSent = (): AsSentPart[] => [
  { key: 'typed', label: 'Your message', text: '{user_message}', color: 'var(--c-you)', sent: 'always' },
  ...userTemplateParts().map((p): AsSentPart => ({
    key: p.label, label: p.label, text: p.text, color: p.hash ? pageColor(p.hash) : 'var(--c-page)', icon: p.hash && pageIcon(p.hash), link: p.hash && <GoTo hash={p.hash} title={pageTitle(p.hash)} />, sent: p.id,
  })),
];

// Tool results as the provider sends them: one "tool" message each (images follow in a user message).
export function toolResultsTemplate(): unknown[] {
  const result = (content: string, images?: { mediaType: string; data: string }[]) =>
    ({ type: 'tool_result' as const, toolCallId: '{tool_call_id}', content, ...(images && { images }) });
  const message: Message = {
    role: 'tool',
    parts: [
      result(text('result.after_action', { action_note: '{action_note}' })),
      result(text('result.not_executed')),
      result(loadedSkillText('{skill_name}', '{skill_instructions}')),
      result(text('result.page_text')),
      result(text('result.user_answered', { answers: text('result.user_answer_line') })),
      result(text('result.user_picked')),
      result(text('result.plan_shown')),
      result(text('result.history_read')),
      result(text('result.screenshot'), [{ mediaType: 'image/jpeg', data: '{base64}' }]),
    ],
  };
  return toOpenAIMessages(undefined, [message]);
}

export function mcpTemplate() {
  return {
    tools: toOpenAITools([{ name: 'mcp__{server}__{tool_name}', description: text('mcp.description'), inputSchema: { '{input_schema}': '' } }]),
    messages: toOpenAIMessages(undefined, [{ role: 'tool', parts: [{ type: 'tool_result', toolCallId: '{tool_call_id}', content: text('result.mcp') }] }]),
  };
}

export function webmcpTemplate() {
  return {
    tools: toOpenAITools([{ name: 'webmcp__{tool_name}', description: text('webmcp.description'), inputSchema: { '{input_schema}': '' } }]),
    messages: toOpenAIMessages(undefined, [{ role: 'tool', parts: [{ type: 'tool_result', toolCallId: '{tool_call_id}', content: text('result.webmcp') }] }]),
  };
}

// One "model calls → receives" example, built from the real templates.
export function replyExample(): string {
  return text('result.after_action', { action_note: text('action.click') });
}

export const WHEN_FILTERS: [WhenFilter, string][] = [['all', 'All'], ['always', 'Always'], ['only', 'Only when']];


// Each part's settings page, which gives it its color, icon and link; the parts set elsewhere, their own color.
const PART_PAGES: Record<string, string> = {
  Agent: 'agents', 'MCP servers': 'mcp', 'Other agents': 'agents', 'Saved conversations': 'history', Skills: 'skills', 'Site templates': 'site-templates', Memory: 'memory',
};
const PART_COLORS: Record<string, string> = { 'Your system prompt': 'var(--c-you)', 'Page instructions': 'var(--c-page)' };

// The text that says when each part of the system message is sent (none: always).
const SYSTEM_PART_TEXTS: Record<string, TextId> = {
  Agent: 'system.agent', 'Page instructions': 'system.page', 'MCP servers': 'system.mcp', 'Other agents': 'system.agents', Plan: 'system.plan',
  'Saved conversations': 'system.history', Skills: 'system.skills_header', 'Site templates': 'system.templates', Memory: 'system.memory',
};

// The system message as the model gets it (as Browser or an agent), read top to bottom: a System
// message section's "as sent" render. Each part under a thin line with its name, its size and where
// it is changed, a color in the margin per part; the parts not sent now, crossed out with why.
export function AsSentParts({ settings: base, agent }: { settings: Settings; agent?: AgentProfile }) {
  const { settings, skills, templates, asks, memory, heldSkills } = useRequestAs(agent, base);
  const parts = withMarkedValues(() => systemPromptParts({ settings, skills, templates, agent, asksAgents: asks, memory, heldSkills })).map((p): AsSentPart => {
    const hash = PART_PAGES[p.label];
    const link = p.label === 'Your system prompt' ? <span className="muted">Edited at the top of this page</span> : hash && <GoTo hash={hash} title={pageTitle(hash)} />;
    return { key: p.label, label: p.label, text: p.text, color: PART_COLORS[p.label] ?? pageColor(hash), icon: hash && pageIcon(hash), link, sent: SYSTEM_PART_TEXTS[p.label] ?? 'always', ...(!p.text && { off: p.off }) };
  });
  return <AsSentList parts={parts} />;
}

// A user message's parts as sent: what you typed, then each attached block, by its label (context/pieces).
export function messageParts(message: Message): AsSentPart[] {
  return message.parts.flatMap((part, i): AsSentPart[] => {
    if (part.type !== 'text' || !part.text.trim()) return [];
    const label = pieceLabel(part);
    const hash = pieceHash(label);
    return [{ key: `${i}`, label, text: part.text, color: label.startsWith('Page block') ? 'var(--c-page)' : pageColor(hash), icon: hash && pageIcon(hash), link: hash && <GoTo hash={hash} title={pageTitle(hash)} /> }];
  });
}
const PIECE_PAGES: [RegExp, string][] = [
  [/^(Site skill|Skill mention)/, 'skills'], [/^Tool mention/, 'tools'], [/^Saved conversation/, 'history'], [/^(Site template|Mention ::)/, 'site-templates'],
  [/^Memory/, 'memory'], [/^Summary of the earlier turns/, 'compaction'],
];
const pieceHash = (label: string) => PIECE_PAGES.find(([re]) => re.test(label))?.[1];

// Tool definitions as sent, one per tool (its JSON), each linked to its card in Tools.
export const toolParts = (tools: ToolInfo[]): AsSentPart[] =>
  tools.map((t) => ({ key: t.name, label: toWireName(t.name), text: JSON.stringify(toOpenAITools([toSpec(t)])[0], null, 2), code: true, group: toolGroup(t), color: pageColor('tools'), icon: pageIcon('tools'), link: toolPage(t.name) }));

// Items of tools in their groups (as in the tools menu); items of no known tool (the replies every
// page action shares) in a group of their own.
export const byToolGroup = <T,>(items: T[], toolOf: (item: T) => ToolInfo | undefined) => groupBy(items, (item) => {
  const tool = toolOf(item);
  return tool ? toolGroup(tool) : SHARED_GROUP;
});

// A call and the "tool" message it gets back, per tool (the page actions share one reply): the
// call with its parameters as placeholders, then the message as the model reads it.
export function replyPairs(owners: string[], catalog: ToolInfo[]): AsSentPart[] {
  return owners.map((o): AsSentPart => {
    const tool = catalog.find((t) => t.name === o);
    const ids = textIds((d) => d.tool === o);
    const reply = o === SHARED_REPLIES ? undefined : (ids.find((id) => id.startsWith('result.')) ?? ids[0]);
    const params = Object.keys((tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {});
    const call = o === SHARED_REPLIES ? 'browser__click {"ref": "ref_4"}' : `${toWireName(o)} ${JSON.stringify(Object.fromEntries(params.map((n) => [n, `{${n}}`])))}`;
    const hash = o === SHARED_REPLIES ? 'tools' : `tools/${encodeURIComponent(o)}`;
    return {
      key: o, label: o === SHARED_REPLIES ? 'Any page action' : toWireName(o), call, text: reply ? text(reply) : replyExample(),
      color: pageColor('tools'), icon: pageIcon('tools'), link: <GoTo hash={hash} title="Tools" />, sent: reply ?? 'result.after_action', group: tool ? toolGroup(tool) : SHARED_GROUP,
    };
  });
}

// Texts as sent, each a part (replies, results), in a given color, linked where they are changed.
export const textParts = (texts: [string, string, TextId?][], hash?: string): AsSentPart[] =>
  texts.map(([label, body, id]) => ({ key: label, label, text: body, color: pageColor(hash), icon: hash && pageIcon(hash), link: hash && <GoTo hash={hash} title={pageTitle(hash)} />, ...(id && { sent: id }) }));

export type PageGroup = { hash: string; title: string; name: string; ids: TextId[] };

// A section's texts in order, those of one settings page (two or more) together in a box under
// its name, where they appear first; the page's button goes on the box, not on each text.
export function byPage(ids: TextId[]): (TextId | PageGroup)[] {
  const count = new Map<string, number>();
  for (const id of ids) {
    const hash = pageOf(id)?.hash;
    if (hash) count.set(hash, (count.get(hash) ?? 0) + 1);
  }
  const groups = new Map<string, PageGroup>();
  return ids.flatMap((id): (TextId | PageGroup)[] => {
    const page = pageOf(id);
    if (!page || count.get(page.hash)! < 2) return [id];
    const group = groups.get(page.hash);
    if (group) return (group.ids.push(id), []);
    const made: PageGroup = { ...page, ids: [id] };
    groups.set(page.hash, made);
    return [made];
  });
}
