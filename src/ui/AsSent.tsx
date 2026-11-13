// A text as the model gets it, part by part (a section's "As sent" render, in Prompt preview and on
// the pages whose texts reach the model): each part under a thin line with its name, its size, when
// it is sent and where it is changed, a color in the margin per part; the values filled in, in their
// origin colors; parts of tools folded by tool group.
import type { CSSProperties, ReactNode } from 'react';
import { originRuns, stripMarks, TEXT_DEFS, type TextDef, type TextId } from '../core/model-texts';
import { WhenTag } from './EditableText';
import { JsonTree } from './JsonTree';
import { ORIGINS } from './origins';
import { BlockText, OriginLegend, OriginView } from './PromptSection';
import { textTokens } from './request-parts';
import { toolGroupLabel } from './Tools';

// The group of the replies every page action shares (they belong to no one tool).
export const SHARED_GROUP = 'shared';

// Items in their groups, in the order the groups first come.
export function groupBy<T>(items: T[], keyOf: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups];
}
const groupLabel = (group: string) => (group === SHARED_GROUP ? 'Shared by every page action' : toolGroupLabel(group));

// A group of tools, folded under its name and count.
export function ToolGroupFold({ group, count, children }: { group: string; count: number; children: ReactNode }) {
  return (
    <details className="tool-group-fold">
      <summary className="tool-group-fold-head"><strong>{groupLabel(group)}</strong><span className="muted">{count} {count === 1 ? 'tool' : 'tools'}</span></summary>
      {children}
    </details>
  );
}

// One part of a message as sent, for a section's "as sent" render: its text, a margin color, and
// where it is changed; or not sent now, and why (`off`).
export interface AsSentPart {
  key: string; label: string; text: string; color: string; icon?: ReactNode; link?: ReactNode; off?: string; code?: boolean;
  call?: string; // the tool call it answers (a "tool" message)
  group?: string; // its tool group: the list folds the parts by group
  sent?: TextId | 'always'; // when it is sent: always, or as that text says ("Only when …"); none: no tag
}
const sentTag = (sent: AsSentPart['sent']) => sent && <WhenTag when={sent === 'always' ? undefined : (TEXT_DEFS[sent] as TextDef).when} />;


export function AsSentList({ parts }: { parts: AsSentPart[] }) {
  // The values filled in (marked by withMarkedValues), colored by where they come from.
  const present = ORIGINS.map((o) => o.origin).filter((o) => parts.some((p) => originRuns(p.text).some((r) => r.origin === o)));
  return (
    <OriginView>
    {present.length > 0 && <OriginLegend present={present} />}
    <div className="as-sent">
      {parts.some((p) => p.group) ? (
        groupBy(parts, (p) => p.group ?? SHARED_GROUP).map(([group, inGroup]) => (
          <ToolGroupFold key={group} group={group} count={inGroup.length}>{inGroup.map((p) => <AsSentPartView key={p.key} part={p} />)}</ToolGroupFold>
        ))
      ) : parts.map((p) =>
        p.off === undefined ? (
          <AsSentPartView key={p.key} part={p} />
        ) : (
          <div key={p.key} className="as-sent-line as-sent-off" title={`Not sent now: ${p.off}`}>
            <span><s>{p.label}</s> · not sent: {p.off}</span>
          </div>
        ),
      )}
    </div>
    </OriginView>
  );
}

function AsSentPartView({ part: p }: { part: AsSentPart }) {
  const line = (
    <>
      <strong>{p.icon && <span className="text-group-icon" aria-hidden="true">{p.icon}</span>}{p.label}</strong>
      <span className="muted">{textTokens(stripMarks(p.text))}</span>
      {sentTag(p.sent)}
      <span className="spacer" />
      {p.link}
    </>
  );
  const body = (
    <>
      {p.call && <div className="as-sent-call"><span className="muted">calls</span> <code>{p.call}</code> <span className="muted">→ gets the “tool” message:</span></div>}
      <div className="as-sent-text">{p.code ? <JsonTree value={JSON.parse(p.text)} /> : <BlockText text={p.text} />}</div>
    </>
  );
  const style = { '--part': p.color } as CSSProperties;
  return (
    <div className="as-sent-part" style={style}>
      <div className="as-sent-line">{line}</div>
      {body}
    </div>
  );
}

