// Prompt preview → Preview single call: the request the texts produce with example data.
import type { CSSProperties } from 'react';
import type { AgentProfile } from '../agents/profiles';
import type { PageSnapshot } from '../context/page-context';
import { buildSystemPrompt, systemPromptSections } from '../context/request';
import { appendContext } from '../core/messages';
import { stripMarks, text, toolDescription, withMarkedValues } from '../core/model-texts';
import type { Message } from '../core/types';
import { AsSentList, ToolGroupFold } from './AsSent';
import { pageColor, toolPage } from './text-pages';
import { toOpenAIMessages, toOpenAITools } from '../providers/wire';
import { loadedSkillText, siteSkillReminder, skillInstructions } from '../skills/prompt';
import { siteContextItems } from '../context/site-context';
import { isSiteSkill } from '../skills/types';
import type { Settings } from '../storage/settings';
import { toWireName } from '../core/tool-registry';
import { clickReply, isSamplePage, markedPage, PreviewInputs, previewPageItems, typedMessage, type PreviewData } from './preview-data';
import { labelled, requestHead, textTokens } from './request-parts';
import { CopyIconButton } from './icons';
import { BlockText, PromptSection } from './PromptSection';
import { usePreviewMeaning } from './usePreviewMeaning';
import { useRequestAs } from './useRequestAs';
import { AsSentParts, byToolGroup, messageParts, textParts, toolParts } from './prompt-preview-data';

// With an agent (Settings → Agents), as that agent sees it.
export function Example({ settings: base, data, agent }: { settings: Settings; data: PreviewData; agent?: AgentProfile }) {
  const { settings, skills, templates, offered, specs, asks, memory, memoryOpts, heldSkills } = useRequestAs(agent, base);
  const { message, page } = data;
  const meaningOf = usePreviewMeaning(settings, [message], memory);

  const sections = systemPromptSections({ settings, skills, templates, agent, asksAgents: asks, memory, heldSkills });
  const tools = toOpenAITools(specs);
  // What goes on its own, as Settings → Auto-inject says (built again below, marked).
  const siteContext = () => siteContextItems({ settings, skills, templates, memory, memoryOpts, url: page.url, typed: message, history: [], meaning: meaningOf.get(message) });
  const { skills: site, templates: pageTemplates } = siteContext();
  const matching = [...site.map((s) => `site skill ${s.name}`), ...pageTemplates.map((t) => `site template ${t.name}`)];
  const skill = skills.find((s) => s.enabled && !isSiteSkill(s));

  // Built with every filled-in value marked, so the "origin" view can color where text comes
  // from; the clean versions (stripMarks) are what the request carries.
  const marked = withMarkedValues(() => {
    const fromPage = markedPage(page);
    // The user message exactly as the background builds it (context/turn): what goes for the site and
    // your message, then the page.
    const typed: Message[] = [typedMessage(message)];
    const forSite = siteContext();
    const context = [...forSite.items, ...previewPageItems(forSite, data, fromPage)];
    const results: [string, string][] = [
      ['browser__click', clickReply(page)],
      ['A denied action', text('result.not_executed', { reason: text('refusal.denied') })],
      ...(skill ? [['skills__load', loadedSkillText(skill.name, skillInstructions(skill))] as [string, string]] : []),
    ];
    // Not tool results: what a site skill becomes in the user message of later turns.
    const reminders = site.map((s): [string, string] => [`Next turn: ${s.name}`, siteSkillReminder(s.name)]);
    const wire = toOpenAIMessages(undefined, appendContext(typed, context), { keepMarks: true })[0]?.content; // text alone: no images here
    return {
      system: buildSystemPrompt({ settings, skills, templates, agent, asksAgents: asks, memory, heldSkills }),
      user: typeof wire === 'string' ? wire : '',
      userMessage: appendContext(typed, context).at(-1)!,
      results,
      reminders,
    };
  });
  const system = stripMarks(marked.system);
  const systemMessage = toOpenAIMessages(system, [])[0];
  const userMessage = { role: 'user', content: stripMarks(marked.user) };
  const results = [...marked.results, ...marked.reminders];
  const resultsJson = toOpenAIMessages(undefined, [
    { role: 'tool', parts: marked.results.map(([, content], i) => ({ type: 'tool_result', toolCallId: `call_${i + 1}`, content: stripMarks(content) })) },
  ]);
  const requestBody = { ...requestHead(base, agent), messages: [systemMessage, userMessage], tools };

  return (
    <>
      <div className="prompt-example-inputs">
        <PreviewInputs data={data} />
        <div className="row">
          <CopyIconButton text={JSON.stringify(requestBody, null, 2)} label="Copy the whole request body (JSON)" />
          <span className="muted">Whole request body</span>
        </div>
      </div>

      <PromptSection viewsInTitle
        id="example.page"
        title="0 · Page data"
        meta={isSamplePage(page) ? 'invented example' : `loaded from ${new URL(page.url).host}`}
        hint="What was read from the page. It reaches the model inside your message and in the replies to page actions (highlighted there)."
        copyText={labelled(pageFields(page))}
      >
        {pageFields(page).map(([label, value]) => (
          <div key={label} className="text-block">
            <div className="text-block-head"><strong>{label}</strong><span className="muted">{value ? textTokens(value) : 'empty'}</span></div>
            {value && <BlockText text={value} />}
          </div>
        ))}
      </PromptSection>

      <PromptSection viewsInTitle asSent={<AsSentParts settings={base} agent={agent} />} id="example.system" origin title="1 · System message" meta={textTokens(system)} hint={sections.map((s) => s.label).join(' + ')} copyText={system} json={systemMessage}>
        <div className="text-block"><BlockText text={marked.system} /></div>
      </PromptSection>

      <PromptSection viewsInTitle
        id="example.tools"
        asSent={<AsSentList parts={toolParts(offered)} />}
        title={`2 · Tools (${offered.length} offered)`}
        meta={textTokens(JSON.stringify(tools))}
        copyText={labelled(offered.map((t) => [toWireName(t.name), toolDescription(t.name, t.description)]))}
        json={tools}
      >
        {byToolGroup(offered, (t) => t).map(([group, inGroup]) => (
          <ToolGroupFold key={group} group={group} count={inGroup.length}>
            {inGroup.map((t) => (
              <div key={t.name} className="text-block colored" style={{ '--part': pageColor('tools') } as CSSProperties}>
                <div className="text-block-head"><strong className="tool-name">{toWireName(t.name)}</strong><span className="spacer" />{toolPage(t.name)}</div>
                <BlockText text={toolDescription(t.name, t.description)} />
              </div>
            ))}
          </ToolGroupFold>
        ))}
      </PromptSection>

      <PromptSection viewsInTitle
        id="example.user"
        origin
        asSent={<AsSentList parts={messageParts(marked.userMessage)} />}
        title="3 · Your message"
        meta={textTokens(userMessage.content)}
        hint={matching.length > 0 ? `Matching this URL: ${matching.join(', ')}` : undefined}
        copyText={userMessage.content}
        json={userMessage}
      >
        <div className="text-block"><BlockText text={marked.user} /></div>
      </PromptSection>

      <PromptSection viewsInTitle id="example.results" title="4 · Some tool results" origin copyText={labelled(results)} json={resultsJson} asSent={<AsSentList parts={textParts(results, 'tools')} />}>
        {results.map(([label, body]) => (
          <div key={label} className="text-block">
            <div className="text-block-head"><strong>{label}</strong></div>
            <BlockText text={body} />
          </div>
        ))}
      </PromptSection>
      <p className="hint">
        Each model reply and tool result is appended, so every request resends the whole conversation. Reasoning is never
        sent back. Outside the chat, only <em>Test connection</em> talks to the model when the server lists no models: a
        single <code>ping</code> message.
      </p>
    </>
  );
}

const pageFields = (p: PageSnapshot): [string, string][] => [
  ['URL', p.url],
  ['Title', p.title],
  ['Language', p.lang],
  ['Viewport', p.viewport],
  ['Scroll', p.scroll],
  ['Selected text', p.selection],
  ['Visible elements', p.snapshot],
];
