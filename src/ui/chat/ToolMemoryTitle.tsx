// The title of the memory item a memory tool call names by id (read, update, delete), in its row and
// over its arguments, so the call says which item it is about. None when the item is gone (deleted since).
import { MEMORY_DELETE, MEMORY_READ, MEMORY_SAVE } from '../../core/memory-names';
import { memoryLabel, memoryStore } from '../../memory/store';
import { toWireName } from '../../core/tool-registry';
import { Icon } from '../chat-icons';
import { useCollection } from '../useCollection';

const BY_ID = new Set([MEMORY_READ, MEMORY_SAVE, MEMORY_DELETE].map(toWireName));

// The id a call names, for a memory tool that takes one.
export function memoryIdOf(name: string, args: unknown): string | undefined {
  if (!BY_ID.has(toWireName(name)) || !args || typeof args !== 'object') return undefined;
  const id = (args as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

export function ToolMemoryTitle({ id, inArgs }: { id: string; inArgs?: boolean }) {
  const item = useCollection(memoryStore).find((m) => m.id === id);
  if (!item) return null;
  const title = memoryLabel(item);
  if (inArgs) return <div className="tool-args-memory"><Icon name="memory" size={12} /> {id}: {title}</div>;
  return <span className="tool-tab" title={`Memory item ${id}: ${title}`}><Icon name="memory" size={12} /> {title}</span>;
}
