// Your messages waiting for the agent to finish (send-queue), above the message box: each goes back
// to the box to be changed (an empty one), goes at once (the agent stopped), or is removed.
import type { QueuedText } from './send-queue';

interface Props {
  items: QueuedText[];
  canEdit: boolean; // the message box is empty
  onEdit: (id: number) => void;
  onSendNow: (id: number) => void;
  onRemove: (id: number) => void;
}

export function QueuedStrip({ items, canEdit, onEdit, onSendNow, onRemove }: Props) {
  if (!items.length) return null;
  return (
    <div className="queued" role="group" aria-label="Queued">
      <span className="muted small">Queued</span>
      {items.map((q) => (
        <span key={q.id} className="chip-removable">
          <button className="queued-text" disabled={!canEdit} title="Edit: back to the message box" onClick={() => onEdit(q.id)}>{q.text}</button>
          <button className="icon-button" aria-label="Stop the agent and send this now" title="Stop the agent and send this now" onClick={() => onSendNow(q.id)}>▶</button>
          <button className="icon-button" aria-label="Remove from the queue" title="Remove from the queue" onClick={() => onRemove(q.id)}>✕</button>
        </span>
      ))}
    </div>
  );
}
