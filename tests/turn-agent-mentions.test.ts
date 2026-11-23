// What an @agent mention attaches to the turn (context/turn): a note naming the agents mentioned that
// may be asked from here, and those agents, for agents.ask; nothing when switched off.
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import type { Settings } from '../src/storage/settings';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).inertBrowser());
const { turnContext } = await import('../src/context/turn');

const settings = { providers: [], systemPrompt: '' } as unknown as Settings;
const said = (text: string): Message[] => [{ role: 'user', parts: [{ type: 'text', text }] }];
const turn = (text: string, over: { settings?: Settings; askable?: { name: string }[] } = {}) =>
  turnContext(
    { history: said(text), includePage: false },
    { settings: over.settings ?? settings, skills: [], templates: [], toolNames: [], askable: over.askable ?? [{ name: 'Research Bot' }], requestAccess: async () => false, send: () => {} },
  );

describe('an agent mention', () => {
  it('names the agent for the model, only one that may be asked', async () => {
    const { items, mentionedAgents } = await turn('@research-bot find it, and mail someone@example.com @mm');
    expect(mentionedAgents).toEqual(['Research Bot']);
    expect((await turn('hi @Research-Bot')).mentionedAgents).toEqual(['Research Bot']); // any case
    expect(items.map((i) => i.text)).toEqual(['The user wants Research Bot to do this: ask them with agents__ask.']);
  });

  it('is plain text when switched off, or when there is no one to ask', async () => {
    expect((await turn('@research-bot', { settings: { ...settings, mentions: { agents: false } } })).mentionedAgents).toEqual([]);
    const none = await turn('@research-bot', { askable: [] });
    expect([none.mentionedAgents, none.items]).toEqual([[], []]);
  });
});
