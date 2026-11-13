// The text selected on the page, when it goes with the next message (in the page block): a chip
// beside the page's host, that also leaves it out of the next message. The injected script tells
// the panel when the selection changes (SELECTION_CHANGED); the panel reads it then, on another
// page, and after each turn.
import { Icon } from '../../ui/chat-icons';
import { useEffect, useState } from 'react';
import type { Clipped } from '../../core/clip';
import { limit } from '../../core/limits';
import { stripMarks, withMarker } from '../../core/model-texts';
import { onRuntime } from '../../core/runtime';
import { callPage } from '../../page/bridge';
import { SELECTION_CHANGED } from '../../page/protocol';
import type { PageTarget } from './usePageTarget';
import type { SpeakButtons } from '../../ui/chat/contexts';
import { SpeakButton } from '../../ui/chat/SpeakButton';

// The selected text on the page while `on` (the page, readable, goes with the next message); none
// otherwise. `refresh`: changes when the page may have changed (e.g. after each turn).
export function useSelection(page: PageTarget, on: boolean, refresh: unknown): Clipped | undefined {
  const [selection, setSelection] = useState<Clipped>();
  const [changes, setChanges] = useState(0);
  const readable = on && page.tabId !== undefined;

  useEffect(() => {
    if (!readable) return;
    return onRuntime(SELECTION_CHANGED, (_msg, sender) => {
      if (sender.tab?.id === page.tabId) setChanges((n) => n + 1);
    });
  }, [readable, page.tabId]);

  useEffect(() => {
    if (!readable) {
      setSelection(undefined);
      return;
    }
    let current = true;
    callPage(page.tabId!, { op: 'selection', maxChars: limit('selection') }).then(
      (s) => current && setSelection(stripMarks(s.text).trim() ? s : undefined),
      () => current && setSelection(undefined),
    );
    return () => {
      current = false;
    };
  }, [readable, page.tabId, page.url, changes, refresh]);

  return selection;
}

// Beside the page's host: how many characters are selected, the text on hover; a click leaves it out
// of the next message (struck through) or puts it back.
// With Speak on, a speaker beside it reads the selection aloud with the active agent's voice.
export function SelectionChip({ selection, off, onToggle, speak, agentId }: { selection: Clipped; off: boolean; onToggle: () => void; speak?: SpeakButtons; agentId?: string }) {
  const shown = stripMarks(withMarker(selection, 'selection'));
  const chars = (selection.total ?? stripMarks(selection.text).length).toLocaleString('en-US');
  const head = off ? 'Selected text, left out of your next message. Click to send it.' : 'Selected text, sent with your next message. Click to leave it out.';
  const chip = (
    <button type="button" className={`selection-chip${off ? ' off' : ''}`} aria-pressed={!off} aria-label={`Selected text: ${chars} characters`}
      title={`${head}\n\n${shown.length > PREVIEW ? `${shown.slice(0, PREVIEW)}…` : shown}`} onClick={onToggle}>
      <Icon name="selection" size={12} /> {chars}
    </button>
  );
  if (!speak) return chip;
  return (
    <span className="selection-chip-group">
      {chip}
      <SpeakButton speak={speak} speakKey="selection" text={stripMarks(selection.text)} agentId={agentId} label="Read the selected text aloud" className="icon-button selection-speak" size={12} />
    </span>
  );
}

const PREVIEW = 600; // characters of the selection in the chip's tooltip
