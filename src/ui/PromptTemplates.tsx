// Prompt preview → Templates: every fixed text, editable, with its "as sent" render as the agent
// chosen sees it.
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { AgentProfile } from '../agents/profiles';
import { buildSystemPrompt } from '../context/request';
import { MCP_TEXTS, SHARED_REPLIES, text, TEXT_DEFS, textIds, toolDescription, toolTextKey, WEBMCP_TEXTS, type TextDef, type TextGroup, type TextId } from '../core/model-texts';
import { AsSentList, ToolGroupFold } from './AsSent';
import { GoTo, pageColor, pageIcon, pageLink, textColor, toolPage } from './text-pages';
import { toOpenAIMessages, toOpenAITools } from '../providers/wire';
import type { Settings } from '../storage/settings';
import { toWireName } from '../core/tool-registry';
import { ModelTextEditor, TemplateView, WhenFilterContext, type WhenFilter } from './EditableText';
import { labelled, toSpec } from './request-parts';
import { CopyIconButton } from './icons';
import { BlockText, MarkdownView, PromptSection, useSectionMarkdown } from './PromptSection';
import { Segmented } from './Segmented';
import { MarkdownToggle } from './MarkdownToggle';
import { useRequestAs } from './useRequestAs';
import { AsSentParts, byPage, byToolGroup, mcpTemplate, replyExample, replyPairs, SECTIONS, textParts, toolParts, toolResultsTemplate, userMessageTemplate, userTemplateAsSent, webmcpTemplate, WHEN_FILTERS, type PageGroup } from './prompt-preview-data';

// A page's texts in a box (open: the section folds, not its groups): its icon, name and count, how
// its texts show (Markdown or as written, each text can still choose its own), copy them all, and
// its page's button.
function TextGroup({ group, children }: { group: PageGroup; children: ReactNode }) {
  // Until chosen here, as its section says (and changes).
  const section = useSectionMarkdown();
  const [chosen, setMarkdown] = useState<boolean>();
  const markdown = chosen ?? section;
  return (
    <div className="text-group" style={{ '--group': pageColor(group.hash) } as CSSProperties}>
      <div className="text-group-head">
        <strong>{pageIcon(group.hash) && <span className="text-group-icon" aria-hidden="true">{pageIcon(group.hash)}</span>}{group.name}</strong>
        <span className="muted">{group.ids.length} texts</span>
        <span className="spacer" />
        <span className="title-tools" role="toolbar" aria-label={`${group.name} texts`}>
          <MarkdownToggle on={markdown} onChange={setMarkdown} marks />
          <CopyIconButton text={labelled(group.ids.map((id) => [TEXT_DEFS[id].label, text(id)]))} label="Copy these texts" />
        </span>
        <GoTo hash={group.hash} title={group.title} />
      </div>
      <MarkdownView on={markdown}>{children}</MarkdownView>
    </div>
  );
}

// The texts are the same for every agent; their "as sent" renders are built as the agent chosen
// ("As"): its system message, and only its tools.
export function Templates({ settings, agent }: { settings: Settings; agent?: AgentProfile }) {
  const overrides = settings.promptTexts ?? {};
  const [when, setWhen] = useState<WhenFilter>('all');
  const { offered, loaded: { skills, templates, catalog } } = useRequestAs(agent, settings);
  const offeredNames = new Set(offered.map((t) => t.name));
  // The replies the chosen agent can get: its tools', and the page actions' when it has any browser tool.
  const usesOwner = (o: string) => (o === SHARED_REPLIES ? offered.some((t) => t.name.startsWith('browser.')) : offeredNames.has(o));
  const view = (id: TextId, action?: ReactNode) => {
    const def: TextDef = TEXT_DEFS[id];
    return <TemplateView key={id} label={def.label} when={def.when} limit={def.limit} note={def.note} defaultText={def.text} value={overrides[id]} action={action ?? pageLink(id)} color={textColor(id)} />;
  };
  const edit = (id: TextId, action?: ReactNode) => <ModelTextEditor key={id} id={id} action={action} />;
  const owners = [SHARED_REPLIES, ...catalog.map((t) => t.name)].filter((o) => textIds((d) => d.tool === o).length);
  const ownerTitle = (o: string) => (o === SHARED_REPLIES ? 'Shared by every page action' : toWireName(o));
  const repliesText = owners.flatMap((o) => textIds((d) => d.tool === o).map((id): [string, string] => [`${ownerTitle(o)} · ${TEXT_DEFS[id].label}`, text(id)]));

  return (
    <WhenFilterContext.Provider value={when}>
      <div className="templates-filter">
        <span className="muted">Show</span>
        <Segmented className="compact" label="Show texts by when they are sent" value={when} onChange={setWhen} options={WHEN_FILTERS.map(([value, label]) => ({ value, label }))} />
      </div>
      {SECTIONS.map((g) => {
        const ids = textIds((d) => d.group === g.id);
        const texts: [string, string][] = ids.map((id) => [TEXT_DEFS[id].label, text(id)]);
        if (g.id === 'system') texts.unshift(['Your system prompt', settings.systemPrompt]);
        const json = g.id === 'system' ? toOpenAIMessages(buildSystemPrompt({ settings, skills, templates }), [])[0] : toOpenAIMessages(undefined, userMessageTemplate())[0];
        return (
          <PromptSection key={g.id} id={`templates.${g.id}`} title={g.title} hint={g.hint} copyText={labelled(texts)} json={json} viewsInTitle
            asSent={g.id === 'system' ? <AsSentParts settings={settings} agent={agent} /> : <AsSentList parts={userTemplateAsSent()} />}>
            {g.id === 'system' && (
              <TemplateView label="Your system prompt" defaultText={settings.systemPrompt} action={<span className="muted">Edited at the top of this page</span>} />
            )}
            {byPage(ids).map((item) =>
              typeof item === 'string' ? edit(item, pageLink(item)) : (
                <TextGroup key={item.hash} group={item}>{item.ids.map((id) => edit(id))}</TextGroup>
              ),
            )}
          </PromptSection>
        );
      })}

      <PromptSection viewsInTitle
        id="templates.replies"
        asSent={<AsSentList parts={replyPairs(owners.filter(usesOwner), catalog)} />}
        title="How tool results come back"
        hint="The model never acts itself: it asks for a tool, the extension runs it and answers with a “tool” message, the tool's data wrapped in one of these fixed texts. Each call gets one of them; “as sent” shows a call and the message it gets, per tool. Edit them in Tools."
        copyText={labelled(repliesText)}
        json={toolResultsTemplate()}
      >
        <div className="reply-example">
          <div><span className="muted">The model calls</span> <code>browser__click {'{"ref": "ref_4"}'}</code> <span className="muted">and receives:</span></div>
          <BlockText text={replyExample()} />
        </div>
        {byToolGroup(owners, (o) => catalog.find((t) => t.name === o)).map(([group, inGroup]) => (
          <ToolGroupFold key={group} group={group} count={inGroup.length}>
            {inGroup.map((o) => (
              <div key={o} className="reply-owner">
                <div className="reply-owner-head">
                  <strong className={o === SHARED_REPLIES ? undefined : 'tool-name'}>{ownerTitle(o)}</strong>
                  <span className="muted">{textIds((d) => d.tool === o).length} texts</span>
                  <span className="spacer" />{toolPage(o)}
                </div>
                {textIds((d) => d.tool === o).map((id) => view(id))}
              </div>
            ))}
          </ToolGroupFold>
        ))}
      </PromptSection>

      <PromptSection viewsInTitle
        id="templates.webmcp"
        asSent={<AsSentList parts={textParts(textIds((d) => d.tool === WEBMCP_TEXTS).map((id) => [TEXT_DEFS[id].label, text(id), id]), 'tools')} />}
        title="Tools offered by websites (WebMCP)"
        hint="Pages can register their own tools. Their names, descriptions and results are written by the website."
        copyText={labelled(textIds((d) => d.tool === WEBMCP_TEXTS).map((id) => [TEXT_DEFS[id].label, text(id)]))}
        json={webmcpTemplate()}
      >
        {textIds((d) => d.tool === WEBMCP_TEXTS).map((id) => view(id, toolPage(WEBMCP_TEXTS)))}
      </PromptSection>

      <PromptSection viewsInTitle
        id="templates.mcp"
        asSent={<AsSentList parts={textParts(textIds((d) => d.tool === MCP_TEXTS).map((id) => [TEXT_DEFS[id].label, text(id), id]), 'mcp')} />}
        title="Tools of MCP servers"
        hint="The servers in Settings → MCP servers: their tools' descriptions and results are written by the server."
        copyText={labelled(textIds((d) => d.tool === MCP_TEXTS).map((id) => [TEXT_DEFS[id].label, text(id)]))}
        json={mcpTemplate()}
      >
        {textIds((d) => d.tool === MCP_TEXTS).map((id) => view(id, <a href="#mcp">Edit in MCP servers →</a>))}
      </PromptSection>

      <PromptSection viewsInTitle
        id="templates.tools"
        asSent={<AsSentList parts={toolParts(offered)} />}
        title="Tool descriptions"
        hint="What the model reads to decide when to call each tool."
        copyText={labelled(catalog.map((t) => [toWireName(t.name), toolDescription(t.name, t.description)]))}
        json={toOpenAITools(catalog.map(toSpec))}
      >
        {byToolGroup(catalog, (t) => t).map(([group, inGroup]) => (
          <ToolGroupFold key={group} group={group} count={inGroup.length}>
            {inGroup.map((t) => (
              <TemplateView key={t.name} label={<span className="tool-name">{toWireName(t.name)}</span>} when={null} defaultText={t.description} value={overrides[toolTextKey(t.name)]}
                action={toolPage(t.name)} color={pageColor('tools')} />
            ))}
          </ToolGroupFold>
        ))}
      </PromptSection>
    </WhenFilterContext.Provider>
  );
}
