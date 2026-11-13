// What goes with a message without being asked for: the memory items of its site (all whole, or only
// those pinned or matching it: memorySiteMatch), the site skills
// and site templates of its page, and the memory items, saved conversations and bookmarks it matches
// (auto-attach; memory and bookmarks also between the model's steps). Each is on in Settings →
// Auto-inject (an auto-attach is its section's own switch), and can be left out of one conversation
// from the chat's menu (`skip`, sent with each run).
import type { Settings } from '../storage/settings';
import { semanticTarget } from '../memory/semantic';
import { historyOn, memoryOn } from '../storage/settings-select';

export type AutoInjectKind = 'memory' | 'memorySiteMatch' | 'memoryAuto' | 'memoryMeaning' | 'memorySteps' | 'siteSkills' | 'templates' | 'historyAuto' | 'bookmarkAuto' | 'bookmarkSteps';
// Matching memory and bookmarks also between the model's steps (context/step-attach): each on only
// with the auto-attach it belongs to.
export const STEPS_OF: Partial<Record<AutoInjectKind, AutoInjectKind>> = { memorySteps: 'memoryAuto', bookmarkSteps: 'bookmarkAuto' };

// On in Settings: memory and history themselves on too, auto-attach off by default.
export function autoInjectGlobal(settings: Settings, kind: AutoInjectKind): boolean {
  switch (kind) {
    case 'memory':
      return memoryOn(settings) && settings.autoInject?.memory !== false;
    case 'memorySiteMatch': // how site memory goes, not one more thing that goes: not in the chat's menu
      return autoInjectGlobal(settings, 'memory') && settings.autoInject?.memorySiteMatch !== false;
    case 'memoryAuto':
      return memoryOn(settings) && !!settings.memory?.autoAttach?.enabled;
    case 'memoryMeaning': // how memory matches, on in Settings → Memory → Semantic search
      return !!semanticTarget(settings);
    case 'siteSkills':
      return settings.autoInject?.siteSkills !== false;
    case 'templates':
      return settings.autoInject?.templates !== false;
    case 'historyAuto':
      return historyOn(settings) && !!settings.history?.autoAttach?.enabled;
    case 'bookmarkAuto': // and allowed: bookmarks/auto checks it
      return !!settings.bookmarks?.autoAttach?.enabled;
    case 'memorySteps':
      return autoInjectGlobal(settings, 'memoryAuto') && !!settings.memory?.autoAttach?.steps;
    case 'bookmarkSteps':
      return autoInjectGlobal(settings, 'bookmarkAuto') && !!settings.bookmarks?.autoAttach?.steps;
  }
}

// Whether it goes with this conversation's messages (one between steps, also its auto-attach).
export const autoInjectOn = (settings: Settings, kind: AutoInjectKind, skip: readonly AutoInjectKind[] = []): boolean =>
  autoInjectGlobal(settings, kind) && !skip.includes(kind) && (!STEPS_OF[kind] || autoInjectOn(settings, STEPS_OF[kind], skip));
