// Adding, editing and removing MCP servers: unique names, and the keys moved only once the list is saved.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '../src/mcp/config';

const events: string[] = [];
const moveServerKeys = vi.fn(async (from: string, to: string | undefined) => void events.push(`move ${from} → ${to ?? '-'}`));
vi.mock('../src/mcp/server-keys', () => ({ moveServerKeys }));
const { addServers, removeServer, updateServer } = await import('../src/mcp/servers');

const server = (id: string, name: string): McpServerConfig => ({ id, name, url: `https://${name}.example.com/mcp`, headers: {}, enabled: true });
let list: McpServerConfig[] = [];
let failing = false;
const save = async (change: (servers: McpServerConfig[]) => McpServerConfig[]) => {
  await Promise.resolve();
  if (failing) throw new Error('quota');
  list = change(list);
  events.push('saved');
};

beforeEach(() => {
  list = [server('1', 'notes')];
  failing = false;
  events.length = 0;
  moveServerKeys.mockClear();
});

describe('MCP servers', () => {
  it('are added under names no other server has', async () => {
    const named = await addServers(save, [server('2', 'notes'), server('3', 'notes')]);
    expect(named.map((s) => s.name)).toEqual(['notes_2', 'notes_3']);
    expect(list.map((s) => s.name)).toEqual(['notes', 'notes_2', 'notes_3']);
    expect(moveServerKeys).not.toHaveBeenCalled();
  });

  it('move their keys after the rename is saved, and not when only edited', async () => {
    await updateServer(save, { ...server('1', 'notes'), url: 'https://other.example.com/mcp' });
    expect(events).toEqual(['saved']);
    await updateServer(save, server('1', 'docs'));
    expect(events).toEqual(['saved', 'saved', 'move notes → docs']);
    expect(list.map((s) => s.name)).toEqual(['docs']);
  });

  it('take their keys with them when removed, once saved', async () => {
    await removeServer(save, list[0]!);
    expect(events).toEqual(['saved', 'move notes → -']);
    expect(list).toEqual([]);
  });

  it('keep their keys where they were when the save fails', async () => {
    failing = true;
    await expect(updateServer(save, server('1', 'docs'))).rejects.toThrow('quota');
    await expect(removeServer(save, list[0]!)).rejects.toThrow('quota');
    expect(moveServerKeys).not.toHaveBeenCalled();
  });
});
