// The memory items, over the chat (the memory button next to the history's): those that go with
// the next message first (for the agent you talk to, on this page's site), each with pin and delete
// only; the whole text on hover. Settings → Memory edits them.
import { Icon } from '../../ui/chat-icons';
import { useMemo, useState } from 'react';
import { agentStore } from '../../agents/profiles';
import { hostOf } from '../../core/util';
import { memoryLabel } from '../../memory/store';
import { searchMemory } from '../../memory/items';
import { openOptions } from '../../ui/open-options';
import { MemoryActions, memoryOrder, memoryScope, useMemory } from '../../ui/Memory';
import { useCollection } from '../../ui/useCollection';
import { useSettingsContext } from '../../ui/settings-context';
import { PanelHead } from './PanelHead';
import { autoInjectGlobal } from '../../context/auto-inject';

export function MemoryPanel({ agentId, url, onClose }: { agentId?: string; url?: string; onClose: () => void }) {
  const items = useMemory();
  const { settings } = useSettingsContext();
  const agents = useCollection(agentStore);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => (query.trim() ? searchMemory(items, query, { prefix: true }) : memoryOrder(items, agentId, hostOf(url))), [items, query, agentId, url]);
  return (
    <div className="overlay-panel memory-panel" role="dialog" aria-label="Memory">
      <PanelHead query={query} onQuery={setQuery} placeholder='Search memory… ("a phrase" in quotes)' label="Search memory" onClose={onClose}>
        <button onClick={() => void openOptions('memory')} title="Add and edit items in Settings → Memory">Edit…</button>
      </PanelHead>
      <div className="history-list">
        {!shown.length && <p className="muted">{query ? 'No item matches.' : 'No memory yet: ask the model to remember something, or add items in Settings → Memory.'}</p>}
        {shown.map((m) => (
          <div key={m.id} className={`history-item${m.enabled ? '' : ' off'}`} title={m.text}>
            <div className="history-open">
              <span className="history-title">{m.pinned && <><Icon name="pin" size={11} /> </>}{memoryLabel(m)}</span>
              <span className="history-meta">{[memoryScope(m, agents, autoInjectGlobal(settings, 'memorySiteMatch')), !m.enabled && 'switched off'].filter(Boolean).join(' · ')}</span>
            </div>
            <MemoryActions item={m} />
          </div>
        ))}
      </div>
    </div>
  );
}
