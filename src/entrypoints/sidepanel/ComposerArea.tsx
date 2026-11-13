// The message box and its button: Send; Stop while the agent runs (Enter then queues what you write,
// ⌘/Ctrl+Enter sends it now: send-queue, QueuedStrip); or Compacting… while the earlier turns are
// compacted before your message goes. Files and images dropped on it are attached. While a dictation
// finishes (its last chunks transcribed before the message goes), the box shows it.
import type { Ref } from 'react';
import type { useAttachments } from './useAttachments';
import { MentionComposer, type ComposerHandle } from './MentionComposer';

type ComposerProps = Parameters<typeof MentionComposer>[0];

interface Props {
  composer: Ref<ComposerHandle>;
  box: Omit<ComposerProps, 'ref' | 'placeholder'>; // the message box's own props
  attachments: ReturnType<typeof useAttachments>;
  busy: boolean;
  compacting: boolean;
  dictating?: boolean; // a dictation finishing
  canSend: boolean; // something to send: text, an attachment or a recording
  onSend: () => void;
  onStop: () => void;
}

export function ComposerArea({ composer, box, attachments, busy, compacting, dictating, canSend, onSend, onStop }: Props) {
  return (
    <div className={dictating ? 'composer dictating' : 'composer'} aria-busy={dictating || undefined} {...attachments.dropProps}>
      <MentionComposer ref={composer} {...box} placeholder="Ask something… (Enter sends, Shift+Enter for a new line, :: a site, / a skill, $ a tool, ↑ your previous messages)" />
      {busy ? <button onClick={onStop}>Stop</button>
        : compacting ? <button disabled title="The earlier turns are being compacted before your message goes">Compacting…</button>
        : <button onClick={onSend} disabled={!canSend}>Send</button>}
    </div>
  );
}
