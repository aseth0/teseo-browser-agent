// The message box and its button: Send; Stop while the agent runs (Enter then queues what you write,
// ⌘/Ctrl+Enter sends it now: send-queue, QueuedStrip); or Compacting… while the earlier turns are
// compacted before your message goes. Files and images dropped on it are attached. While it dictates,
// the box is framed in red with its strip inside (DictationStrip); while a dictation finishes (its last
// chunks transcribed before the message goes), in amber.
import type { Ref } from 'react';
import type { useAttachments } from './useAttachments';
import { MentionComposer, type ComposerHandle } from './MentionComposer';
import { DictationStrip } from './DictationStrip';
import type { Dictation } from './useDictation';

type ComposerProps = Parameters<typeof MentionComposer>[0];

interface Props {
  composer: Ref<ComposerHandle>;
  box: Omit<ComposerProps, 'ref' | 'placeholder'>; // the message box's own props
  attachments: ReturnType<typeof useAttachments>;
  busy: boolean;
  compacting: boolean;
  dictation?: Dictation;
  canSend: boolean; // something to send: text, an attachment or a recording
  onSend: () => void;
  onStop: () => void;
}

export function ComposerArea({ composer, box, attachments, busy, compacting, dictation, canSend, onSend, onStop }: Props) {
  const state = dictation?.state;
  const finishing = state === 'finishing';
  const framed = state === 'recording' ? ' dictation-recording' : finishing ? ' dictation-finishing' : '';
  return (
    <div className={`composer${framed}`} aria-busy={finishing || undefined} {...attachments.dropProps}>
      <div className="composer-box">
        {dictation && <DictationStrip dictation={dictation} />}
        <MentionComposer ref={composer} {...box} placeholder="Ask something… (Enter sends, Shift+Enter for a new line, :: a site, / a skill, $ a tool, @ an agent, ↑ your previous messages)" />
      </div>
      {busy ? <button onClick={onStop}>Stop</button>
        : compacting ? <button disabled title="The earlier turns are being compacted before your message goes">Compacting…</button>
        : <button onClick={onSend} disabled={!canSend}>Send</button>}
    </div>
  );
}
