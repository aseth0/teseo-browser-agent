// The background of an empty chat: what can be mentioned in a message, as a faded table of groups
// (site templates with ::, skills with /, tools with $ by group, and each MCP server's tools apart).
// A group opens to its mentions, each one a button that writes it in the message box.
import { Fragment, useState } from 'react';
import type { ToolInfo } from '../../core/protocol';
import type { Mentions } from '../../storage/settings-types';
import { slugOf } from '../../context/sources';
import { mcpServerOf } from '../../core/mcp-keys';
import { useConversations } from '../../ui/useConversations';
import { useTemplates } from '../../ui/templates/useTemplates';
import { useSkills } from '../../ui/Skills';
import { toolGroupLabel } from '../../ui/Tools';
import { toolGroup } from '../../core/tool-groups';
import { mentionsOn, type MentionKind } from '../../storage/settings-select';

interface Props {
  tools: ToolInfo[];
  disabledTools: string[];
  mentions?: Mentions;
  onInsert: (token: string) => void;
}

interface Item {
  token: string;
  title: string;
  off?: boolean;
}

interface Group {
  id: string;
  trigger: string;
  name: string;
  items: Item[];
}

const RECENT = 8; // saved conversations listed

// Tools by their group, in catalog order; an MCP server's group goes by the server's name.
const toolGroups = (tools: ToolInfo[], disabled: string[]): Group[] =>
  Object.entries(Object.groupBy(tools, toolGroup)).map(([group, list]) => ({
    id: group,
    trigger: '$',
    name: mcpServerOf(group) ?? toolGroupLabel(group),
    items: list!.map((t) => ({ token: `$${t.name}`, title: t.description, off: disabled.includes(t.name) })),
  }));

export function MentionsHelp({ tools, disabledTools, mentions = {}, onInsert }: Props) {
  const templates = useTemplates().filter((t) => t.enabled);
  const skills = useSkills().filter((s) => s.enabled);
  const conversations = useConversations();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const on = (kind: MentionKind) => mentionsOn({ mentions }, kind);
  const sections: { title: string; how: string; groups: Group[] }[] = [
    {
      title: 'Site templates',
      how: '::site/view reads it from a tab of that site',
      groups:
        on('templates') && templates.length
          ? [{ id: 'templates', trigger: '::', name: 'Site templates', items: templates.map((t) => ({ token: `::${t.name}/`, title: `${t.description || t.name}\nViews: ${t.views.map((v) => v.name).join(', ')}` })) }]
          : [],
    },
    {
      title: 'Skills',
      how: '/skill loads it for that message',
      groups: on('skills') && skills.length ? [{ id: 'skills', trigger: '/', name: 'Skills', items: skills.map((s) => ({ token: `/${s.name}`, title: s.description })) }] : [],
    },
    { title: 'Tools', how: '$tool asks the model to use it (offered even if off)', groups: on('tools') ? toolGroups(tools.filter((t) => t.source !== 'mcp'), disabledTools) : [] },
    {
      title: 'Saved conversations',
      how: '#title attaches that conversation to your message',
      groups:
        on('history') && conversations.length
          ? [{ id: 'history', trigger: '#', name: 'Latest', items: conversations.slice(0, RECENT).map((c) => ({ token: `#${slugOf(c.title)}`, title: c.title })) }]
          : [],
    },
    { title: 'MCP', how: "$tool asks the model to use one of the server's tools", groups: on('tools') ? toolGroups(tools.filter((t) => t.source === 'mcp'), disabledTools) : [] },
  ].filter((s) => s.groups.length);
  if (!sections.length) return null;

  return (
    <table className="mentions-help" aria-label="What you can mention">
      <tbody>
        {sections.map((section) => (
          <Fragment key={section.title}>
            <tr className="mentions-help-section">
              <td colSpan={3} title={section.how}>{section.title}</td>
            </tr>
            {section.groups.map((g) => (
              <Fragment key={g.id}>
                <tr className="mentions-help-group" aria-expanded={open.has(g.id)} onClick={() => toggle(g.id)}>
                  <td className="mentions-help-trigger">{g.trigger}</td>
                  <td>{open.has(g.id) ? '▾' : '▸'} {g.name}</td>
                  <td className="mentions-help-count">{g.items.length}</td>
                </tr>
                {open.has(g.id) && (
                  <tr>
                    <td colSpan={3} className="mentions-help-items">
                      {g.items.map((i) => (
                        <button key={i.token} className={`mention-chip${i.off ? ' off' : ''}`} title={`${i.title}${i.off ? '\n(off: offered for that message only)' : ''}`} onClick={() => onInsert(i.token)}>
                          {i.token}
                        </button>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
