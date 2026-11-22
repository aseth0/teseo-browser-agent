// What the chat reads from the settings, and changes to them made by more than one page.
import { debuggerAvailable, floatingChatAvailable } from '../core/build';
import { DISPLAY_IDS, displayFrom, type DisplayId, type DisplayValue, type DisplayValues } from '../core/display-defs';
import { levelOf, type AlertLevel, type InteractionKind } from '../core/interaction-kinds';
import { modelKey } from '../core/util';
import type { ThinkingLevel } from '../providers/thinking';
import type { KeyChange } from './watch';
import type { AttachDefaults, AutoAttach, MatchAttach, Mentions, PopupItem, PopupView, ProviderConfig, Settings, StepAttach } from './settings-types';

// Switches that are on by default (no value yet).
export const historyOn = (s: Settings) => s.history?.enabled ?? true;
export const memoryOn = (s: Settings) => s.memory?.enabled ?? true;
// Settings → Tools: the tools that create things offered once the model loads them (tools/load).
export const createOnDemand = (s: Settings) => s.tools?.createOnDemand ?? true;
export const includePageOn = (s: Settings) => s.includePage ?? true;
// Never where the browser has no debugger API (Firefox).
export const devtoolsOn = (s: Settings) => s.devtoolsTools === true && debuggerAvailable();
export const panelFollowsOn = (s: Settings) => s.panelFollows ?? true;
// Where the bubble and its actions open the chat (Settings → Bubble → Opening the chat): floating only where
// the chat can float (core/build floatingChat); else the side panel, the default, whatever was saved.
export const chatOpensIn = (s: Pick<Settings, 'chatWindow'> | undefined): 'panel' | 'floating' =>
  s?.chatWindow?.opens === 'floating' && floatingChatAvailable() ? 'floating' : 'panel';
// Whether the toolbar popup shows an item (Settings → Appearance → Popup).
export const popupShows = (view: PopupView | undefined, item: PopupItem) => !view?.hidden?.includes(item);
// What the chat shows (Settings → Display): an element's value, the default where none is stored, the
// one stored is not one this build has, or the element is locked; and all of them at once.
export const displayOf = <K extends DisplayId>(s: Pick<Settings, 'display'>, id: K): DisplayValue<K> => displayFrom(id, s.display?.[id]);
export const displayValues = (s: Pick<Settings, 'display'>): DisplayValues =>
  Object.fromEntries(DISPLAY_IDS.map((id): [string, string] => [id, displayOf(s, id)])) as DisplayValues;
// How an interaction that waits for the user alerts while the chat is not in view (Settings → Alerts).
export const alertLevel = (s: Pick<Settings, 'interactions'>, kind: InteractionKind): AlertLevel => levelOf(s.interactions, kind);
export type MentionKind = Exclude<keyof Mentions, 'forceTool'>;
export const mentionsOn = (s: Pick<Settings, 'mentions'>, kind: MentionKind) => s.mentions?.[kind] ?? true;

// Whether a change to the stored settings (storage.local, a watchKey change) changes what `select`
// reads of them.
export const settingChanged = (change: KeyChange | undefined, select: (s: Settings) => unknown) =>
  !!change && JSON.stringify(select((change.oldValue ?? {}) as Settings)) !== JSON.stringify(select((change.newValue ?? {}) as Settings));

export const attachMax = (auto: MatchAttach, d: AttachDefaults) => Math.min(d.most, Math.max(1, auto.max ?? d.max));

// The provider and model the chat uses: the agent's (Settings → Agents), else the chosen ones, else the
// first provider's default model.
export function activeTarget(s: Settings, agent?: { providerId?: string; model?: string }): { provider?: ProviderConfig; model: string } {
  if (agent?.model) {
    const own = s.providers.find((p) => p.id === agent.providerId);
    if (own) return { provider: own, model: agent.model };
  }
  const provider = s.providers.find((p) => p.id === s.activeProviderId) ?? s.providers[0];
  return { provider, model: s.activeModel || provider?.defaultModel || '' };
}

// Thinking levels are remembered per provider and model; none means the server's default.

export const thinkingLevel = (s: Settings, providerId: string, model: string): ThinkingLevel | undefined =>
  s.thinking?.[modelKey(providerId, model)];

export function withThinkingLevel(s: Settings, providerId: string, model: string, level: ThinkingLevel | undefined): Settings {
  const key = modelKey(providerId, model);
  const { [key]: _old, ...rest } = s.thinking ?? {};
  return { ...s, thinking: level ? { ...rest, [key]: level } : rest };
}

// A section's auto-attach with `change` made (Settings → Memory, Bookmarks, History, Auto-inject):
// that section, as a change to the settings.
type AutoAttachOf = { memory: StepAttach; bookmarks: StepAttach; history: AutoAttach };
export function withAutoAttach<K extends keyof AutoAttachOf>(settings: Settings, section: K, change: Partial<AutoAttachOf[K]>): Partial<Settings> {
  const now: { autoAttach?: object } = settings[section] ?? {};
  return { [section]: { ...now, autoAttach: { ...now.autoAttach, ...change } } };
}
