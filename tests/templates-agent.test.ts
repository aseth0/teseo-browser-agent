import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool, ToolContext } from '../src/core/types';
import type { PageTemplate } from '../src/templates/types';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { templateStore } = await import('../src/templates/store');
const { templateTools } = await import('../src/templates/tools');

const tool = (name: string) => templateTools().find((t) => t.name === name) as Tool & Required<Pick<Tool, 'describe'>>;
const ctx = (over: Partial<ToolContext> = {}) => ({ signal: new AbortController().signal, ...over }) as ToolContext;
const template = (name: string): PageTemplate => ({
  id: `id-${name}`,
  name,
  description: '',
  matches: ['*://example.com/*'],
  views: [{ name: 'main', paths: ['*'], replacePage: false, body: '{{ page | one: "h1" }}' }],
  enabled: true,
});

beforeEach(async () => {
  storage.reset();
  await templateStore.save(template('shop'));
  await templateStore.save(template('mail'));
});

describe('the templates tools for an agent', () => {
  const agent = ctx({ templates: ['shop'] });

  it('load and delete only the templates it was given', async () => {
    await expect(tool('templates.load').run({ name: 'mail' }, agent)).rejects.toThrow('No template named "mail"');
    await expect(tool('templates.delete').describe({ name: 'mail' }, agent)).rejects.toThrow('No template named "mail"');
    await expect(tool('templates.delete').run({ name: 'mail' }, agent)).rejects.toThrow('No template named "mail"');
    expect((await tool('templates.load').run({ name: 'shop' }, agent)).type).toBe('text');
    expect((await tool('templates.delete').describe({ name: 'mail' }, ctx())).summary).toBe('Delete the site template "mail"');
    expect((await tool('templates.delete').describe({ name: 'mail' }, ctx({ templates: [], agentId: 'builder' }))).summary).toBe('Delete the site template "mail"');
  });

  it('cannot overwrite one it was not given', async () => {
    const args = { name: 'mail', urlPatterns: ['*://example.com/*'], views: [{ name: 'main', paths: ['*'], template: '{{ page | one: "h2" }}' }] };
    await expect(tool('templates.save').describe(args, agent)).rejects.toThrow('"mail" is a template this agent was not given');
    expect((await tool('templates.save').describe(args, ctx())).summary).toBe('Update the site template "mail"');
  });
});
