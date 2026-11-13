import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { Message } from '../../core/types';
import { ChatHistory, type ToolResultPart } from '../ChatMessages';
import { TECH_ICON } from '../icons';
import { answerTo, bubbleOf, type CallView } from './calls';
import { ReceivedSection } from './CallSection';
import { reported, sum, usageLabel, type Usage } from './usage';

// The chat as in Markdown (its steps grouped as Settings → Appearance says); at the end of each
// message's last line (or its block of steps'), what crossed there as the server reported it (↑ the
// call it sent, ↓ its own call's answer) and a chip that shows its layers under it: 📥 what came back
// from its call, 📤 the call it sent. The call that sent back the tools' results is the answer's that
// asked for them.
export function ChatWithCalls(props: {
  chat: Message[];
  calls: CallView[];
  results: Map<string, ToolResultPart>;
  running: boolean;
  open?: boolean; // the layers start open
  section: (call: CallView, index: number, reported?: number) => ReactNode;
}) {
  const { chat, calls } = props;
  // Each message's index, and the calls that hang under each bubble, by index: looked up for every
  // message, so not searched for each.
  const { indexOf, callsUnder } = useMemo(() => {
    const callsUnder = new Map<number, number[]>();
    calls.forEach((c, n) => {
      const at = bubbleOf(chat, c);
      callsUnder.set(at, [...(callsUnder.get(at) ?? []), n]);
    });
    return { indexOf: new Map(chat.map((m, i) => [m, i])), callsUnder };
  }, [chat, calls]);
  // The layers of a message: 'received' (an answer's), and the calls that hang under it, by index.
  const layersOf = (i: number): Layer[] => [...(chat[i]?.role === 'assistant' ? ['received' as const] : []), ...(callsUnder.get(i) ?? [])];
  // Whether a group's layers are shown (each folds by its title, staying there), by its first
  // message; a group not toggled yet: as Settings says.
  const [shownBy, setShownBy] = useState<Map<number, boolean>>(new Map());
  const isShown = (i: number) => shownBy.get(i) ?? !!props.open;

  const usageAt = (i: number): Usage => {
    const own = chat[i]!.role === 'assistant' ? reported(chat[i]!.meta) : undefined;
    const sent = layersOf(i).flatMap((l) => (l === 'received' ? [] : (reported(answerTo(chat, calls[l]!)?.meta)?.input ?? [])));
    return { ...(own && { out: { tokens: own.output, ms: own.ms } }), sent };
  };

  // At the end of a line: what crossed there (one message's, or the totals of a block's calls, each
  // on hover) and the chip that shows their layers.
  // The messages of a group that have layers, by index.
  const withLayers = (ms: Message[]) => ms.map((m) => indexOf.get(m) ?? -1).filter((i) => layersOf(i).length);

  const trailing = (ms: Message[]) => {
    const at = withLayers(ms);
    if (!at.length) return null;
    const key = at[0]!;
    const shown = isShown(key);
    const each = at.map(usageAt);
    const outs = each.flatMap((u) => (u.out ? [u.out] : []));
    const sent = each.flatMap((u) => u.sent);
    const total: Usage = { out: outs.length ? { tokens: sum(outs.map((o) => o.tokens)), ms: sum(outs.map((o) => o.ms)) } : undefined, sent: sent.length ? [sum(sent)] : [] };
    const label = at.length === 1 ? usageLabel(each[0]!) : outs.length ? `${at.length} calls · ${usageLabel(total)}` : '';
    const detail = at.length === 1 ? label : each.map((u, n) => `${n + 1}. ${usageLabel(u) || 'not reported'}`).join('\n');
    return (
      <>
        {label && <span className="layer-stats" title={`As the server reported it${at.length > 1 ? ', in total; each call:' : ''}\n${detail}`}>{label}</span>}
        <button
          type="button"
          className={`layer-chip${shown ? ' on' : ''}`}
          title={shown ? 'Hide the layers' : 'Show the layers: what came back from each call and what was sent'}
          aria-label="Layers"
          aria-pressed={shown}
          onClick={(e) => {
            e.preventDefault(); // inside a summary: not that block's
            e.stopPropagation();
            setShownBy((was) => new Map(was).set(key, !shown));
          }}
        >
          {TECH_ICON}
        </button>
      </>
    );
  };
  const below = (ms: Message[]) => {
    const at = withLayers(ms);
    if (!at.length || !isShown(at[0]!)) return null;
    return at.flatMap((i) =>
      layersOf(i).map((l) =>
        l === 'received' ? (
          <ReceivedSection key={`${i}-r`} message={chat[i]!} />
        ) : (
          <Fragment key={`${i}-${l}`}>{props.section(calls[l]!, l, reported(answerTo(chat, calls[l]!)?.meta)?.input)}</Fragment>
        ),
      ),
    );
  };
  return <ChatHistory history={chat} results={props.results} running={props.running} format="markdown" layers={{ trailing, below }} />;
}

type Layer = number | 'received';
