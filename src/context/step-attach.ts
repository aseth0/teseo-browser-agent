// What goes on its own between the model's steps (Settings → Memory, Bookmarks → Auto-attach → "Also
// between the model's steps"): the memory items and bookmarks that what the model wrote before calling
// a tool matches, as with your message (same match needed, same maximum, per step), each once in the
// conversation (as the model still sees it: context/compaction seenWhole). The agent loop adds them after that step's last tool result (LoopContext.attachAfter).
import { bookmarkAutoItems } from '../bookmarks/auto';
import type { ContextItem } from '../core/messages';
import type { Message } from '../core/types';
import { memoryAutoItems } from '../memory/prompt';
import type { MemoryItem } from '../memory/store';
import type { Settings } from '../storage/settings';
import { autoInjectOn, type AutoInjectKind } from './auto-inject';
import { seenWhole } from './compaction';

export async function stepAttachItems(reply: string, history: Message[], settings: Settings, memory: MemoryItem[], skip?: AutoInjectKind[]): Promise<ContextItem[]> {
  if (!reply.trim()) return [];
  const items: ContextItem[] = [];
  const seen = seenWhole(history);
  if (autoInjectOn(settings, 'memorySteps', skip)) items.push(...memoryAutoItems(memory, reply, seen, settings.memory?.autoAttach, 'step'));
  if (autoInjectOn(settings, 'bookmarkSteps', skip)) items.push(...(await bookmarkAutoItems(reply, seen, settings, 'step')));
  return items;
}
