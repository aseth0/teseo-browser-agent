// What Settings → Export and import does with each part, given what is here now: how many there are
// to export, the part as its section's own Export writes it, and what importing a part would do (a row
// each, as the sections' previews show them), read by the section's own import. Nothing here stores.
import type { AgentProfile } from '../../agents/profiles';
import { exportAgents, importAgents } from '../../agents/io';
import type { ToolInfo } from '../../core/protocol';
import { importServers, exportServers } from '../../mcp/config';
import { exportMemory, importMemory } from '../../memory/io';
import type { MemoryItem } from '../../memory/store';
import { exportProviders, exportableProviders, importProviders } from '../../providers/io';
import type { Skill } from '../../skills/types';
import { exportSkills, importSkills } from '../../skills/io';
import type { PartKind } from '../../storage/export-file';
import type { ImportRow } from '../../storage/import';
import { exportSettingsPart, importSettingsPart } from '../../storage/settings-transfer';
import type { Settings } from '../../storage/settings-types';
import type { PageTemplate } from '../../templates/types';
import { exportTemplates, importTemplates } from '../../templates/io';
import { exportCustomTools, importCustomTools } from '../../tools/custom/io';
import type { CustomTool } from '../../tools/custom/types';
import type { WidgetAction } from '../../widget/actions';
import { exportActions, importActions } from '../../widget/io';
import { termKey, usableEntries, type BlacklistEntry } from '../../word-blacklist/core';
import { exportBlacklist, parseBlacklistFile } from '../../word-blacklist/io';
import type { ConversationMeta } from '../../history/store';
import { readConversations } from '../../history/store';
import { exportThemes, parseThemes } from '../themes/theme-file';
import { findTheme } from '../themes/theme-model';

// Everything here now that the parts are made from, or compared with.
export interface Current extends Stored {
  settings: Settings;
  catalog: ToolInfo[];
}

// What of it is kept in the stored lists (read again after an import).
export interface Stored {
  agents: AgentProfile[];
  skills: Skill[];
  templates: PageTemplate[];
  memory: MemoryItem[];
  blacklist: BlacklistEntry[];
  customTools: CustomTool[];
  actions: WidgetAction[];
  conversations: ConversationMeta[];
}

const own = <T extends { builtin?: boolean }>(items: T[]) => items.filter((i) => !i.builtin);

// How many of a kind an export takes (the settings: those set).
export function countOf(kind: PartKind, cur: Current): number {
  switch (kind) {
    case 'agents': return own(cur.agents).length;
    case 'skills': return own(cur.skills).length;
    case 'templates': return own(cur.templates).length;
    case 'memory': return cur.memory.length;
    case 'wordBlacklist': return usableEntries(cur.blacklist).length;
    case 'customTools': return own(cur.customTools).length;
    case 'mcpServers': return cur.settings.mcpServers?.length ?? 0;
    case 'actions': return own(cur.actions).length;
    case 'theme': return cur.settings.customThemes?.length ?? 0;
    case 'conversations': return cur.conversations.length;
    case 'providers': return exportableProviders(cur.settings.providers).length;
    case 'settings': return Object.keys(JSON.parse(exportSettingsPart(cur.settings)) as object).length;
  }
}

// The part as its section exports it, without secrets (never with keys); the conversations are read
// apart (they are large: history/store exportAll).
export function exportPart(kind: Exclude<PartKind, 'conversations'>, cur: Current): string {
  switch (kind) {
    case 'agents': return exportAgents(own(cur.agents));
    case 'skills': return exportSkills(own(cur.skills));
    case 'templates': return exportTemplates(own(cur.templates));
    case 'memory': return exportMemory(cur.memory, cur.agents);
    case 'wordBlacklist': return exportBlacklist(cur.blacklist);
    case 'customTools': return exportCustomTools(own(cur.customTools), false);
    case 'mcpServers': return exportServers(cur.settings.mcpServers ?? [], false);
    case 'actions': return exportActions(own(cur.actions), cur.agents);
    case 'theme': return exportThemes(cur.settings.customThemes ?? []);
    case 'providers': return exportProviders(cur.settings.providers);
    case 'settings': return exportSettingsPart(cur.settings);
  }
}

export interface PartRead {
  rows: ImportRow<unknown>[];
  notes: string[];
}

const leftOut = (name: string, why: string): ImportRow<unknown> => ({ name, status: 'left-out', why });

// What importing the part would do; throws why it cannot be read at all.
export function readPart(kind: PartKind, json: string, cur: Current): PartRead {
  switch (kind) {
    case 'agents': return { rows: importAgents(json, cur.agents).rows, notes: [] };
    case 'skills': return { rows: importSkills(json, cur.skills).rows, notes: [] };
    case 'templates': return { rows: importTemplates(json, cur.templates).rows, notes: [] };
    case 'memory': {
      const { rows, notes } = importMemory(json, cur.memory, cur.agents);
      return { rows, notes };
    }
    case 'actions': return { rows: importActions(json, cur.actions, cur.agents, cur.settings.providers.map((p) => p.id)).rows, notes: [] };
    case 'customTools': {
      const { rows, needSession } = importCustomTools(json, cur.customTools, cur.catalog);
      return { rows, notes: needSession.map((n) => `${n} takes a cookie in a header: tick "Send the browser's session for this site" in it (a file never turns it on).`) };
    }
    case 'mcpServers': {
      const { servers, skipped } = importServers(json, cur.settings.mcpServers ?? []);
      const rows = [...servers.map((s): ImportRow<unknown> => ({ name: s.name, status: 'new', item: s })), ...skipped.map((n) => leftOut(n, `${n}: local servers (command) are not supported yet.`))];
      return { rows, notes: servers.length ? ['They come in off: test them, and sign in to those that ask.'] : [] };
    }
    case 'theme': {
      const { themes, skipped } = parseThemes(json);
      const mine = cur.settings.customThemes ?? [];
      return { rows: [...themes.map((t): ImportRow<unknown> => ({ name: t.name, status: findTheme(mine, t.name) ? 'replaces' : 'new', item: t })), ...skipped.map((why) => leftOut('A theme', why))], notes: [] };
    }
    case 'wordBlacklist': {
      const entries = parseBlacklistFile(json);
      if (!entries) throw new Error('Not a word blacklist file.');
      const rows: ImportRow<unknown>[] = [];
      let same = 0;
      for (const e of entries) {
        const here = cur.blacklist.find((x) => x.term.trim() && termKey(x.term) === termKey(e.term));
        if (here && here.replacement.trim() === e.replacement) same++;
        else rows.push({ name: `${e.term} → ${e.replacement || '(removed)'}`, status: here ? 'replaces' : 'new', item: e });
      }
      return { rows, notes: same ? [`${same} ${same === 1 ? 'term is' : 'terms are'} already here as in the file.`] : [] };
    }
    case 'conversations': {
      const { conversations, skipped } = readConversations(json);
      const ids = new Set(cur.conversations.map((c) => c.id));
      const rows = conversations.map((c): ImportRow<unknown> => ({ name: c.title, status: ids.has(c.id) ? 'replaces' : 'new', item: c }));
      return { rows, notes: skipped ? [`${skipped} could not be read: left out.`] : [] };
    }
    case 'providers': {
      const rows = importProviders(json, cur.settings.providers);
      const keyless = rows.filter((r) => r.status === 'new').length;
      return { rows, notes: keyless ? ['New providers come without a key: add it in Providers.'] : [] };
    }
    case 'settings': return { rows: importSettingsPart(json, cur.settings), notes: [] };
  }
}
