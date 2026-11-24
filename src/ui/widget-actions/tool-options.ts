// The tools an action's tool is picked from, as its select lists them: under their groups
// (core/tool-groups), the built-in ones and the servers' first, then the user's custom tools.
// `blocked`: custom tools listed but not to pick (on page load, those that change things), each
// saying why.
import type { ToolInfo } from '../../core/protocol';
import { toolGroup, toolGroupLabel } from '../../core/tool-groups';

export interface ToolOption {
  name: string;
  label: string;
  disabled?: true;
}
export interface ToolOptionGroup {
  id: string;
  label: string;
  options: ToolOption[];
}

export const BLOCKED_ON_LOAD = 'changes things: not on page load';

// The custom tools an action on page load cannot run: those that change things.
export const blockedOnLoad = (tools: ToolInfo[]) => tools.filter((t) => t.source === 'custom' && t.effect !== 'read');

const isCustomGroup = (group: string) => group === 'custom' || group.startsWith('custom:');
// A section of the custom tools says it is one: its name alone could be a built-in group's.
const groupLabel = (group: string) => (group.startsWith('custom:') ? `Custom tools · ${toolGroupLabel(group)}` : toolGroupLabel(group));

export function toolOptionGroups(tools: ToolInfo[], blocked: ToolInfo[] = []): ToolOptionGroup[] {
  const off = new Set(blocked.map((t) => t.name));
  const all = [...tools.filter((t) => !off.has(t.name)), ...blocked].sort((a, b) => a.name.localeCompare(b.name));
  const groups = Object.entries(Object.groupBy(all, toolGroup)).map(([id, list]): ToolOptionGroup => ({
    id,
    label: groupLabel(id),
    options: list!.map((t) =>
      off.has(t.name)
        ? { name: t.name, label: `${t.name} (${BLOCKED_ON_LOAD})`, disabled: true }
        : { name: t.name, label: `${t.name}${t.effect === 'write' ? ' (asks first)' : ''}` },
    ),
  }));
  return [...groups.filter((g) => !isCustomGroup(g.id)), ...groups.filter((g) => isCustomGroup(g.id))];
}
