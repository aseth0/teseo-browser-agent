// A call's sections: what one request sent (CallSection) and what came back from it (ReceivedSection).
import { Icon } from '../chat-icons';
import { stripMarks } from '../../core/model-texts';
import type { Message } from '../../core/types';
import { toOpenAIMessages } from '../../providers/wire';
import { compactionLabel, compactionShort, leftOutSentence } from '../chat/compaction-text';
import { CopyIconButton } from '../icons';
import { BlockText, PromptSection } from '../PromptSection';
import { labelled, textTokens, tokensLabel } from '../request-parts';
import { contentOf, type CallView, type Piece, type Pieces } from './calls';
import { reported, reportedLabel } from './usage';

// `originOn`: how it starts (in the chat, from Settings → Appearance). In the chat it is a layer,
// shown under the message it went out after. `reported`: its input tokens as the server reported
// them; else estimated.
export function CallSection(props: {
  call: CallView;
  id: string;
  inChat: boolean;
  origin?: boolean;
  originOn?: boolean;
  reported?: number;
  tools: unknown[];
  toolGroups: { label: string; count: number; tokens: number }[]; // what the definitions weigh, by group
  viewsInTitle?: boolean; // its buttons in its title (Prompt preview)
}) {
  const { call } = props;
  // The latest compaction before it: its earlier turns went compacted (the one before is in it).
  const compaction = call.history.findLast((m) => m.compaction)?.compaction;
  return (
    <PromptSection
      id={props.id}
      className={props.inChat ? 'layer sent' : undefined}
      viewsInTitle={props.viewsInTitle}
      origin={props.origin}
      originOn={props.originOn}
      defaultOpen={props.inChat ? true : undefined}
      icon={props.inChat && <Icon name="sent" size={12} />}
      title={`${props.inChat ? `Sent · ${call.title}` : call.title}${compaction ? ' · compacted' : ''}`}
      meta={props.reported === undefined ? tokensLabel(call.total) : reportedLabel(props.reported)}
      hint={call.why}
      copyText={() => labelled(call.clean.map((m, j) => [`${j + 1} · ${m.role}`, contentOf(m)]))}
      json={call.body}
    >
      {compaction && (
        <p className="hint conv-compacted">
          Earlier turns went compacted: {compactionLabel(compaction)}.{' '}
          {compaction.summary ? 'Their summary is the first piece of the first message.' : leftOutSentence(compaction)}
          {compaction.short && ` ${compactionShort(compaction)}`}
        </p>
      )}
      <CallMessages call={call} grouped={props.inChat} />
      <details className="text-block conv-tools">
        <summary>
          <span className="muted">
            + tools: {props.tools.length} definitions, {tokensLabel(props.toolGroups.reduce((n, g) => n + g.tokens, 0))}, sent unchanged in every call
          </span>
          <CopyIconButton text={() => JSON.stringify(props.tools, null, 2)} label="Copy the tool definitions (JSON)" />
        </summary>
        <table className="context-table conv-tool-groups">
          <tbody>
            {props.toolGroups.map((g) => (
              <tr key={g.label}>
                <td>{g.label}</td>
                <td className="muted">{g.count} {g.count === 1 ? 'tool' : 'tools'}</td>
                <td>{tokensLabel(g.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Untick the ones you do not need in the tools and MCP menus: every call is lighter.</p>
      </details>
    </PromptSection>
  );
}

// The messages of one request, each tagged as resent or new in this call. `grouped` (in the chat):
// the new ones first, the system message and the resent ones folded together after them.
function CallMessages({ call, grouped }: { call: CallView; grouped: boolean }) {
  const one = (j: number) => {
    const m = call.marked[j]!;
    const isNew = j >= call.resent;
    return (
      <details key={j} className={`text-block conv-msg${isNew ? ' new' : ''}`} open={isNew && m.role !== 'system'}>
        <summary>
          <span className={`conv-tag${isNew ? ' new' : ''}`} title={isNew ? 'New in this call' : 'Sent before, again in this call'}>{isNew ? 'New' : 'resent'}</span>
          <strong>{m.role}</strong>
          <span className="muted">{textTokens(contentOf(call.clean[j]!))}</span>
        </summary>
        {call.pieces[j] ? <MessagePieces pieces={call.pieces[j]} /> : <BlockText text={contentOf(m)} />}
      </details>
    );
  };
  const all = call.marked.map((_, j) => j);
  if (!grouped) return <>{all.map(one)}</>;
  const before = all.filter((j) => j < call.resent || call.marked[j]!.role === 'system');
  const resent = before.filter((j) => call.marked[j]!.role !== 'system').length;
  return (
    <>
      {all.filter((j) => !before.includes(j)).map(one)}
      <details className="text-block conv-before">
        <summary>
          <span className="muted">+ system{resent ? ` and ${resent} resent ${resent === 1 ? 'message' : 'messages'}` : ''}</span>
          <span className="muted">{textTokens(before.map((j) => contentOf(call.clean[j]!)).join('\n'))}</span>
        </summary>
        {before.map(one)}
      </details>
    </>
  );
}

// What came back from one call, piece by piece as the model returned it: its reasoning, its text
// and each tool call with its arguments; its tokens as the server reported them, else estimated.
export function ReceivedSection({ message }: { message: Message }) {
  const pieces = message.parts.flatMap((p): Piece[] => {
    if (p.type === 'reasoning' && p.text.trim()) return [{ label: 'Reasoning', text: p.text }];
    if (p.type === 'text' && p.text.trim()) return [{ label: 'Text', text: p.text }];
    if (p.type === 'tool_call') return [{ label: `Tool call · ${p.name}`, text: JSON.stringify(p.args, null, 2) }];
    return [];
  });
  const wire = toOpenAIMessages(undefined, [message]);
  const usage = reported(message.meta);
  return (
    <PromptSection
      id="chat.received"
      className="layer received"
      defaultOpen
      icon={<Icon name="received" size={12} />}
      title="Received"
      meta={usage ? reportedLabel(usage.output) : textTokens(pieces.map((p) => p.text).join('\n'))}
      copyText={labelled(pieces.map((p) => [p.label, p.text]))}
      json={wire}
    >
      <div className="conv-pieces">
        {pieces.map((p, i) =>
          p.label === 'Text' ? (
            <div key={i} className="conv-piece typed">
              <div className="conv-piece-head"><span>{p.label}</span><span className="muted">{textTokens(p.text)}</span></div>
              <BlockText text={p.text} />
            </div>
          ) : (
            <details key={i} className="conv-piece" open={p.label !== 'Reasoning'}>
              <summary className="conv-piece-head"><span>{p.label}</span><span className="muted">{textTokens(p.text)}</span></summary>
              <BlockText text={p.text} />
            </details>
          ),
        )}
        {!pieces.length && <p className="hint conv-nothing">Nothing came back yet.</p>}
      </div>
    </PromptSection>
  );
}

// One of your messages as it went: what you typed, then each attached block, folded, with its size.
function MessagePieces({ pieces }: { pieces: Pieces }) {
  return (
    <div className="conv-pieces">
      {pieces.list.map((p, i) =>
        p.label === 'Your message' ? (
          <div key={i} className="conv-piece typed">
            <div className="conv-piece-head"><span>{p.label}</span><span className="muted">{textTokens(stripMarks(p.text))}</span></div>
            <BlockText text={p.text} />
          </div>
        ) : (
          <details key={i} className="conv-piece">
            <summary className="conv-piece-head"><span>{p.label}</span><span className="muted">{textTokens(stripMarks(p.text))}</span></summary>
            <BlockText text={p.text} />
          </details>
        ),
      )}
      {pieces.nothingAttached && <p className="hint conv-nothing">{pieces.nothingAttached}</p>}
      {pieces.autoAttach && <p className="hint conv-nothing">{pieces.autoAttach}</p>}
    </div>
  );
}
