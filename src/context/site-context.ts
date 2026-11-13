// What a message gets on its own for its page and what you wrote, ahead of anything it mentions: the
// site skills of the page, the memory items for its site, those your message matches; and which site
// skills and templates go with the page block, when the page goes. One function for the message sent
// (context/turn) and the previews (Settings → Prompt preview, Preview conversation), so they agree.
import type { ContextItem } from '../core/messages';
import type { Message } from '../core/types';
import { hostOf } from '../core/util';
import { MEMORY_AUTO_DEFAULTS, type MeaningMatch } from '../memory/items';
import { memoryAutoItems, memorySiteItems, type MemoryPromptOptions, type SiteMatch } from '../memory/prompt';
import type { MemoryItem } from '../memory/store';
import { siteSkillItems, siteSkillsFor } from '../skills/prompt';
import type { Skill } from '../skills/types';
import type { Settings } from '../storage/settings';
import { templatesFor } from '../templates/render';
import type { PageTemplate } from '../templates/types';
import { autoInjectOn, type AutoInjectKind } from './auto-inject';

export interface SiteContextInput {
  settings: Settings;
  skills: Skill[];
  templates: PageTemplate[];
  memory: MemoryItem[]; // the items for the agent (memory/store memoryFor)
  memoryOpts: MemoryPromptOptions | undefined; // what the agent may do with them (context/request memoryPromptOptions)
  url: string | undefined; // the page
  typed: string; // what you wrote (not what goes with it)
  history: Message[]; // up to the message: what was already sent is not sent again
  skip?: readonly AutoInjectKind[]; // left out of this conversation (the chat's menu)
  meaning?: MeaningMatch; // how close in meaning each item is to what you wrote (memory/query-meaning), worked out before: this stays synchronous
}

export interface SiteContext {
  skills: Skill[]; // the page's site skills that go
  templates: PageTemplate[]; // its site templates that go, with the page block
  items: ContextItem[];
}

export function siteContextItems({ settings, skills, templates, memory, memoryOpts, url, typed, history, skip, meaning: given }: SiteContextInput): SiteContext {
  const on = (kind: AutoInjectKind) => autoInjectOn(settings, kind, skip);
  const meaning = on('memoryMeaning') ? given : undefined;
  // By what you wrote, at Auto-attach's match, also with that off. An agent that cannot read an item
  // has no use for its title: it gets them all whole.
  const match: SiteMatch | undefined = on('memorySiteMatch') && memoryOpts?.reads
    ? { typed, threshold: settings.memory?.autoAttach?.threshold ?? MEMORY_AUTO_DEFAULTS.threshold, meaning, searches: memoryOpts.searches, lists: memoryOpts.lists }
    : undefined;
  // Site skills apply on matching pages even without page reading; they come first, outside the
  // untrusted page block.
  const active = on('siteSkills') ? siteSkillsFor(skills, url) : [];
  const items = siteSkillItems(active, history);
  // Then the memory items linked to the open site, also without page reading.
  if (on('memory')) items.push(...memorySiteItems(memory, hostOf(url), history, match));
  // Those your message matches, on their own (Settings → Memory → Auto-attach).
  if (on('memoryAuto')) items.push(...memoryAutoItems(memory, typed, history, settings.memory?.autoAttach, 'message', meaning));
  return { skills: active, templates: on('templates') ? templatesFor(templates, url) : [], items };
}
