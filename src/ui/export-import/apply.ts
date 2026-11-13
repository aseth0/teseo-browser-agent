// An import of Settings → Export and import done: the items picked of each part stored, as each
// section's own import stores them. Agents first: memory and actions name theirs, and are read again
// once the file's agents are here. Providers, themes and settings in one change of the settings.
import { agentStore, type AgentProfile } from '../../agents/profiles';
import { retentionLimit } from '../../storage/retention';
import { retentionCount, storeConversations, type Conversation } from '../../history/store';
import type { McpServerConfig } from '../../mcp/config';
import { addServers, type SaveServers } from '../../mcp/servers';
import { memoryStore, type MemoryItem } from '../../memory/store';
import { withProviders } from '../../providers/io';
import { skillStore } from '../../skills/store';
import type { Skill } from '../../skills/types';
import type { PartKind } from '../../storage/export-file';
import { withSettingChanges, type SettingChange } from '../../storage/settings-transfer';
import type { CustomTheme, HistorySettings, ProviderConfig } from '../../storage/settings-types';
import { templateStore } from '../../templates/store';
import type { PageTemplate } from '../../templates/types';
import { customToolStore } from '../../tools/custom/store';
import type { CustomTool } from '../../tools/custom/types';
import type { WidgetAction } from '../../widget/actions';
import { actionStore } from '../../widget/store';
import type { BlacklistEntry } from '../../word-blacklist/core';
import { mergeEntries } from '../../word-blacklist/io';
import { loadBlacklistEntries, saveBlacklistEntries } from '../../word-blacklist/store';
import { importThemes } from '../themes/theme-file';
import type { SettingsSave } from '../useSettings';
import { readPart, type Current, type Stored } from './parts';

// A part to import: its JSON, and the rows picked (by their place in the preview).
export interface Picked {
  kind: PartKind;
  json: string;
  rows: number[];
}

// What came in of a part: the names, and what was left out (with why).
export interface Done {
  kind: PartKind;
  names: string[];
  leftOut: string[];
}

// How many saved conversations the History setting picked would delete (its retention, applied at the
// next save) when it differs from yours: the import asks first, as Settings → History does.
export async function retentionDeletes(picked: Picked[], cur: Current): Promise<number> {
  const part = picked.find((p) => p.kind === 'settings');
  if (!part?.rows.length) return 0;
  const rows = readPart('settings', part.json, cur).rows;
  const history = part.rows.map((i) => rows[i]?.item as SettingChange | undefined).find((c) => c?.key === 'history')?.value as HistorySettings | undefined;
  const yours = cur.settings.history ?? {};
  if (!history || (['keepDays', 'keepCount'] as const).every((k) => retentionLimit(history[k]) === retentionLimit(yours[k]))) return 0;
  return retentionCount(history);
}

// Agents first; then what the settings hold, in one change; then the rest.
const ORDER: PartKind[] = ['agents', 'providers', 'theme', 'settings', 'skills', 'templates', 'customTools', 'mcpServers', 'actions', 'memory', 'wordBlacklist', 'conversations'];

export async function applyImport(picked: Picked[], cur: Current, { save, reload }: { save: SettingsSave; reload: () => Promise<Stored> }): Promise<Done[]> {
  const done: Done[] = [];
  const agentsIn = picked.some((p) => p.kind === 'agents' && p.rows.length);
  let now = cur;
  let reread = false;
  const change: { providers?: ProviderConfig[]; themes?: CustomTheme[]; settings?: SettingChange[] } = {};
  for (const kind of ORDER) {
    const part = picked.find((p) => p.kind === kind);
    if (part?.rows.length) {
      // Memory and actions read again with the agents just imported.
      if (agentsIn && !reread && (kind === 'memory' || kind === 'actions')) {
        now = { ...cur, ...(await reload()) };
        reread = true;
      }
      const rows = readPart(kind, part.json, now).rows;
      const chosen = part.rows.flatMap((i) => (rows[i]?.item !== undefined ? [rows[i]] : []));
      const items = chosen.map((r) => r.item);
      let names = chosen.map((r) => r.name);
      let leftOut: string[] = [];
      switch (kind) {
        case 'agents': await agentStore.saveMany(items as AgentProfile[]); break;
        case 'skills': await skillStore.saveMany(items as Skill[]); break;
        case 'templates': await templateStore.saveMany(items as PageTemplate[]); break;
        case 'customTools': await customToolStore.saveMany(items as CustomTool[]); break;
        case 'actions': await actionStore.saveMany(items as WidgetAction[]); break;
        case 'memory': await memoryStore.saveMany(items as MemoryItem[]); break;
        case 'conversations': await storeConversations(items as Conversation[]); break;
        case 'wordBlacklist': await saveBlacklistEntries(mergeEntries(await loadBlacklistEntries(), items as BlacklistEntry[]).entries); break;
        case 'mcpServers': {
          const saveServers: SaveServers = (c) => save((prev) => ({ ...prev, mcpServers: c(prev.mcpServers ?? []) }));
          names = (await addServers(saveServers, items as McpServerConfig[])).map((s) => s.name); // under names no other server has
          break;
        }
        case 'providers': change.providers = items as ProviderConfig[]; break;
        case 'settings': change.settings = items as SettingChange[]; break;
        case 'theme': {
          change.themes = items as CustomTheme[];
          ({ names, skipped: leftOut } = importThemes(cur.settings.customThemes ?? [], { themes: change.themes, skipped: [] })); // what does not fit is said
          break;
        }
      }
      done.push({ kind, names, leftOut });
    }
    if (kind === 'settings') await saveChange();
  }
  return done;

  async function saveChange() {
    const { providers, themes, settings } = change;
    if (!providers && !themes && !settings) return;
    await save((prev) => {
      let next = settings ? withSettingChanges(prev, settings) : prev;
      if (providers) next = { ...next, providers: withProviders(next.providers, providers) };
      if (themes) next = { ...next, customThemes: importThemes(next.customThemes ?? [], { themes, skipped: [] }).themes };
      return next;
    });
  }
}
