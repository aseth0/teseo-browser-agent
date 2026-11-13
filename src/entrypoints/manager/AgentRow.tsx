// A row of the agent manager: ⚠ while its agent waits for you, the chat and its agent, its page, what it
// does now; ↗ goes to its tab, ✕ removes it (asked first while it works or waits: removing stops it).
// A stopped one (from the last time the page was open) says so, and goes on once clicked. One another
// row's agent started is set in under it, joined to it by the tree's guide line (its title names that agent).
import { hostOf } from '../../core/util';
import { Icon } from '../../ui/chat-icons';
import { InlineConfirm } from '../../ui/InlineConfirm';
import { isBusy, nowText, rowTitle, type Row, type TreePlace } from '../../manager/rows';
import { goToTab } from '../../manager/tabs';

export function AgentRow({ row, selected, now, tree, onSelect, onRemove }: { row: Row; selected: boolean; now: number; tree: TreePlace; onSelect: () => void; onRemove: () => void }) {
  const { status } = row;
  const state = status?.state ?? 'idle';
  return (
    <div className={`manager-row${selected ? ' selected' : ''}${tree ? ` tree-${tree}` : ''}`} role="listitem">
      <button className={`manager-row-main${row.stopped ? ' stopped' : ''}`} onClick={onSelect} aria-current={selected || undefined}
        title={[row.parent && `Started by ${row.parentName ?? 'another agent'}`, row.stopped && 'Go on with it'].filter(Boolean).join('. ') || undefined}>
        <span className="manager-row-mark">{state === 'waiting' && <Icon name="error" />}</span>
        <span className="manager-row-chat">
          <span className="manager-row-title">{rowTitle(row)}</span>
          <span className="muted small">{status?.agentName ?? row.agentName}</span>
        </span>
        <span className="manager-row-page muted small">{status?.pageTitle || hostOf(status?.url)}</span>
        <span className="manager-row-now small">
          {status && <span className={`manager-dot ${state}`} aria-hidden="true" />}
          {nowText(status, now, row.stopped)}
        </span>
      </button>
      <button className="icon-button" onClick={() => void goToTab(row.tabId)} title="Go to its tab" aria-label="Go to its tab">
        <Icon name="goTo" />
      </button>
      {isBusy(row) ? (
        <InlineConfirm question="Stop this agent and remove it?" action="Remove" onConfirm={onRemove}>
          {(ask) => <RemoveButton onClick={ask} disabled={row.removing} />}
        </InlineConfirm>
      ) : (
        <RemoveButton onClick={onRemove} disabled={row.removing} />
      )}
    </div>
  );
}

const RemoveButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => (
  <button className="icon-button" onClick={onClick} disabled={disabled} title="Remove" aria-label="Remove">
    <Icon name="close" />
  </button>
);
