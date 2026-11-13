// What Builder manages beyond creating: reading a skill or a page widget action to change it, and
// deleting skills, actions, site templates and agents (never Builder, never a built-in).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool, ToolContext } from '../src/core/types';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const secrets = fakeSecretDb(); // agents' sites (agents/profiles)
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { skillStore } = await import('../src/skills/store');
const { skillTools } = await import('../src/skills/tools');
const { actionStore } = await import('../src/widget/store');
const { actionTools } = await import('../src/widget/tools');
const { templateStore } = await import('../src/templates/store');
const { templateTools } = await import('../src/templates/tools');
const { agentStore, newAgentProfile } = await import('../src/agents/profiles');
const { agentTools } = await import('../src/agents/tools');

const signal = new AbortController().signal;
const asBuilder = { signal, agentId: 'builder', skills: ['create-skill'] } as ToolContext;
const asOther = { signal, agentId: 'shop', skills: ['create-skill'] } as ToolContext;
const all: Tool[] = [...skillTools(), ...actionTools(async () => []), ...templateTools(), ...agentTools(async () => [])];
const named = (name: string) => all.find((t) => t.name === name)!;
const textOf = (r: Awaited<ReturnType<Tool['run']>>) => (r as { text: string }).text;

const triage = { id: 'triage', name: 'triage', description: 'Sorts tickets.', matches: [], body: '1. Read the ticket.', references: [], enabled: false };
const search = { id: 'a1', name: 'Search items', where: ['https://*.example.com/*'], input: 'selection' as const, tool: 'api.search', args: { query: '{input}' }, outputs: [{ label: 'Items', from: 'items[]' }], enabled: true };
const product = { id: 't1', name: 'shop-product', description: 'The product', matches: ['*://shop.example.com/*'], views: [], enabled: true };
const shop = { ...newAgentProfile(), id: 'shop', name: 'Shop', tools: ['browser.find'] };

beforeEach(async () => {
  storage.reset();
  await skillStore.save(triage);
  await actionStore.save(search as never);
  await templateStore.save(product);
  await agentStore.save(shop);
});

describe('skills', () => {
  it('Builder reads any of them, switched off too; another agent only its own', async () => {
    const read = textOf(await named('skills.read').run({ name: 'triage' }, asBuilder));
    expect(read).toContain('# Skill: triage');
    expect(read).toContain('"enabled": false');
    expect(read).toContain('1. Read the ticket.');
    await expect(named('skills.read').run({ name: 'triage' }, asOther)).rejects.toThrow('Skills you can read: create-skill');
  });

  it('Builder deletes any of the user\'s, never a built-in one', async () => {
    await expect(named('skills.delete').run({ name: 'triage' }, asOther)).rejects.toThrow('No skill named "triage"');
    expect(textOf(await named('skills.delete').run({ name: 'triage' }, asBuilder))).toBe('Deleted the skill "triage".');
    expect((await skillStore.load()).some((s) => s.name === 'triage')).toBe(false);
    await expect(named('skills.delete').run({ name: 'create-skill' }, asBuilder)).rejects.toThrow('built-in skill');
  });
});

describe('page widget actions', () => {
  it('reads one as actions.save takes it', async () => {
    const read = textOf(await named('actions.read').run({ name: 'Search items' }, asBuilder));
    expect(read).toContain('# Page widget action: Search items');
    expect(JSON.parse(read.slice(read.indexOf('{')))).toEqual({
      name: 'Search items', where: ['https://*.example.com/*'], input: 'selection', tool: 'api.search', args: { query: '{input}' }, outputs: [{ label: 'Items', from: 'items[]' }],
    });
    await expect(named('actions.read').run({ name: 'Nope' }, asBuilder)).rejects.toThrow('There is no page widget action "Nope". Yours: Search items.');
  });

  it('deletes one, always asking', async () => {
    const del = named('actions.delete');
    expect(del.alwaysAsk).toBe(true);
    expect((await del.describe!({ name: 'Search items' }, asBuilder)).summary).toBe('Delete the page widget action "Search items"');
    await del.run({ name: 'Search items' }, asBuilder);
    expect(await actionStore.load()).toEqual([]);
  });
});

describe('site templates and agents', () => {
  it('deletes a template, always asking', async () => {
    expect(named('templates.delete').alwaysAsk).toBe(true);
    expect(textOf(await named('templates.delete').run({ name: 'shop-product' }, asBuilder))).toBe('Deleted the site template "shop-product".');
    expect((await templateStore.load()).some((t) => t.name === 'shop-product')).toBe(false);
  });

  it('deletes an agent, never Builder', async () => {
    const del = named('agents.delete');
    expect(del.alwaysAsk).toBe(true);
    expect((await del.describe!({ name: 'shop' }, asBuilder)).details).toContainEqual({ label: 'Tools', value: 'browser.find' });
    expect(textOf(await del.run({ name: 'Shop' }, asBuilder))).toBe('Deleted the agent "Shop".');
    await expect(del.run({ name: 'Builder' }, asBuilder)).rejects.toThrow('There is no agent "Builder". Yours: none.');
  });
});
